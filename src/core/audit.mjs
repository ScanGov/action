/*
* Assemble one page's ScanGov audit from its Lighthouse result and its HTML,
* then score it by topic. The merge mirrors ScanGov's production auditor:
* HTML-derived attributes are added to the Lighthouse-derived ones,
* readability passes when the Automated Readability Index rounds to 8 or
* below, and non-English pages are not scored on readability.
*
* Scoring mirrors the production transform: per topic,
* score = round(correct / all * 100), with the domain-level global
* attributes excluded because they are measured once per site, not per
* page.
*/

import { createRequire } from 'node:module';
import { composeFromLighthouse } from './compose.mjs';
import { analyzePageHtml, isEnglish } from './page-html.mjs';
import { readabilityPasses } from './readability.mjs';

const require = createRequire(import.meta.url);
export const AUDITS = require('./audits.json');
export const TOPICS = ['accessibility', 'usability', 'botability', 'security'].filter(t => t in AUDITS);

/* Measured once per site by ScanGov's domain-level pass, never per page. */
export const GLOBAL_ATTRIBUTES = [
  'schema-government-organization', 'securitytxt', 'xcontenttypeoptions', 'xContentTypeOptions',
  'sitemap-robots', 'allowed', 'valid', 'xml', 'status', 'www', 'dotgov'
];

/* Decided by the host's transport and response headers. On a loopback
   server Lighthouse reports them as passing or informative, which says
   nothing about production, so they are left out of the CI score. */
export const HOST_DERIVED_ATTRIBUTES = ['https', 'hsts', 'csp', 'clickjacking-mitigation'];

export function buildPageAudit({ lhr, html, performance = false }) {
  let audit = composeFromLighthouse(lhr, { performance });
  let page = analyzePageHtml(html || '');

  audit.title = page.title;
  audit.lang = page.lang;
  Object.assign(audit.usability.attributes, page.usability.attributes);
  audit.botability.attributes.crawlable = page.botability.attributes.crawlable;
  audit.botability.attributes['text-content'] = page.botability.attributes['text-content'];

  audit.readabilityInfo = page.readabilityInfo || {};
  if (page.readabilityInfo) {
    audit.usability.attributes.readability = readabilityPasses(page.readabilityInfo);
  }
  return audit;
}

export function scorePageAudit(audit, { excludeHostDerived = true } = {}) {
  let exclude = [...GLOBAL_ATTRIBUTES];
  if (!isEnglish(audit.lang)) exclude.push('readability');
  if (excludeHostDerived) exclude.push(...HOST_DERIVED_ATTRIBUTES);
  let scores = {};
  for (let topic of TOPICS) {
    let attributes = {};
    let all = 0;
    let correct = 0;
    for (let [name, value] of Object.entries(audit[topic]?.attributes || {})) {
      if (exclude.includes(name)) continue;
      attributes[name] = Boolean(value);
      all++;
      if (value) correct++;
    }
    scores[topic] = { attributes, all, correct, score: all > 0 ? Math.floor((correct / all) * 100) : null };
  }
  return scores;
}

/* Display names and descriptions for an attribute, from audits.json. */
export function describeAttribute(topic, name) {
  let entry = (AUDITS[topic]?.attributes || []).find(a => a.scorekey === name || a.key === name);
  return {
    displayName: entry?.displayName || name,
    description: entry?.description || '',
    error: entry?.error || ''
  };
}

export function topicDisplayName(topic) {
  return AUDITS[topic]?.displayName || topic;
}
