#!/usr/bin/env node
/*
* scangov: audit a static site against ScanGov standards inside CI.
*
* Serves a built site on 127.0.0.1 and checks every HTML page from its
* markup (social tags, language, readability). A deterministic sample of
* pages, or the pages you name, also gets a full Lighthouse pass with the
* same flags ScanGov's production auditor uses, and the homepage (by
* default) adds the performance category for a lab CLS reading. Writes JSON
* and Markdown reports. Nothing is reachable from outside the runner and no
* page content leaves it.
*
* Exit codes: 0 clean, 1 findings or page errors, 2 configuration error.
*/

import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';
import { enumerateSite, sampleLighthousePages } from './pages.mjs';
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
  --pages <a,b,c>             Paths to check (default: every HTML page in the tree)
  --max-pages <n>             Cap on pages per run (default 200)
  --lighthouse-pages <a,b,c>  Paths that get the full Lighthouse pass, or "all"
                              (default: a sample of --lighthouse-max-pages pages)
  --lighthouse-max-pages <n>  Size of the Lighthouse sample (default 10)
  --performance-pages <a,b,c> Paths that also run the performance category for a
                              lab CLS reading, "all" or "none" (default: the homepage)
  --scangov-domain <host>     Domain known to ScanGov, enables production lookup
  --baseline <file>           Accepted findings file
  --fail-on <topics>          Topics whose failing attributes count as findings (default accessibility)
  --block                     Exit 1 on findings (default: report only, exit 0)
  --report-dir <dir>          Where to write reports (default scangov-report)
  --dry-run                   Serve and list pages by tier, skip Lighthouse
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

function splitPaths(value) {
  return value.split(',').map(p => p.trim()).filter(Boolean).map(p => (p.startsWith('/') ? p : '/' + p));
}

