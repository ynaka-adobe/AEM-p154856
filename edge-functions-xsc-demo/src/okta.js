import { CacheOverride } from 'fastly:cache-override';
import {
  b64urlEncode, randomString, sha256, signHS256, verifyHS256, verifyRS256,
} from './jwt.js';
import { subjectAttributes } from './abac.js';

export const SESSION_COOKIE = 'cug_session';
const TX_COOKIE = 'cug_tx';
const IDT_COOKIE = 'cug_idt';
const TX_TTL = 600;
const DEFAULT_SESSION_TTL = 8 * 60 * 60;

const noCache = () => ({ cacheOverride: new CacheOverride('pass') });

let discoveryCache;
let jwksCache;

function issuer(env) {
  return (env.OKTA_ISSUER || '').replace(/\/+$/, '');
}

async function discovery(env) {
  const iss = issuer(env);
  if (discoveryCache?.issuer === iss) return discoveryCache;
  const resp = await fetch(`${iss}/.well-known/openid-configuration`, noCache());
  if (!resp.ok) throw new Error(`Okta discovery failed: ${resp.status}`);
  discoveryCache = await resp.json();
  return discoveryCache;
}

async function jwks(env, forceRefresh = false) {
  const { jwks_uri: uri } = await discovery(env);
  if (!forceRefresh && jwksCache?.uri === uri) return jwksCache.keys;
  const resp = await fetch(uri, noCache());
  if (!resp.ok) throw new Error(`Okta JWKS fetch failed: ${resp.status}`);
  jwksCache = { uri, keys: await resp.json() };
  return jwksCache.keys;
}

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const match = header.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function cookie(name, value, { maxAge, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

const clearCookie = (name, path = '/') => cookie(name, '', { maxAge: 0, path });

/** Only allow same-site relative redirects to prevent open redirects. */
export function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }
  return value;
}

function redirect(location, cookies = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  cookies.forEach((c) => headers.append('set-cookie', c));
  return new Response(null, { status: 302, headers });
}

// Behind the Adobe CDN, req.url may not carry the public host, so use the configured one.
function publicOrigin(env, url) {
  return (env.PUBLIC_ORIGIN || url.origin).replace(/\/+$/, '');
}

function callbackUrl(env, url) {
  return `${publicOrigin(env, url)}/auth/callback`;
}

