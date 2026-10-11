/*
* Report writers.
*
* Until the shared @scangov/core package exists, the report shows raw
* Lighthouse category scores and the audits that failed on each page. The
* mapping from Lighthouse audits to ScanGov attributes and topic scores
* lives in ScanGov's production auditor today and arrives here when that
* code is extracted into core so both sides share one implementation.
*/

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export function summarize(lhr) {
  let categories = {};
  for (let [id, cat] of Object.entries(lhr.categories || {})) {
    categories[id] = cat.score == null ? null : Math.round(cat.score * 100);
  }
  let failing = [];
  for (let [id, cat] of Object.entries(lhr.categories || {})) {
    for (let ref of cat.auditRefs || []) {
      let audit = lhr.audits[ref.id];
      if (!audit) continue;
      if (['notApplicable', 'informative', 'manual'].includes(audit.scoreDisplayMode)) continue;
      if (audit.score === 1) continue;
      failing.push({ id: ref.id, category: id, title: audit.title, score: audit.score });
    }
  }
  return { categories, failing, finalUrl: lhr.finalDisplayedUrl };
}

export async function writeReports(reportDir, data) {
  await writeFile(path.join(reportDir, 'scangov.json'), JSON.stringify(data, null, 2));
  await writeFile(path.join(reportDir, 'scangov.md'), toMarkdown(data));
}

function toMarkdown(data) {
  let lines = [];
  lines.push('## ScanGov pre-deploy audit');
  lines.push('');
  lines.push(`Audited ${data.pages.length} page(s) from \`${data.basePath}\` with Lighthouse ${data.lighthouseVersion || ''}.`);
  if (data.canonicalDomain) lines.push(`Canonical domain: ${data.canonicalDomain}`);
  lines.push('');
  if (data.result) {
    let r = data.result;
    let mode = r.blocking ? 'blocking' : 'report only';
    let state = r.outcome === 'clean' ? 'No findings.' : `${r.findings} finding(s).`;
    let effect = r.outcome === 'clean' ? '' : r.blocking ? ' The job fails.' : ' The job passes because `block` is not enabled.';
    lines.push(`**Result:** ${state}${effect} Mode: ${mode}.`);
    lines.push('');
  }
  lines.push('> Preview output. Lighthouse category scores and failing audits are shown.');
  lines.push('> ScanGov topic scores arrive when the shared scoring package is published.');
  lines.push('');
  lines.push('| Page | Accessibility | Best practices | SEO | Failing audits |');
  lines.push('|---|---|---|---|---|');
  for (let p of data.pages) {
    if (p.status !== 'ok') {
      lines.push(`| \`${p.path}\` | error | | | ${escape(p.error)} |`);
      continue;
    }
    let c = p.categories;
    lines.push(`| \`${p.path}\` | ${c.accessibility ?? '-'} | ${c['best-practices'] ?? '-'} | ${c.seo ?? '-'} | ${p.failing.length} |`);
  }
  lines.push('');
  for (let p of data.pages) {
    if (p.status !== 'ok' || p.failing.length === 0) continue;
    lines.push(`<details><summary><code>${p.path}</code>: ${p.failing.length} failing</summary>`);
    lines.push('');
    for (let f of p.failing) lines.push(`- **${f.id}** (${f.category}): ${escape(f.title)}`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  return lines.join('\n');
}

function escape(text) {
  return String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
