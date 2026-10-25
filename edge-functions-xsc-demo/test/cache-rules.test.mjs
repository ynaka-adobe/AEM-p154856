import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeCacheControl } from '../src/cache-rules.js';
import { siteForHost } from '../src/sites.js';

const site = { codeCache: { maxAge: 15 } };

test('code files get the site max-age; everything else keeps the origin header', () => {
  for (const p of ['/scripts/scripts.js', '/blocks/communications/communications.js', '/styles/styles.css', '/icons/x.svg']) {
    assert.equal(codeCacheControl(site, p, 'GET', 200), 'public, max-age=15', p);
  }
  assert.equal(codeCacheControl(site, '/scripts/scripts.js', 'HEAD', 200), 'public, max-age=15');
  for (const p of ['/', '/archive', '/data/archive.json', '/pdfs/x.pdf', '/scriptsx/a.js', '/api/fmc/communications']) {
    assert.equal(codeCacheControl(site, p, 'GET', 200), null, p);
  }
});

test('only successful GET and HEAD responses are touched', () => {
  assert.equal(codeCacheControl(site, '/scripts/a.js', 'POST', 200), null);
  assert.equal(codeCacheControl(site, '/scripts/a.js', 'GET', 404), null);
  assert.equal(codeCacheControl(site, '/scripts/a.js', 'GET', 304), null);
});

test('sites without the setting, or with a bad one, are unchanged', () => {
  assert.equal(codeCacheControl(null, '/scripts/a.js', 'GET', 200), null);
  assert.equal(codeCacheControl({}, '/scripts/a.js', 'GET', 200), null);
  for (const maxAge of [-1, 1.5, '15', 99999, null]) assert.equal(codeCacheControl({ codeCache: { maxAge } }, '/scripts/a.js', 'GET', 200), null);
});

test('only the FMC site opts in', () => {
  assert.deepEqual(siteForHost('fmc-dealer-communications.ynaka-adobe.com').codeCache, { maxAge: 15 });
  assert.equal(siteForHost('acme-demo.ynaka-adobe.com').codeCache, null);
});