/** Returns the signed-in user ({ sub, email, name, groups }) or null. */
export async function getSession(request, env) {
  return verifyHS256(getCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
}

/**
 * The user's country for ABAC: a custom claim (default `country`) wins, then
 * the standard OIDC `address.country` (Okta fills it from the profile's
 * countryCode via the `address` scope). `locale` is deliberately ignored: it is
 * a language preference and Okta defaults it to en_US for everyone.
 */
function countryFrom(claims, claimName) {
  const custom = claims && claims[claimName];
  if (typeof custom === 'string' && custom.trim()) return custom.trim();
  const addr = claims && claims.address;
  if (addr && typeof addr.country === 'string' && addr.country.trim()) return addr.country.trim();
  return '';
}

export async function login(request, env) {
  const url = new URL(request.url);
  const config = await discovery(env);
  const state = randomString();
  const nonce = randomString();
  const verifier = randomString(48);
  const challenge = b64urlEncode(await sha256(verifier));
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'));

  const tx = await signHS256({
    state, nonce, verifier, returnTo, exp: Math.floor(Date.now() / 1000) + TX_TTL,
  }, env.SESSION_SECRET);

  const authorize = new URL(config.authorization_endpoint);
  authorize.search = new URLSearchParams({
    client_id: env.OKTA_CLIENT_ID,
    response_type: 'code',
    scope: env.OKTA_SCOPES || 'openid profile email groups address',
    redirect_uri: callbackUrl(env, url),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  return redirect(authorize.href, [cookie(TX_COOKIE, tx, { maxAge: TX_TTL, path: '/auth' })]);
}

async function validateIdToken(idToken, env, nonce) {
  let claims;
  try {
    claims = await verifyRS256(idToken, await jwks(env));
  } catch (e) {
    // signing keys may have rotated: refresh once and retry
    claims = await verifyRS256(idToken, await jwks(env, true));
  }
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuer(env)) throw new Error('id_token issuer mismatch');
  if (!aud.includes(env.OKTA_CLIENT_ID)) throw new Error('id_token audience mismatch');
  if (typeof claims.exp !== 'number' || claims.exp + 60 < now) throw new Error('id_token expired');
  if (claims.nonce !== nonce) throw new Error('id_token nonce mismatch');
  return claims;
}

export async function callback(request, env) {
  const url = new URL(request.url);
  const tx = await verifyHS256(getCookie(request, TX_COOKIE), env.SESSION_SECRET);
  const clearTx = clearCookie(TX_COOKIE, '/auth');

  if (url.searchParams.get('error')) {
    const desc = url.searchParams.get('error_description') || url.searchParams.get('error');
    return new Response(`Okta login failed: ${desc}`, { status: 401, headers: { 'set-cookie': clearTx } });
  }
  if (!tx || tx.state !== url.searchParams.get('state')) {
    return new Response('Login session expired or invalid state. Please try again.', {
      status: 400, headers: { 'set-cookie': clearTx },
    });
  }

  const config = await discovery(env);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: url.searchParams.get('code') || '',
    redirect_uri: callbackUrl(env, url),
    code_verifier: tx.verifier,
    client_id: env.OKTA_CLIENT_ID,
  });
  if (env.OKTA_CLIENT_SECRET) body.set('client_secret', env.OKTA_CLIENT_SECRET);

  const tokenResp = await fetch(config.token_endpoint, {
    ...noCache(),
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  if (!tokenResp.ok) {
    return new Response(`Okta token exchange failed (${tokenResp.status})`, {
      status: 502, headers: { 'set-cookie': clearTx },
    });
  }
  const { id_token: idToken, access_token: accessToken } = await tokenResp.json();

  let claims;
  try {
    claims = await validateIdToken(idToken, env, tx.nonce);
  } catch (e) {
    return new Response(`Invalid Okta id_token: ${e.message}`, {
      status: 401, headers: { 'set-cookie': clearTx },
    });
  }

  const claimName = env.OKTA_GROUPS_CLAIM || 'groups';
  const countryClaim = env.OKTA_COUNTRY_CLAIM || 'country';
  let groupsClaim = claims[claimName];
  let country = countryFrom(claims, countryClaim);
  // Okta can omit groups (and address) from the ID token in the code flow;
  // /userinfo has them.
  if ((!Array.isArray(groupsClaim) || !country) && accessToken && config.userinfo_endpoint) {
    try {
      const info = await fetch(config.userinfo_endpoint, {
        ...noCache(),
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
      if (info.ok) {
        const data = await info.json();
        if (data.sub === claims.sub) {
          if (!Array.isArray(groupsClaim)) groupsClaim = data[claimName];
          if (!country) country = countryFrom(data, countryClaim);
        }
      }
    } catch (e) {
      // keep going without groups / country
    }
  }
  const ttl = Number(env.SESSION_TTL) || DEFAULT_SESSION_TTL;
  const session = await signHS256({
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    groups: Array.isArray(groupsClaim) ? groupsClaim : [],
    // ABAC subject attribute (abac.js); '' when Okta has no country for the user
    country,
    exp: Math.floor(Date.now() / 1000) + ttl,
  }, env.SESSION_SECRET);

  return redirect(tx.returnTo, [
    clearTx,
    cookie(SESSION_COOKIE, session, { maxAge: ttl }),
    // kept only so logout can end the Okta session (Okta requires id_token_hint)
    cookie(IDT_COOKIE, idToken, { maxAge: ttl, path: '/auth' }),
  ]);
}

export async function logout(request, env) {
  const url = new URL(request.url);
  const cookies = [clearCookie(SESSION_COOKIE), clearCookie(IDT_COOKIE, '/auth')];
  const idToken = getCookie(request, IDT_COOKIE);
  const { end_session_endpoint: endSession } = await discovery(env);
  if (!idToken || !endSession) return redirect('/', cookies);

  const target = new URL(endSession);
  target.search = new URLSearchParams({
    id_token_hint: idToken,
    post_logout_redirect_uri: `${publicOrigin(env, url)}/`,
  }).toString();
  return redirect(target.href, cookies);
}

export async function me(request, env) {
  const session = await getSession(request, env);
  const body = session
    ? {
      authenticated: true,
      guest: !!session.guest,
      email: session.email,
      name: session.name,
      groups: session.guest ? (session.demos || []).map((d) => d.customer) : session.groups,
      country: session.country || '',
      attributes: [...subjectAttributes(session)],
      demos: session.demos,
    }
    : { authenticated: false };
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });
}
