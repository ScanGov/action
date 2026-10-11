#!/usr/bin/env node
/*
* scangov: audit a static site against ScanGov standards inside CI.
*
* Serves a built site on 127.0.0.1, runs Lighthouse against every page with
* the same flags ScanGov's production auditor uses, and writes JSON and
* Markdown reports. Nothing is reachable from outside the runner and no page
* content leaves it.
*
* Exit codes: 0 clean, 1 findings or page errors, 2 configuration error.
*/

import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';
import { enumeratePages } from './pages.mjs';
import { LighthouseRunner } from './lighthouse.mjs';
import { writeReports } from './report.mjs';
import { buildPageAudit, scorePageAudit, TOPICS } from './core/audit.mjs';

const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_CONFIG = 2;

const USAGE = `Usage: scangov (--site-dir <dir> | --base-url <url>) [options]

  --site-dir <dir>            Built site to serve on 127.0.0.1
  --base-url <url>            Already running server to audit instead
  --base-path <path>          Path prefix the site is published under (default /)
  --canonical-domain <host>   Domain your pages use in canonical links and the sitemap (never fetched)
  --pages <a,b,c>             Paths to audit (default: every HTML page in the tree)
  --max-pages <n>             Cap on pages per run (default 200)
  --scangov-domain <host>     Domain known to ScanGov, enables production lookup
  --baseline <file>           Accepted findings file
  --fail-on <topics>          Topics whose failing attributes count as findings (default accessibility)
  --with-cls                  Include the Lighthouse performance category
  --block                     Exit 1 on findings (default: report only, exit 0)
  --report-dir <dir>          Where to write reports (default scangov-report)
  --dry-run                   Serve and enumerate pages, skip Lighthouse
  --help
`;

function fail(message) {
  console.error(`scangov: ${message}`);
  console.error(USAGE);
  process.exit(EXIT_CONFIG);
}

function normalizeBasePath(basePath) {
  let p = basePath || '/';
  if (!p.startsWith('/')) p = '/' + p;
  if (!p.endsWith('/')) p = p + '/';
  return p;
}

