/// <reference types="@fastly/js-compute" />
/*
 * AEM Edge Function: xsc-demo-cug
 *
 * Enforces AEM Closed User Groups for xsc-demo.ynaka-adobe.com ONLY, with Okta
 * (OIDC Authorization Code + PKCE). cdn.yaml routes just that domain here.
 *
 * Flow: fetch the page from the EDS origin, read (and always strip) the
 * x-aem-cug-* headers, then serve / redirect to Okta / 401 / 403.
 *
 * Config keys are prefixed XSC_ because the config and secret stores are
 * shared with every other site/function in this program.
 */
import { ConfigStore } from 'fastly:config-store';
import { CacheOverride } from 'fastly:cache-override';
import { SecretStoreManager } from './lib/config.js';
// Generated at build time from .env (gitignored); used when the program has
// no config/secret stores (e.g. sandbox programs).
import BUILD_ENV from './generated/build-env.js';
import {
  callback, getSession, login, logout, me,
} from './okta.js';
import { dmToken } from './dm.js';
import {
  guestAllows, isEmployee, listDemos, redeemCode,
} from './guest.js';
import { describeAttribute, evaluatePolicy, subjectAttributes } from './abac.js';
import { authRouteAllowed, siteForRequest } from './sites.js';
import { codeCacheControl } from './cache-rules.js';
import {
  API_PREFIX, authorize, checkWrite, clientId, matchApi, userId,
} from './api-rules.js';

const CUG_REQUIRED_HEADER = 'x-aem-cug-required';
const CUG_GROUPS_HEADER = 'x-aem-cug-groups';
const CUG_LOGIN_PATH_HEADER = 'x-aem-cug-login-path';
const DEFAULT_ORIGIN = 'main--xsc-demo--ynaka-adobe.aem.live';
const DEFAULT_PUBLIC_ORIGIN = 'https://xsc-demo.ynaka-adobe.com';
const DEFAULT_OKTA_ISSUER = 'https://trial-5076725.okta.com';
const DEFAULT_OKTA_CLIENT_ID = '0oa18l1budg5m7Fnh698';
const DEFAULT_CODES_URL = 'https://main--xsc-demo--ynaka-adobe.aem.page/internal/demo-codes.json';

async function optionalSecret(key) {
  try {
    return await SecretStoreManager.getSecret(key);
  } catch (e) {
    return BUILD_ENV[key];
  }
}

async function loadEnv() {
  let config;
  try {
    config = new ConfigStore('config_default');
  } catch (e) {
    config = { get: () => null };
  }
  const get = (key) => config.get(key) || BUILD_ENV[key] || undefined;
  return {
    ORIGIN_HOSTNAME: get('XSC_ORIGIN_HOSTNAME') || DEFAULT_ORIGIN,
    PUBLIC_ORIGIN: get('XSC_PUBLIC_ORIGIN') || DEFAULT_PUBLIC_ORIGIN,
    OKTA_ISSUER: get('XSC_OKTA_ISSUER') || DEFAULT_OKTA_ISSUER,
    OKTA_CLIENT_ID: get('XSC_OKTA_CLIENT_ID') || DEFAULT_OKTA_CLIENT_ID,
    OKTA_SCOPES: get('XSC_OKTA_SCOPES'),
    OKTA_GROUPS_CLAIM: get('XSC_OKTA_GROUPS_CLAIM'),
    OKTA_COUNTRY_CLAIM: get('XSC_OKTA_COUNTRY_CLAIM'),
    OKTA_COMPANY_CLAIM: get('XSC_OKTA_COMPANY_CLAIM'),
    SESSION_TTL: get('XSC_SESSION_TTL'),
    OKTA_CLIENT_SECRET: await optionalSecret('XSC_OKTA_CLIENT_SECRET'),
    SESSION_SECRET: await optionalSecret('XSC_SESSION_SECRET'),
    DM_DELIVERY: get('XSC_DM_DELIVERY'),
    DM_CLIENT_ID: get('XSC_DM_CLIENT_ID'),
    DM_SCOPE: get('XSC_DM_SCOPE'),
    DM_TOKEN_TTL: get('XSC_DM_TOKEN_TTL'),
    DM_CLIENT_SECRET: await optionalSecret('XSC_DM_CLIENT_SECRET'),
    SITE_TOKEN: await optionalSecret('XSC_SITE_TOKEN'),
    CODES_URL: get('XSC_CODES_URL') || DEFAULT_CODES_URL,
  };
}

