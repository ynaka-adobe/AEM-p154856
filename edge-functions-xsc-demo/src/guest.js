/*
 * Guest access codes for customer demos.
 *
 * Codes live in an employee-only DA sheet (default /internal/demo-codes.json),
 * read from the site-token-protected preview origin, so codes never need to be
 * published. Columns: code | customer | path | expires (YYYY-MM-DD, optional) | notes.
 *
 * A valid code adds { customer, path } to a guest session. Guests may read
 * anything under their granted path(s) inside /customer-demo/. Employees
 * (anyone signed in through the IdP) see every demo and the full code list.
 */
import { CacheOverride } from 'fastly:cache-override';
import { signHS256 } from './jwt.js';
import { getSession, safeReturnTo, SESSION_COOKIE } from './okta.js';
import { guestAllows, normalizePath } from './guest-rules.js';

export { guestAllows };

const LANDING_PATH = '/customer-demo';
const DEFAULT_GUEST_TTL = 8 * 60 * 60;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
});

function redirect(location, cookies = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  cookies.forEach((c) => headers.append('set-cookie', c));
  return new Response(null, { status: 303, headers });
}

const sessionCookie = (value, maxAge) => `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const isEmployee = (session) => !!session && !session.guest;

const normalizeCode = (c) => String(c || '').trim().toUpperCase();

/** End of the expiry day (UTC), in epoch seconds; null when there is no expiry. */
function expiresAt(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59Z` : v);
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}

export async function loadCodes(env) {
  // a site with its own guest settings reads its own sheet, whose rows grant the site root
  const resp = await fetch(env.GUEST?.codesUrl || env.CODES_URL, {
    headers: env.SITE_TOKEN ? { authorization: `token ${env.SITE_TOKEN}` } : {},
    cacheOverride: new CacheOverride('pass'),
  });
  if (!resp.ok) throw new Error(`demo codes fetch failed: ${resp.status}`);
  const sheet = await resp.json();
  const now = Math.floor(Date.now() / 1000);
  return (sheet.data || []).map((row) => {
    const exp = expiresAt(row.expires);
    return {
      code: normalizeCode(row.code),
      customer: String(row.customer || '').trim(),
      path: env.GUEST ? env.GUEST.root : normalizePath(row.path),
      expires: String(row.expires || '').trim(),
      exp,
      active: exp === null || exp > now,
      notes: String(row.notes || '').trim(),
    };
  }).filter((r) => r.code && r.path);
}

/** POST /auth/code (form: code, returnTo) */
export async function redeemCode(request, env) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const form = new URLSearchParams(await request.text());
  const code = normalizeCode(form.get('code'));
  const returnTo = safeReturnTo(form.get('returnTo') || '');
  const guest = env.GUEST || null; // per-site settings, see sites.js
  const landing = guest ? guest.landing : LANDING_PATH;
  const back = (error) => redirect(`${landing}?error=${error}${returnTo !== '/' ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`);
  if (!code) return back('missing');

  const match = (await loadCodes(env)).find((r) => r.code === code);
  if (!match) return back('invalid');
  if (!match.active) return back('expired');

  const current = await getSession(request, env);
  const grantPath = guest ? guest.root : match.path;
  if (isEmployee(current)) return redirect(grantPath);

  const now = Math.floor(Date.now() / 1000);
  const demos = (current?.demos || []).filter((d) => d.path !== grantPath);
  demos.push({ customer: match.customer, path: grantPath });
  const ttl = Number(env.SESSION_TTL) || DEFAULT_GUEST_TTL;
  const exp = Math.min(now + ttl, match.exp || Infinity, current?.exp || Infinity);
  const session = await signHS256({
    sub: 'guest',
    name: `Guest · ${demos.map((d) => d.customer).join(', ')}`,
    guest: true,
    demos,
    groups: [],
    exp,
  }, env.SESSION_SECRET);

  const target = returnTo !== '/' && guestAllows({ guest: true, demos }, returnTo.split('?')[0])
    ? returnTo : grantPath;
  return redirect(target, [sessionCookie(session, Math.max(exp - now, 60))]);
}

/** GET /auth/demos: every demo + code for employees, granted demos for guests. */
export async function listDemos(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ role: 'anonymous', demos: [] });
  if (session.guest) return json({ role: 'guest', demos: session.demos || [] });
  const rows = await loadCodes(env);
  return json({
    role: 'employee',
    demos: rows.map(({
      code, customer, path, expires, active, notes,
    }) => ({
      code, customer, path, expires, active, notes,
    })),
  });
}
