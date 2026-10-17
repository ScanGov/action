/*
* Report writers. Results are presented in ScanGov's topic structure:
* accessibility, usability, botability, security and readability, each
* scored per page as the share of passing attributes, exactly as scangov.org
* scores a page. Pages that were checked from their HTML only carry a score
* for readability alone; the Lighthouse-derived topics show "-".
*/

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TOPICS, HOST_DERIVED_ATTRIBUTES, topicDisplayName, describeAttribute } from './core/audit.mjs';

export async function writeReports(reportDir, data) {
  await writeFile(path.join(reportDir, 'scangov.json'), JSON.stringify(data, null, 2));
  await writeFile(path.join(reportDir, 'scangov.md'), toMarkdown(data));
}

function failedAttributes(page) {
  let out = [];
  for (let topic of TOPICS) {
    for (let [name, passed] of Object.entries(page.scores?.[topic]?.attributes || {})) {
      if (!passed) out.push({ topic, name });
    }
  }
  return out;
}

function auditLabel(page) {
  if (page.audit === 'html') return 'HTML only';
  return page.performance ? 'Lighthouse + CLS' : 'Lighthouse';
}

function toMarkdown(data) {
  let lines = [];
  let full = data.pages.filter(p => p.audit !== 'html');
  let htmlOnly = data.pages.length - full.length;
  let withPerformance = data.pages.filter(p => p.performance).length;

  lines.push('## ScanGov pre-deploy audit');
  lines.push('');
  let summary = `Checked ${data.pages.length} page(s) from \`${data.basePath}\`. Lighthouse ${data.lighthouseVersion || ''} ran on ${full.length} of them`;
  if (withPerformance > 0) summary += `, with the performance category on ${withPerformance}`;
  summary += htmlOnly > 0 ? `; the other ${htmlOnly} were checked from their HTML (social tags, language, readability).` : '.';
  lines.push(summary);
  if (data.canonicalDomain) lines.push(`Canonical domain: ${data.canonicalDomain}`);
  lines.push('');
  if (data.result) {
    let r = data.result;
    let mode = r.blocking ? 'blocking' : 'report only';
    let state = r.outcome === 'clean' ? 'No findings.' : `${r.findings} finding(s) in ${r.failOn.join(', ')}.`;
    let effect = r.outcome === 'clean' ? '' : r.blocking ? ' The job fails.' : ' The job passes because `block` is not enabled.';
    lines.push(`**Result:** ${state}${effect} Mode: ${mode}.`);
    lines.push('');
  }

  lines.push(`| Page | Audit | ${TOPICS.map(topicDisplayName).join(' | ')} |`);
  lines.push(`|---|---|${TOPICS.map(() => '---').join('|')}|`);
  for (let p of data.pages) {
    if (p.status !== 'ok') {
      lines.push(`| \`${p.path}\` | ${auditLabel(p)} | ${TOPICS.map(() => 'error').join(' | ')} |`);
      continue;
    }
    lines.push(`| \`${p.path}\` | ${auditLabel(p)} | ${TOPICS.map(t => p.scores[t].score ?? '-').join(' | ')} |`);
  }
  lines.push('');

  for (let p of data.pages) {
    if (p.status !== 'ok') {
      lines.push(`<details><summary><code>${p.path}</code>: could not be audited</summary>`);
      lines.push('');
      lines.push(escape(p.error));
      lines.push('');
      lines.push('</details>');
      lines.push('');
      continue;
    }
    let failed = failedAttributes(p);
    if (failed.length === 0) continue;
    lines.push(`<details><summary><code>${p.path}</code>: ${failed.length} failing attribute(s)</summary>`);
    lines.push('');
    for (let topic of TOPICS) {
      let names = failed.filter(f => f.topic === topic).map(f => f.name);
      if (names.length === 0) continue;
      let score = p.scores[topic].score;
      lines.push(`**${topicDisplayName(topic)}**${score == null ? '' : ` (${score})`}`);
      lines.push('');
      for (let name of names) {
        let d = describeAttribute(topic, name);
        let detail = name === 'reading-level' && p.readability ? ` (ARI grade ${p.readability.ari})` : '';
        lines.push(`- ${escape(d.displayName)} \`${name}\`${detail}${d.error ? `: ${escape(d.error)}` : ''}`);
      }
      lines.push('');
    }
    lines.push('</details>');
    lines.push('');
  }

  if (htmlOnly > 0) {
    lines.push(`Lighthouse ran on a sample: the homepage, each section's landing page, then each section's first inner page${data.lighthouseSample ? `, up to ${data.lighthouseSample} pages` : ''}. Set \`lighthouse-pages\` or \`lighthouse-max-pages\` to change it.`);
    lines.push('');
  }
  lines.push(`Not scored here because the host decides them: ${HOST_DERIVED_ATTRIBUTES.map(a => '`' + a + '`').join(', ')}. Domain-level checks (sitemap, security.txt, X-Content-Type-Options, www, Core Web Vitals) are measured once per site by ScanGov monitoring. Both are left to the production audit.`);
  return lines.join('\n');
}

function escape(text) {
  return String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