const isNavigation = (request) => request.method === 'GET'
  && (request.headers.get('accept') || '').includes('text/html');

function loginRedirect(url, loginPath) {
  const returnTo = `${url.pathname}${url.search}`;
  let location;
  if (loginPath && /^https?:\/\//i.test(loginPath)) {
    location = loginPath;
  } else {
    const path = loginPath && loginPath.startsWith('/') ? loginPath : '/auth/login';
    location = `${path}${path.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(returnTo)}`;
  }
  return new Response(null, {
    status: 302,
    headers: { location, 'cache-control': 'no-store' },
  });
}

const escapeHtml = (v) => String(v).replace(/[<>&"']/g, '');

function forbidden(session, missing = []) {
  const who = escapeHtml(session.email || session.name || session.sub || '');
  const held = [...subjectAttributes(session)].map(describeAttribute);
  const list = (attrs) => (attrs.length ? attrs.map((a) => `<code>${escapeHtml(a)}</code>`).join(', ') : 'none');
  const html = session.guest ? `<!doctype html><html><head><meta charset="utf-8"><title>Access denied</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}</style></head>
<body><h1>Not part of your demo</h1><p>Your access code doesn't include this page.</p>
<p><a href="/customer-demo">Enter another code</a> · <a href="/auth/logout">Sign out</a></p></body></html>` : `<!doctype html><html><head><meta charset="utf-8"><title>Access denied</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}</style></head>
<body><h1>Access denied</h1><p>You are signed in as <strong>${who}</strong>, but your account does not have the attributes this page requires.</p>
<p>Missing: ${list(missing.map(describeAttribute))}<br>Your attributes: ${list(held)}</p>
<p><a href="/">Home</a> · <a href="/auth/logout">Sign out</a></p></body></html>`;
  return new Response(html, {
    status: 403,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

async function handleAuthRoute(request, env, url) {
  const missing = [['XSC_OKTA_ISSUER', env.OKTA_ISSUER], ['XSC_OKTA_CLIENT_ID', env.OKTA_CLIENT_ID],
    ['XSC_SESSION_SECRET', env.SESSION_SECRET], ['XSC_OKTA_CLIENT_SECRET', env.OKTA_CLIENT_SECRET]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.some((k) => k !== 'XSC_OKTA_CLIENT_SECRET')) {
    return new Response(`Okta is not configured, missing: ${missing.join(', ')}`, { status: 500 });
  }
  if (!authRouteAllowed(url.pathname, env.SITE)) {
    return new Response('Not Found', { status: 404 });
  }
  switch (url.pathname) {
    case '/auth/login': return login(request, env);
    case '/auth/callback': return callback(request, env);
    case '/auth/logout': return logout(request, env);
    case '/auth/me': return me(request, env);
    case '/auth/dm-token': {
      const session = await getSession(request, env);
      return dmToken(isEmployee(session) ? session : null, env);
    }
    case '/auth/code': return redeemCode(request, env);
    case '/auth/demos': return listDemos(request, env);
    default: return new Response('Not Found', { status: 404 });
  }
}

async function proxyWithCug(request, env, url) {
  const originUrl = `https://${env.ORIGIN_HOSTNAME}${url.pathname}${url.search}`;
  const headers = new Headers(request.headers);
  // never forward visitor session cookies to the origin
  headers.delete('cookie');
  headers.delete('host');
  headers.set('x-forwarded-host', new URL(env.PUBLIC_ORIGIN).host);
  // aem.live site authentication: origin rejects requests without the site token
  if (env.SITE_TOKEN) headers.set('authorization', `token ${env.SITE_TOKEN}`);
  else headers.delete('authorization');
  const originResp = await fetch(originUrl, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    // always fetch fresh: enforcement must see the current CUG headers and content
    cacheOverride: new CacheOverride('pass'),
  });

  const respHeaders = new Headers(originResp.headers);
  const cugRequired = respHeaders.get(CUG_REQUIRED_HEADER) === 'true';
  // ABAC policy: attributes from the sheet's Groups column (see abac.js)
  const policy = respHeaders.get(CUG_GROUPS_HEADER) || '';
  const loginPath = respHeaders.get(CUG_LOGIN_PATH_HEADER);
  respHeaders.delete(CUG_REQUIRED_HEADER);
  respHeaders.delete(CUG_GROUPS_HEADER);
  respHeaders.delete(CUG_LOGIN_PATH_HEADER);

  if (cugRequired) {
    const session = env.SESSION_SECRET ? await getSession(request, env) : null;
    if (!session) {
      if (isNavigation(request)) return loginRedirect(url, loginPath);
      return new Response('Unauthorized', { status: 401, headers: { 'cache-control': 'no-store' } });
    }
    const decision = evaluatePolicy(session, policy);
    if (!decision.allowed && !guestAllows(session, url.pathname)) {
      return forbidden(session, decision.missing);
    }
    respHeaders.set('cache-control', 'private, no-store');
  }

  respHeaders.delete('age');
  const codeCache = codeCacheControl(env.SITE, url.pathname, request.method, originResp.status);
  if (codeCache) respHeaders.set('cache-control', codeCache);
  return new Response(originResp.body, { status: originResp.status, headers: respHeaders });
}

/** /api/fmc: authenticate, then forward to the communications service with the shared secret. */
async function handleApi(request, env, url) {
  const json = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });
  if (!env.API) return json(404, { error: 'not found' });
  const route = matchApi(url.pathname, request.method);
  if (!route) return json(404, { error: 'not found' });
  const session = env.SESSION_SECRET ? await getSession(request, env) : null;
  const allowed = authorize(session, route, env.API.access);
  if (!allowed.ok) return json(allowed.status, { error: allowed.error });
  if (!env.API_SECRET) return json(503, { error: 'service not configured' });

  let body;
  if (route.write) {
    const text = await request.text();
    const checked = checkWrite(request.headers.get('content-type'), text.length);
    if (!checked.ok) return json(checked.status, { error: checked.error });
    body = text;
  }
  const headers = {
    'x-fmc-key': env.API_SECRET,
    'x-fmc-user': userId(session),
    'x-fmc-client': clientId(request.headers),
    accept: 'application/json',
  };
  if (route.write) headers['content-type'] = 'application/json';
  try {
    const upstream = await fetch(`${env.API.upstream}${route.path}${url.search}`, {
      method: request.method, headers, body, cacheOverride: new CacheOverride('pass'),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
    });
  } catch (e) {
    console.error(`fmc api upstream error: ${e && e.message}`);
    return json(502, { error: 'upstream error' });
  }
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  try {
    const env = await loadEnv();
    const match = siteForRequest(request, url);
    if (match) {
      const { site } = match;
      env.ORIGIN_HOSTNAME = site.ORIGIN_HOSTNAME;
      env.PUBLIC_ORIGIN = site.PUBLIC_ORIGIN;
      env.SITE = site;
      env.GUEST = site.guest;
      env.API = site.api;
      env.API_SECRET = site.api ? await optionalSecret(site.api.secretKey) : undefined;
      // never send another site's origin credentials: use this site's own token, if any
      env.SITE_TOKEN = site.siteTokenKey ? await optionalSecret(site.siteTokenKey) : undefined;
    }
    if (url.pathname.startsWith('/auth/')) return await handleAuthRoute(request, env, url);
    if (url.pathname.startsWith(`${API_PREFIX}/`)) return await handleApi(request, env, url);
    return await proxyWithCug(request, env, url);
  } catch (e) {
    console.error(`xsc-demo-cug error: ${e && e.message}`);
    return new Response('Edge function error', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}

addEventListener('fetch', (event) => event.respondWith(handleRequest(event.request)));
