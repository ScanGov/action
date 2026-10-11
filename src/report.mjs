/*
* Report writers. Results are presented in ScanGov's topic structure:
* accessibility, usability, botability and security, each scored per page
* as the share of passing attributes, exactly as scangov.org scores a page.
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
    let state = r.outcome === 'clean' ? 'No findings.' : `${r.findings} finding(s) in ${r.failOn.join(', ')}.`;
    let effect = r.outcome === 'clean' ? '' : r.blocking ? ' The job fails.' : ' The job passes because `block` is not enabled.';
    lines.push(`**Result:** ${state}${effect} Mode: ${mode}.`);
    lines.push('');
  }

  lines.push(`| Page | ${TOPICS.map(topicDisplayName).join(' | ')} |`);
  lines.push(`|---|${TOPICS.map(() => '---').join('|')}|`);
  for (let p of data.pages) {
    if (p.status !== 'ok') {
      lines.push(`| \`${p.path}\` | ${TOPICS.map(() => 'error').join(' | ')} |`);
      continue;
    }
    lines.push(`| \`${p.path}\` | ${TOPICS.map(t => p.scores[t].score ?? '-').join(' | ')} |`);
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
      lines.push(`**${topicDisplayName(topic)}** (${p.scores[topic].score})`);
      lines.push('');
      for (let name of names) {
        let d = describeAttribute(topic, name);
        let detail = name === 'readability' && p.readability ? ` (ARI grade ${p.readability.ari})` : '';
        lines.push(`- ${escape(d.displayName)} \`${name}\`${detail}${d.error ? `: ${escape(d.error)}` : ''}`);
      }
      lines.push('');
    }
    lines.push('</details>');
    lines.push('');
  }

  lines.push(`Not scored here because the host decides them: ${HOST_DERIVED_ATTRIBUTES.map(a => '`' + a + '`').join(', ')}. Domain-level checks (sitemap, security.txt, X-Content-Type-Options, www, Core Web Vitals) are measured once per site by ScanGov monitoring. Both are left to the production audit.`);
  return lines.join('\n');
}

function escape(text) {
  return String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
