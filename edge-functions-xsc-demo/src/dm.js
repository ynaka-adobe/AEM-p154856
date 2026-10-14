/*
 * Dynamic Media secure delivery tokens for the signed-in Okta user.
 *
 * GET /auth/dm-token -> { token: "sd:...", expiryTime, delivery, groups }
 *
 * 1. OAuth Server-to-Server (tech account, AEM admin) -> IMS access token
 * 2. POST {delivery}/adobe/assets/token with the user's Okta groups
 * Assets whose `accessgroups` metadata matches one of the groups are then
 * deliverable with ?token=sd:...; others return 404.
 */
import { CacheOverride } from 'fastly:cache-override';

const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const DEFAULT_DELIVERY = 'https://delivery-p154856-e1944736.adobeaemcloud.com';
const DEFAULT_TTL = 900;

const noCache = () => ({ cacheOverride: new CacheOverride('pass') });

let imsCache;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
});

async function imsToken(env) {
  if (imsCache && imsCache.expires > Date.now() + 60_000) return imsCache.token;
  const resp = await fetch(IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.DM_CLIENT_ID,
      client_secret: env.DM_CLIENT_SECRET,
      scope: (env.DM_SCOPE || '').replace(/\s+/g, ''),
    }).toString(),
    ...noCache(),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) throw new Error(`IMS token failed: ${resp.status} ${data.error || ''}`);
  imsCache = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return imsCache.token;
}

/** Mints a delivery token for `session` (from getSession). */
export async function dmToken(session, env) {
  if (!session) return json({ error: 'not signed in' }, 401);
  if (!env.DM_CLIENT_ID || !env.DM_CLIENT_SECRET) {
    return json({ error: 'Dynamic Media tech account is not configured' }, 500);
  }
  const delivery = (env.DM_DELIVERY || DEFAULT_DELIVERY).replace(/\/+$/, '');
  const groups = session.groups || [];
  const resp = await fetch(`${delivery}/adobe/assets/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await imsToken(env)}`,
    },
    body: JSON.stringify({
      subjectAttributes: {
        id: session.sub,
        username: session.email || session.sub,
        groups,
        additionalAttributes: {},
      },
      validFor: Number(env.DM_TOKEN_TTL) || DEFAULT_TTL,
    }),
    ...noCache(),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.token) {
    if (resp.status === 401 || resp.status === 403) imsCache = undefined;
    return json({ error: `token API ${resp.status}`, detail: data.detail }, 502);
  }
  const token = data.token.startsWith('sd:') ? data.token : `sd:${data.token}`;
  return json({
    token, expiryTime: data.expiryTime, delivery, groups,
  });
}
