import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteForHost, DEFAULT_SITE_ONLY_ROUTES, authRouteAllowed } from '../src/sites.js';

test('fmcdealer host resolves to its own origin and public URL', () => {
  const site = siteForHost('fmc-dealer-communications.ynaka-adobe.com');
  assert.equal(site.ORIGIN_HOSTNAME, 'main--fmcdealer-communications--ynaka-adobe.aem.live');
  assert.equal(site.PUBLIC_ORIGIN, 'https://fmc-dealer-communications.ynaka-adobe.com');
  assert.deepEqual(site.guest, {
    codesUrl: 'https://main--fmcdealer-communications--ynaka-adobe.aem.page/internal/access-codes.json',
    root: '/',
    landing: '/access',
  });
  assert.equal(site.siteTokenKey, 'XSC_FMC_DEALER_COMMUNICATIONS_SITE_TOKEN');
});

test('other ynaka-adobe.com subdomains derive origin and public URL from the host', () => {
  const site = siteForHost('acme-demo.ynaka-adobe.com');
  assert.equal(site.ORIGIN_HOSTNAME, 'main--acme-demo--ynaka-adobe.aem.live');
  assert.equal(site.PUBLIC_ORIGIN, 'https://acme-demo.ynaka-adobe.com');
  assert.equal(site.siteTokenKey, 'XSC_ACME_DEMO_SITE_TOKEN');
});

test('hosts outside ynaka-adobe.com are never matched', () => {
  assert.equal(siteForHost('evil.com'), null);
  assert.equal(siteForHost('ynaka-adobe.com.evil.com'), null);
  assert.equal(siteForHost('a.b.ynaka-adobe.com'), null);
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

test('extra sites serve /auth/code only when they opt in to guest codes', () => {
  const optedIn = siteForHost('fmc-dealer-communications.ynaka-adobe.com');
  const other = siteForHost('acme-demo.ynaka-adobe.com');
  assert.equal(authRouteAllowed('/auth/code', optedIn), true);
  assert.equal(authRouteAllowed('/auth/code', other), false);
  assert.equal(authRouteAllowed('/auth/code', null), true);
  assert.equal(authRouteAllowed('/auth/demos', optedIn), false);
  assert.equal(authRouteAllowed('/auth/dm-token', optedIn), false);
  assert.equal(authRouteAllowed('/auth/login', other), true);
});

import { siteForRequest } from '../src/sites.js';

const req = (headers) => ({ headers: new Headers(headers) });

test('siteForRequest prefers forwarded host over the internal URL host', () => {
  const m = siteForRequest(req({ 'x-forwarded-host': 'fmc-dealer-communications.ynaka-adobe.com' }), new URL('https://internal.aem.network/'));
  assert.equal(m.host, 'fmc-dealer-communications.ynaka-adobe.com');
});

test('siteForRequest falls back to the URL host and returns null otherwise', () => {
  assert.ok(siteForRequest(req({}), new URL('https://fmc-dealer-communications.ynaka-adobe.com/x')));
  assert.equal(siteForRequest(req({ host: 'xsc-demo.ynaka-adobe.com' }), new URL('https://x.aem.network/')), null);
});