function positiveInt(value, flag) {
  let n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) fail(`${flag} must be a positive integer`);
  return n;
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
      'lighthouse-pages': { type: 'string' },
      'lighthouse-max-pages': { type: 'string', default: '10' },
      'performance-pages': { type: 'string' },
      'with-cls': { type: 'boolean', default: false }, // deprecated alias for --performance-pages all
      'scangov-domain': { type: 'string' },
      'baseline': { type: 'string' },
      'fail-on': { type: 'string', default: 'accessibility' },
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

  let maxPages = positiveInt(args['max-pages'], '--max-pages');
  let lighthouseMax = positiveInt(args['lighthouse-max-pages'], '--lighthouse-max-pages');

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

  let pagePaths;
  if (args.pages) {
    pagePaths = splitPaths(args.pages);
  } else {
    let site = await enumerateSite(path.resolve(siteDir));
    pagePaths = site.pages;
    for (let p of site.skipped) console.log(`scangov: skipping ${p}, not an HTML document`);
  }
  if (pagePaths.length > maxPages) {
    console.warn(`scangov: ${pagePaths.length} pages found, checking the first ${maxPages}`);
    pagePaths = pagePaths.slice(0, maxPages);
  }

  // Which pages get the full Lighthouse pass. Pages named explicitly are
  // audited even if the tree did not list them.
  let lighthouseArg = args['lighthouse-pages'];
  let lighthousePaths;
  if (lighthouseArg === 'all') lighthousePaths = [...pagePaths];
  else if (lighthouseArg) lighthousePaths = splitPaths(lighthouseArg);
  else lighthousePaths = sampleLighthousePages(pagePaths, { max: lighthouseMax });
  for (let p of lighthousePaths) if (!pagePaths.includes(p)) pagePaths.push(p);

  // Which of those also run the performance category.
  let performanceArg = args['performance-pages'];
  if (args['with-cls']) {
    console.warn('scangov: --with-cls is deprecated, use --performance-pages all');
    performanceArg = 'all';
  }
  let performancePaths;
  if (performanceArg === undefined) performancePaths = lighthousePaths.includes('/') ? ['/'] : [];
  else if (performanceArg === 'none' || performanceArg === '') performancePaths = [];
  else if (performanceArg === 'all') performancePaths = [...lighthousePaths];
  else performancePaths = splitPaths(performanceArg);
  for (let p of performancePaths) {
    if (!lighthousePaths.includes(p)) lighthousePaths.push(p);
    if (!pagePaths.includes(p)) pagePaths.push(p);
  }
  let lighthouseSet = new Set(lighthousePaths);
  let performanceSet = new Set(performancePaths);

  let pages = pagePaths.map(p => {
    let rel = p.slice(1);
    return { path: p, url: new URL(basePath + rel, origin).href };
  });

  let manifest = {
    generatedAt: new Date().toISOString(),
    origin,
    basePath,
    canonicalDomain,
    blocking,
    lighthousePages: lighthousePaths,
    lighthouseSample: lighthouseArg ? null : lighthouseMax,
    performancePages: performancePaths,
    pages
  };
  await writeFile(path.join(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`scangov: ${pages.length} page(s), Lighthouse on ${lighthouseSet.size}, performance category on ${performanceSet.size}`);
  if (args['dry-run']) {
    for (let p of pages) console.log(`  ${tierLabel(p.path, lighthouseSet, performanceSet).padEnd(22)} ${p.url}`);
    await server?.close();
    return EXIT_CLEAN;
  }

  let runner = new LighthouseRunner();
  let results = [];
  try {
    if (lighthouseSet.size > 0) {
      await runner.start();
      await mkdir(path.join(reportDir, 'lhr'), { recursive: true });
    }
    for (let page of pages) {
      let full = lighthouseSet.has(page.path);
      let performance = performanceSet.has(page.path);
      process.stdout.write(`scangov: ${full ? 'auditing' : 'checking'} ${page.path} ... `);
      try {
        let html = await fetchHtml(page.url);
        let lhr = full ? await runner.audit(page.url, { performance }) : null;
        if (lhr) await writeFile(path.join(reportDir, 'lhr', slug(page.path) + '.json'), JSON.stringify(lhr));
        let audit = buildPageAudit({ lhr, html, performance });
        if (performance) {
          // Only the layout-shift reading is meaningful on a runner; the
          // other lab timings are dropped rather than reported as failures.
          for (let k of ['fcp', 'lcp', 'ttfb', 'inp']) delete audit.usability.attributes[k];
        }
        let scores = scorePageAudit(audit);
        let readability = audit.readabilityInfo?.words
          ? { ari: round1(audit.readabilityInfo.automatedReadabilityIndex), fleschKincaidGrade: audit.readabilityInfo.fleschKincaidGrade, words: audit.readabilityInfo.words, sentences: audit.readabilityInfo.sentences }
          : null;
        results.push({
          ...page,
          status: 'ok',
          audit: full ? 'lighthouse' : 'html',
          performance,
          finalUrl: audit.finalUrl || page.url,
          lang: audit.lang,
          scores,
          readability,
          attributes: Object.fromEntries(TOPICS.map(t => [t, audit[t].attributes]))
        });
        console.log(TOPICS.map(t => `${t} ${scores[t].score ?? '-'}`).join(', ') + (full ? '' : ' (html only)'));
      } catch (error) {
        results.push({ ...page, status: 'error', audit: full ? 'lighthouse' : 'html', performance, error: error.message });
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

  console.log(`scangov: report written to ${reportDir} (${results.length} pages, Lighthouse on ${lighthouseSet.size}, ${failing} failing attributes in ${failOn.join(',')}, ${errored} page errors)`);
  if (outcome === 'findings' && !blocking) {
    console.log('scangov: findings present, exiting 0 because --block is not set');
  }
  return exitCode;
}

function tierLabel(p, lighthouseSet, performanceSet) {
  if (performanceSet.has(p)) return 'lighthouse+performance';
  if (lighthouseSet.has(p)) return 'lighthouse';
  return 'html';
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
