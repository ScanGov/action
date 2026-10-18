/*
* Report writers. Results are presented in ScanGov's topic structure:
* accessibility, usability, botability, security and readability, each
* scored per page as the share of passing attributes, exactly as scangov.org
* scores a page. Only the topics the run was asked for appear. Pages that
* were checked from their HTML only carry a score for readability alone;
* the Lighthouse-derived topics show "-". Lab performance readings, when
* the performance category ran, get their own unscored table.
*/

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TOPICS, HOST_DERIVED_ATTRIBUTES, topicDisplayName, describeAttribute } from './core/audit.mjs';

export async function writeReports(reportDir, data) {
  await writeFile(path.join(reportDir, 'scangov.json'), JSON.stringify(data, null, 2));
  await writeFile(path.join(reportDir, 'scangov.md'), toMarkdown(data));
}

function failedAttributes(page, topics) {
  let out = [];
  for (let topic of topics) {
    for (let [name, passed] of Object.entries(page.scores?.[topic]?.attributes || {})) {
      if (!passed) out.push({ topic, name });
    }
  }
  return out;
}

function auditLabel(page) {
  if (page.audit === 'html') return page.performance ? 'HTML + performance' : 'HTML only';
  return page.performance ? 'Lighthouse + performance' : 'Lighthouse';
}

const HTML_CHECKS = 'social tags, language, readability';

function toMarkdown(data) {
  let lines = [];
  let topics = (data.topics || TOPICS).filter(t => TOPICS.includes(t));
  let left = TOPICS.filter(t => !topics.includes(t));
  let full = data.pages.filter(p => p.audit !== 'html');
  let htmlOnly = data.pages.length - full.length;
  let withPerformance = data.pages.filter(p => p.performance).length;
  let version = data.lighthouseVersion ? `Lighthouse ${data.lighthouseVersion}` : 'Lighthouse';

  lines.push('## ScanGov pre-deploy audit');
  lines.push('');
  let summary = `Checked ${data.pages.length} page(s) from \`${data.basePath}\`.`;
  if (full.length > 0) {
    summary += ` ${version} ran on ${full.length} of them`;
    if (withPerformance > 0) summary += `, with the performance category on ${withPerformance}`;
    summary += htmlOnly > 0 ? `; the other ${htmlOnly} were checked from their HTML (${HTML_CHECKS}).` : '.';
  } else if (topics.length === 0) {
    summary += ` The ${version} performance category ran on ${withPerformance}.`;
  } else {
    summary += ` Every page was checked from its HTML (${HTML_CHECKS})`;
    summary += withPerformance > 0 ? `, and the ${version} performance category ran on ${withPerformance}.` : '.';
  }
  lines.push(summary);
  if (data.canonicalDomain) lines.push(`Canonical domain: ${data.canonicalDomain}`);
  if (topics.length === 0) lines.push('No ScanGov topics run, by request: lab performance only.');
  else if (left.length > 0) lines.push(`Topics not run, by request: ${left.map(topicDisplayName).join(', ')}.`);
  lines.push('');
  if (data.result) {
    let r = data.result;
    let mode = r.blocking ? 'blocking' : 'report only';
    let state = r.outcome === 'clean' ? 'No findings.' : `${r.findings} finding(s)${r.failOn.length > 0 ? ` in ${r.failOn.join(', ')}` : ''}.`;
    let effect = r.outcome === 'clean' ? '' : r.blocking ? ' The job fails.' : ' The job passes because `block` is not enabled.';
    lines.push(`**Result:** ${state}${effect} Mode: ${mode}.`);
    lines.push('');
  }

  if (topics.length > 0) {
    lines.push(`| Page | Audit | ${topics.map(topicDisplayName).join(' | ')} |`);
    lines.push(`|---|---|${topics.map(() => '---').join('|')}|`);
    for (let p of data.pages) {
      if (p.status !== 'ok') {
        lines.push(`| \`${p.path}\` | ${auditLabel(p)} | ${topics.map(() => 'error').join(' | ')} |`);
        continue;
      }
      lines.push(`| \`${p.path}\` | ${auditLabel(p)} | ${topics.map(t => p.scores[t]?.score ?? '-').join(' | ')} |`);
    }
    lines.push('');
  }

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
    let failed = failedAttributes(p, topics);
    if (failed.length === 0) continue;
    lines.push(`<details><summary><code>${p.path}</code>: ${failed.length} failing attribute(s)</summary>`);
    lines.push('');
    for (let topic of topics) {
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

  let lab = data.pages.filter(p => p.status === 'ok' && p.lab);
  if (lab.length > 0) {
    lines.push('### Lab performance');
    lines.push('');
    lines.push('| Page | Score | FCP | LCP | CLS | TBT | Speed Index | TTFB |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (let p of lab) {
      let m = p.lab;
      lines.push(`| \`${p.path}\` | ${num(m.score)} | ${ms(m['first-contentful-paint'])} | ${ms(m['largest-contentful-paint'])} | ${num(m['cumulative-layout-shift'])} | ${ms(m['total-blocking-time'])} | ${ms(m['speed-index'])} | ${ms(m['server-response-time'])} |`);
    }
    lines.push('');
    lines.push('Lab readings from a shared runner, throttled the way Lighthouse throttles. They are a regression signal between runs of this site, not production numbers, and are not scored. Only the CLS reading counts toward usability. Core Web Vitals in ScanGov come from Chrome field data.');
    lines.push('');
  }

  if (htmlOnly > 0 && full.length > 0) {
    lines.push(`Lighthouse ran on a sample: the homepage, each section's landing page, then each section's first inner page${data.lighthouseSample ? `, up to ${data.lighthouseSample} pages` : ''}. Set \`lighthouse-pages\` or \`lighthouse-max-pages\` to change it.`);
    lines.push('');
  }
  if (topics.length === 0) return lines.join('\n');
  lines.push(`Not scored here because the host decides them: ${HOST_DERIVED_ATTRIBUTES.map(a => '`' + a + '`').join(', ')}. Domain-level checks (sitemap, security.txt, X-Content-Type-Options, www, Core Web Vitals) are measured once per site by ScanGov monitoring. Both are left to the production audit.`);
  return lines.join('\n');
}

function ms(value) {
  return value == null ? '-' : `${value} ms`;
}

function num(value) {
  return value == null ? '-' : String(value);
}

function escape(text) {
  return String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
