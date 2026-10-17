import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateSite, sampleLighthousePages } from '../src/pages.mjs';

const site = new URL('../fixtures/site', import.meta.url).pathname;

test('files that are not HTML documents are skipped, and reported', async () => {
  let { pages, skipped } = await enumerateSite(site);
  assert.deepEqual(pages, ['/', '/about/']);
  assert.deepEqual(skipped, ['/google1234567890abcdef.html']);
});

const TREE = [
  '/', '/contact.html', '/privacy.html',
  '/features/', '/features/a/', '/features/b/', '/features/c/',
  '/news/', '/news/2026-01-post/', '/news/2026-02-post/',
  '/people/', '/people/jane/',
  '/press/',
  '/tools/alpha/', '/tools/beta/'
];

test('sample: homepage, then landing pages by section size, then first inner pages', () => {
  assert.deepEqual(sampleLighthousePages(TREE, { max: 100 }), [
    '/', '/features/', '/news/', '/people/', '/tools/alpha/', '/press/',
    '/contact.html', '/features/a/', '/news/2026-01-post/', '/people/jane/', '/tools/beta/'
  ]);
});

test('sample: the cap cuts the ordered list, so small samples still start with landing pages', () => {
  assert.deepEqual(sampleLighthousePages(TREE, { max: 4 }), ['/', '/features/', '/news/', '/people/']);
  assert.deepEqual(sampleLighthousePages(TREE, { max: 1 }), ['/']);
});

test('sample: a section without an index page uses its first page as the landing page', () => {
  assert.deepEqual(sampleLighthousePages(['/', '/docs/intro/', '/docs/setup/'], { max: 3 }), ['/', '/docs/intro/', '/docs/setup/']);
});

test('sample: the same tree always gives the same sample', () => {
  let shuffled = [...TREE].reverse();
  assert.deepEqual(sampleLighthousePages(shuffled, { max: 6 }), sampleLighthousePages(TREE, { max: 6 }));
});
