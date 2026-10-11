import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../src/serve.mjs';
import { enumeratePages, fileToUrlPath } from '../src/pages.mjs';

const site = new URL('../fixtures/site', import.meta.url).pathname;

test('enumerates fixture pages root first', async () => {
  assert.deepEqual(await enumeratePages(site), ['/', '/about/']);
});

test('maps files to url paths', () => {
  assert.equal(fileToUrlPath('index.html'), '/');
  assert.equal(fileToUrlPath('about/index.html'), '/about/');
  assert.equal(fileToUrlPath('contact.html'), '/contact.html');
});

test('serves under a base path, 404s elsewhere, blocks traversal', async () => {
  let server = await serve({ dir: site, basePath: '/fixture/' });
  try {
    let ok = await fetch(`${server.origin}/fixture/`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /text\/html/);
    assert.match(await ok.text(), /Example County/);

    assert.equal((await fetch(`${server.origin}/fixture/about`)).status, 200);
    assert.equal((await fetch(`${server.origin}/fixture/robots.txt`)).status, 200);
    assert.equal((await fetch(`${server.origin}/fixture/.well-known/security.txt`)).status, 200);
    assert.equal((await fetch(`${server.origin}/fixture/nope/`)).status, 404);
    assert.equal((await fetch(`${server.origin}/`)).status, 404);
    assert.equal((await fetch(`${server.origin}/fixture/../package.json`)).status, 404);
    let redirect = await fetch(`${server.origin}/fixture`, { redirect: 'manual' });
    assert.equal(redirect.status, 301);
  } finally {
    await server.close();
  }
});
