import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeFromLighthouse } from '../src/core/compose.mjs';
import { analyzePageHtml } from '../src/core/page-html.mjs';
import { readingLevelFromInfo, countSyllables, analyzeText } from '../src/core/readability.mjs';
import { buildPageAudit, scorePageAudit, lighthouseCategoriesFor, TOPICS, HOST_DERIVED_ATTRIBUTES, describeAttribute } from '../src/core/audit.mjs';
import { labPerformance } from '../src/lighthouse.mjs';

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

test('reading level threshold is ARI 8 after rounding', () => {
  assert.equal(readingLevelFromInfo({ automatedReadabilityIndex: 8.4, words: 50 }), true);
  assert.equal(readingLevelFromInfo({ automatedReadabilityIndex: 8.5, words: 50 }), false);
  assert.equal(readingLevelFromInfo(null), undefined);
});

test('reading level is not scored on skipped or empty extractions', () => {
  assert.equal(readingLevelFromInfo({ automatedReadabilityIndex: 0, words: 0, skipped: 'html-too-large' }), null);
  assert.equal(readingLevelFromInfo({ automatedReadabilityIndex: 0, words: 0, sentences: 0 }), null);
  let audit = buildPageAudit({ lhr, html: '<html lang="en"><head><title>Empty</title></head><body></body></html>' });
  assert.equal('reading-level' in audit.readability.attributes, false);
  assert.equal(scorePageAudit(audit).readability.score, null);
});

test('non-English pages are excluded from the reading level', () => {
  let audit = buildPageAudit({ lhr, html: '<html lang="es"><head><title>Hola</title></head><body><p>Hola mundo. Esto es una prueba.</p></body></html>' });
  assert.deepEqual(scorePageAudit(audit).readability, { attributes: {}, all: 0, correct: 0, score: null });
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
  assert.equal(scores.readability.attributes['reading-level'], true);
  assert.equal('readability' in scores.usability.attributes, false);
  assert.equal(TOPICS[TOPICS.length - 1], 'readability');
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
  assert.equal(describeAttribute('readability', 'reading-level').displayName, 'Reading level');
  assert.equal(describeAttribute('accessibility', 'no-such-thing').displayName, 'no-such-thing');
});

test('html-only audit scores readability and leaves the Lighthouse topics unscored', () => {
  let html = '<!doctype html><html lang="en"><head><title>Parks</title><meta property="og:title" content="Parks"></head>'
    + '<body><main><h1>Parks</h1><p>The park is open all day. Dogs are welcome on a leash. Bring water on hot days.</p></main></body></html>';
  let audit = buildPageAudit({ lhr: null, html });
  let scores = scorePageAudit(audit);
  assert.equal(audit.partial, true);
  for (let topic of ['accessibility', 'usability', 'botability', 'security']) assert.equal(scores[topic].score, null, topic);
  assert.equal(typeof scores.readability.score, 'number');
  assert.equal(scores.usability.attributes.ogtitle, true);
  assert.equal(scores.usability.attributes.ogimage, false);
  assert.equal(scores.botability.attributes.crawlable, true);
});

test('lighthouse categories follow the topics', () => {
  assert.deepEqual(lighthouseCategoriesFor(TOPICS), ['accessibility', 'best-practices', 'seo']);
  assert.deepEqual(lighthouseCategoriesFor(['usability', 'botability', 'security', 'readability']), ['best-practices', 'seo']);
  assert.deepEqual(lighthouseCategoriesFor(['accessibility']), ['accessibility', 'best-practices']);
  assert.deepEqual(lighthouseCategoriesFor(['botability']), ['seo']);
  assert.deepEqual(lighthouseCategoriesFor(['readability']), []);
  assert.deepEqual(lighthouseCategoriesFor([]), []);
});

test('lab performance readings are rounded and never scored', () => {
  let perf = {
    categories: { performance: { score: 0.874 } },
    audits: {
      'first-contentful-paint': { numericValue: 1234.56 },
      'largest-contentful-paint': { numericValue: 2500.4 },
      'cumulative-layout-shift': { numericValue: 0.04567 },
      'total-blocking-time': { numericValue: 12.2 },
      'speed-index': { numericValue: 1500 },
      'server-response-time': { numericValue: 80.5 }
    }
  };
  assert.deepEqual(labPerformance(perf), {
    score: 87,
    'first-contentful-paint': 1235,
    'largest-contentful-paint': 2500,
    'cumulative-layout-shift': 0.046,
    'total-blocking-time': 12,
    'speed-index': 1500,
    'server-response-time': 81
  });
  let empty = labPerformance(lhr);
  assert.equal(empty.score, null);
  assert.equal(empty['largest-contentful-paint'], null);
});
