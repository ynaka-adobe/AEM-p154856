import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteForHost, DEFAULT_SITE_ONLY_ROUTES } from '../src/sites.js';

test('fmcdealer host resolves to its own origin and public URL', () => {
  const site = siteForHost('fmcdealer.ynaka-adobe.com');
  assert.equal(site.ORIGIN_HOSTNAME, 'main--fmcdealer-communications--ynaka-adobe.aem.live');
  assert.equal(site.PUBLIC_ORIGIN, 'https://fmcdealer.ynaka-adobe.com');
  assert.equal(site.guestCodes, false);
});

test('host matching is case-insensitive', () => {
  assert.ok(siteForHost('FMCDealer.ynaka-adobe.com'));
});

test('xsc-demo and unknown hosts use the default site', () => {
  assert.equal(siteForHost('xsc-demo.ynaka-adobe.com'), null);
  assert.equal(siteForHost('example.com'), null);
  assert.equal(siteForHost(undefined), null);
});

test('guest-code and DM routes are default-site only', () => {
  ['/auth/code', '/auth/demos', '/auth/dm-token'].forEach((r) => assert.ok(DEFAULT_SITE_ONLY_ROUTES.has(r)));
  assert.ok(!DEFAULT_SITE_ONLY_ROUTES.has('/auth/login'));
});

import { siteForRequest } from '../src/sites.js';

const req = (headers) => ({ headers: new Headers(headers) });

test('siteForRequest prefers forwarded host over the internal URL host', () => {
  const m = siteForRequest(req({ 'x-forwarded-host': 'fmcdealer.ynaka-adobe.com' }), new URL('https://internal.aem.network/'));
  assert.equal(m.host, 'fmcdealer.ynaka-adobe.com');
});

test('siteForRequest falls back to the URL host and returns null otherwise', () => {
  assert.ok(siteForRequest(req({}), new URL('https://fmcdealer.ynaka-adobe.com/x')));
  assert.equal(siteForRequest(req({ host: 'xsc-demo.ynaka-adobe.com' }), new URL('https://x.aem.network/')), null);
});
