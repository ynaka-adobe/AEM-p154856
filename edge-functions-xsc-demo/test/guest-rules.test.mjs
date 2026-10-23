import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guestAllows, normalizePath } from '../src/guest-rules.js';

const guest = (...paths) => ({ guest: true, demos: paths.map((path) => ({ customer: 'x', path })) });

test('normalizePath keeps demos under /customer-demo/ and rejects traversal', () => {
  assert.equal(normalizePath('/customer-demo/fmc-dealer-communications/'), '/customer-demo/fmc-dealer-communications');
  assert.equal(normalizePath('customer-demo/a'), '/customer-demo/a');
  assert.equal(normalizePath('/customer-demo'), null);
  assert.equal(normalizePath('/other/a'), null);
  assert.equal(normalizePath('/customer-demo/../internal'), null);
  assert.equal(normalizePath(''), null);
});

test('a page-scoped guest only sees its own demo', () => {
  const s = guest('/customer-demo/avantor');
  assert.equal(guestAllows(s, '/customer-demo/avantor'), true);
  assert.equal(guestAllows(s, '/customer-demo/avantor/sub'), true);
  assert.equal(guestAllows(s, '/customer-demo/avantor.plain.html'), true);
  assert.equal(guestAllows(s, '/customer-demo/caterpillar'), false);
  assert.equal(guestAllows(s, '/internal/demo-codes'), false);
  assert.equal(guestAllows(s, '/'), false);
});

test('media next to a demo page is allowed for any guest with a demo', () => {
  assert.equal(guestAllows(guest('/customer-demo/avantor'), '/customer-demo/media_1a2b3c.png'), true);
  assert.equal(guestAllows({ guest: true, demos: [] }, '/customer-demo/media_1a2b3c.png'), false);
});

test('a site-root grant (fmc-dealer) allows every path', () => {
  const s = guest('/');
  ['/', '/archive', '/preview', '/blocks/header/header.js'].forEach((p) => assert.equal(guestAllows(s, p), true));
});

test('non-guests and anonymous are never allowed by guest rules', () => {
  assert.equal(guestAllows(null, '/'), false);
  assert.equal(guestAllows({ guest: false, demos: [{ path: '/' }] }, '/'), false);
});
