import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeFromLighthouse } from '../src/core/compose.mjs';
import { analyzePageHtml } from '../src/core/page-html.mjs';
import { readabilityPasses, countSyllables, analyzeText } from '../src/core/readability.mjs';
import { buildPageAudit, scorePageAudit, TOPICS, HOST_DERIVED_ATTRIBUTES, describeAttribute } from '../src/core/audit.mjs';

const lhr = JSON.parse(readFileSync(new URL('../fixtures/lhr/about.json', import.meta.url), 'utf8'));
const aboutHtml = readFileSync(new URL('../fixtures/site/about/index.html', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../fixtures/site/index.html', import.meta.url), 'utf8');

test('compose maps the planted defects on the about page', () => {
  let audit = composeFromLighthouse(lhr);
  assert.equal(audit.accessibility.attributes['image-alt'], false);
  assert.equal(audit.usability.attributes.description, false);
  assert.equal(audit.botability.attributes['link-text'], false);
  assert.equal(audit.usability.attributes.title, true);
  assert.equal(audit.usability.attributes.viewport, true);
  assert.equal(audit.accessibility.attributes.doctype, true);
  assert.equal(audit.accessibility.attributes.charset, true);
});

test('compose skips not-applicable, informative and manual accessibility audits', () => {
  let audit = composeFromLighthouse(lhr);
  for (let ref of lhr.categories.accessibility.auditRefs) {
    let mode = lhr.audits[ref.id]?.scoreDisplayMode;
    if (['notApplicable', 'informative', 'manual'].includes(mode)) {
      assert.equal(ref.id in audit.accessibility.attributes, false, ref.id);
    }
  }
});

test('compose leaves performance attributes out unless asked', () => {
  let audit = composeFromLighthouse(lhr);
  assert.equal('cls' in audit.usability.attributes, false);
  assert.equal('performanceInfo' in audit, false);
});

test('page html: social tags, lang and readability on the homepage', () => {
  let page = analyzePageHtml(indexHtml);
  assert.equal(page.lang, 'en');
  assert.equal(page.title, 'Example County');
  for (let key of ['ogsitename', 'ogtype', 'ogtitle', 'ogdescription', 'ogurl', 'ogimage', 'ogimagealt']) {
    assert.equal(page.usability.attributes[key], true, key);
  }
  assert.equal(page.botability.attributes.crawlable, true);
  assert.ok(page.readabilityInfo.words > 0);
  assert.ok(typeof page.readabilityInfo.automatedReadabilityIndex === 'number');
});

test('page html: missing social tags on the about page', () => {
  let page = analyzePageHtml(aboutHtml);
  assert.equal(page.usability.attributes.ogtitle, false);
  assert.equal(page.usability.attributes.ogurl, false);
});

test('page html: single-quoted og tags are not detected, as in production', () => {
  let page = analyzePageHtml(`<html lang="en"><head><meta property='og:title' content='x'></head><body><p>Hi there.</p></body></html>`);
  assert.equal(page.usability.attributes.ogtitle, false);
});

test('page html: non-English pages skip readability', () => {
  let page = analyzePageHtml('<html lang="es"><head><title>Hola</title></head><body><p>Hola mundo.</p></body></html>');
  assert.equal(page.lang, 'es');
  assert.equal(page.readabilityInfo, null);
});

test('readability threshold is ARI 8 after rounding', () => {
  assert.equal(readabilityPasses({ automatedReadabilityIndex: 8.4 }), true);
  assert.equal(readabilityPasses({ automatedReadabilityIndex: 8.5 }), false);
  assert.equal(readabilityPasses(null), false);
});

test('syllable counter matches production rules', () => {
  assert.equal(countSyllables('the'), 1);
  assert.equal(countSyllables('county'), 2);
  assert.equal(countSyllables('government'), 3);
  assert.equal(countSyllables(''), 1);
});

test('text analysis produces stats and grades', () => {
  let a = analyzeText('The county offers many services. Residents can pay bills online.');
  assert.equal(a.stats.sentences, 2);
  assert.equal(a.stats.words, 10);
  assert.ok(a.scores.fleschKincaidGrade >= 0);
});

test('build and score a page audit', () => {
  let audit = buildPageAudit({ lhr, html: aboutHtml });
  let scores = scorePageAudit(audit);
  assert.deepEqual(Object.keys(scores), TOPICS);
  assert.equal(scores.usability.attributes.readability, true);
  assert.equal(scores.usability.attributes.description, false);
  for (let topic of TOPICS) {
    let s = scores[topic];
    assert.equal(s.score, Math.floor((s.correct / s.all) * 100));
  }
  for (let name of HOST_DERIVED_ATTRIBUTES) {
    assert.equal(name in scores.security.attributes, false, name);
  }
  assert.equal('allowed' in scores.botability.attributes, false);
});

test('host-derived attributes can be kept for comparison with production', () => {
  let audit = buildPageAudit({ lhr, html: aboutHtml });
  let scores = scorePageAudit(audit, { excludeHostDerived: false });
  assert.equal('https' in scores.security.attributes, true);
});

test('attribute descriptions come from audits.json', () => {
  assert.equal(describeAttribute('usability', 'readability').displayName, 'Readability');
  assert.equal(describeAttribute('accessibility', 'no-such-thing').displayName, 'no-such-thing');
});