async function main() {
  let { values: args } = parseArgs({
    options: {
      'site-dir': { type: 'string' },
      'base-url': { type: 'string' },
      'base-path': { type: 'string', default: '/' },
      'canonical-domain': { type: 'string' },
      'pages': { type: 'string' },
      'max-pages': { type: 'string', default: '200' },
      'scangov-domain': { type: 'string' },
      'baseline': { type: 'string' },
      'fail-on': { type: 'string', default: 'accessibility' },
      'with-cls': { type: 'boolean', default: false },
      'block': { type: 'boolean', default: false },
      'report-dir': { type: 'string', default: 'scangov-report' },
      'dry-run': { type: 'boolean', default: false },
      'help': { type: 'boolean', default: false }
    },
    strict: true,
    allowNegative: true
  });
  let blocking = args.block;
  let failOn = args['fail-on'].split(',').map(t => t.trim()).filter(Boolean);
  for (let t of failOn) {
    if (!TOPICS.includes(t)) fail(`--fail-on topic "${t}" is not one of ${TOPICS.join(', ')}`);
  }

  if (args.help) {
    console.log(USAGE);
    return EXIT_CLEAN;
  }

  let siteDir = args['site-dir'];
  let baseUrl = args['base-url'];
  if (!siteDir && !baseUrl) fail('one of --site-dir or --base-url is required');
  if (siteDir && baseUrl) fail('--site-dir and --base-url are mutually exclusive');
  if (siteDir && !existsSync(siteDir)) fail(`site directory not found: ${siteDir}`);
  if (baseUrl && !args.pages) fail('--base-url needs --pages, there is no tree to enumerate');

  let maxPages = parseInt(args['max-pages'], 10);
  if (!Number.isFinite(maxPages) || maxPages < 1) fail('--max-pages must be a positive integer');

  let basePath = normalizeBasePath(args['base-path']);
  let canonicalDomain = normalizeCanonicalDomain(args['canonical-domain']);
  if (!canonicalDomain) {
    console.warn('scangov: no --canonical-domain given, sitemap and canonical URLs will be compared by path only');
  }

  let reportDir = path.resolve(args['report-dir']);
  await mkdir(reportDir, { recursive: true });

  let server = null;
  let origin = baseUrl;
  if (siteDir) {
    server = await serve({ dir: path.resolve(siteDir), basePath });
    origin = server.origin;
    console.log(`scangov: serving ${siteDir} at ${origin}${basePath}`);
  }

  let pagePaths = args.pages
    ? args.pages.split(',').map(p => p.trim()).filter(Boolean)
    : await enumeratePages(path.resolve(siteDir));
  if (pagePaths.length > maxPages) {
    console.warn(`scangov: ${pagePaths.length} pages found, auditing the first ${maxPages}`);
    pagePaths = pagePaths.slice(0, maxPages);
  }

  let pages = pagePaths.map(p => {
    let rel = p.startsWith('/') ? p.slice(1) : p;
    return { path: '/' + rel, url: new URL(basePath + rel, origin).href };
  });

  let manifest = {
    generatedAt: new Date().toISOString(),
    origin,
    basePath,
    canonicalDomain,
    blocking,
    pages
  };
  await writeFile(path.join(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  if (args['dry-run']) {
    console.log(`scangov: dry run, ${pages.length} page(s) enumerated`);
    for (let p of pages) console.log(`  ${p.url}`);
    await server?.close();
    return EXIT_CLEAN;
  }

  let runner = new LighthouseRunner({ withCls: args['with-cls'] });
  let results = [];
  try {
    await runner.start();
    await mkdir(path.join(reportDir, 'lhr'), { recursive: true });
    for (let page of pages) {
      process.stdout.write(`scangov: auditing ${page.path} ... `);
      try {
        let html = await fetchHtml(page.url);
        let lhr = await runner.audit(page.url);
        await writeFile(path.join(reportDir, 'lhr', slug(page.path) + '.json'), JSON.stringify(lhr));
        let audit = buildPageAudit({ lhr, html, performance: args['with-cls'] });
        if (args['with-cls']) {
          // Only the layout-shift reading is meaningful on a runner; the
          // other lab timings are dropped rather than reported as failures.
          for (let k of ['fcp', 'lcp', 'ttfb', 'inp']) delete audit.usability.attributes[k];
        }
        let scores = scorePageAudit(audit);
        let readability = audit.readabilityInfo?.words
          ? { ari: round1(audit.readabilityInfo.automatedReadabilityIndex), fleschKincaidGrade: audit.readabilityInfo.fleschKincaidGrade, words: audit.readabilityInfo.words, sentences: audit.readabilityInfo.sentences }
          : null;
        results.push({ ...page, status: 'ok', finalUrl: audit.finalUrl, lang: audit.lang, scores, readability, attributes: Object.fromEntries(TOPICS.map(t => [t, audit[t].attributes])) });
        console.log(TOPICS.map(t => `${t} ${scores[t].score ?? '-'}`).join(', '));
      } catch (error) {
        results.push({ ...page, status: 'error', error: error.message });
        console.log(`error: ${error.message}`);
      }
    }
  } finally {
    await runner.stop();
    await server?.close();
  }

  // A finding is a failing attribute in a --fail-on topic, or a page that
  // could not be audited at all.
  let errored = results.filter(r => r.status === 'error').length;
  let failing = 0;
  for (let r of results) {
    if (r.status !== 'ok') continue;
    for (let t of failOn) failing += Object.values(r.scores[t].attributes).filter(v => !v).length;
  }
  let findings = errored + failing;
  let outcome = findings > 0 ? 'findings' : 'clean';
  let exitCode = outcome === 'findings' && blocking ? EXIT_FINDINGS : EXIT_CLEAN;
  let result = { outcome, findings, pageErrors: errored, failOn, blocking, exitCode };

  await writeReports(reportDir, { ...manifest, lighthouseVersion: runner.version, result, pages: results });

  console.log(`scangov: report written to ${reportDir} (${results.length} pages, ${failing} failing attributes in ${failOn.join(',')}, ${errored} page errors)`);
  if (outcome === 'findings' && !blocking) {
    console.log('scangov: findings present, exiting 0 because --block is not set');
  }
  return exitCode;
}

/*
* Accept a bare domain (www.example.gov) or a full origin
* (https://www.example.gov/) and keep the origin form, which is what the
* absolute URLs in the files start with.
*/
function normalizeCanonicalDomain(value) {
  if (!value) return null;
  let v = value.trim();
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    return new URL(v).origin;
  } catch {
    fail(`--canonical-domain is not a valid domain or origin: ${value}`);
  }
}

async function fetchHtml(url) {
  let res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScanGovBot/1.0; +https://scangov.com/bot)' } });
  if (res.status === 404) throw new Error('page not found (HTTP 404)');
  if (!res.ok) throw new Error(`page returned HTTP ${res.status}`);
  return res.text();
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function slug(p) {
  return (p === '/' ? 'index' : p.replace(/^\/|\/$/g, '')).replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'index';
}

main().then(code => process.exit(code), error => {
  console.error(`scangov: ${error.stack || error.message}`);
  process.exit(EXIT_CONFIG);
});
