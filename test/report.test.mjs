import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeReports } from '../src/report.mjs';

function page(overrides) {
  return {
    path: '/',
    status: 'ok',
    audit: 'html',
    performance: false,
    scores: { readability: { attributes: { 'reading-level': false }, all: 1, correct: 0, score: 0 } },
    readability: { ari: 11.2 },
    lab: null,
    ...overrides
  };
}

async function render(data) {
  let dir = await mkdtemp(path.join(tmpdir(), 'scangov-report-'));
  await writeReports(dir, { basePath: '/', lighthouseVersion: '13.5.0', result: { outcome: 'clean', findings: 0, failOn: [], blocking: false }, ...data });
  return readFile(path.join(dir, 'scangov.md'), 'utf8');
}

test('report shows only the requested topics and says which were left out', async () => {
  let md = await render({ topics: ['readability'], pages: [page({})] });
  assert.match(md, /\| Page \| Audit \| Readability \|/);
  assert.doesNotMatch(md, /Accessibility \|/);
  assert.match(md, /Topics not run, by request: Accessibility, Usability, Botability, Security\./);
  assert.match(md, /Every page was checked from its HTML/);
  assert.doesNotMatch(md, /Lighthouse ran on a sample/);
  assert.match(md, /ARI grade 11\.2/);
});

test('report lists lab performance without scoring it', async () => {
  let lab = { score: 91, 'first-contentful-paint': 900, 'largest-contentful-paint': 1400, 'cumulative-layout-shift': 0.02, 'total-blocking-time': 0, 'speed-index': 1000, 'server-response-time': 40 };
  let md = await render({ topics: ['readability'], pages: [page({ performance: true, lab })] });
  assert.match(md, /### Lab performance/);
  assert.match(md, /\| `\/` \| 91 \| 900 ms \| 1400 ms \| 0\.02 \| 0 ms \| 1000 ms \| 40 ms \|/);
  assert.match(md, /HTML \+ performance/);
  assert.match(md, /performance category ran on 1\./);
});

test('report with every topic keeps the sample note', async () => {
  let scores = Object.fromEntries(['accessibility', 'usability', 'botability', 'security', 'readability'].map(t => [t, { attributes: {}, all: 0, correct: 0, score: null }]));
  let md = await render({ lighthouseSample: 10, pages: [page({ audit: 'lighthouse', scores }), page({ path: '/about/', scores })] });
  assert.match(md, /Lighthouse 13\.5\.0 ran on 1 of them; the other 1 were checked from their HTML/);
  assert.match(md, /Lighthouse ran on a sample/);
  assert.doesNotMatch(md, /Topics not run/);
});

test('performance-only report has the lab table and no topic table', async () => {
  let lab = { score: 75, 'first-contentful-paint': 1800, 'largest-contentful-paint': 2600, 'cumulative-layout-shift': 0.1, 'total-blocking-time': 150, 'speed-index': 2000, 'server-response-time': 120 };
  let md = await render({ topics: [], pages: [page({ path: '/login/', performance: true, lab, scores: {} })] });
  assert.match(md, /No ScanGov topics run, by request: lab performance only\./);
  assert.match(md, /Checked 1 page\(s\) from `\/`\. The Lighthouse 13\.5\.0 performance category ran on 1\./);
  assert.doesNotMatch(md, /checked from its HTML/);
  assert.doesNotMatch(md, /\| Page \| Audit \|/);
  assert.match(md, /### Lab performance/);
  assert.match(md, /\| `\/login\/` \| 75 \|/);
  assert.doesNotMatch(md, /Not scored here because the host decides them/);
});
