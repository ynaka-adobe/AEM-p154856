/*
 * Pure rules for the /api/fmc proxy (no runtime imports, so they are unit-tested).
 *
 * The browser calls /api/fmc/communications... on the site's own origin; the edge function
 * checks the session, then forwards to the communications service (an App Builder action)
 * with a shared secret and the signed-in user. Only the routes below exist.
 */
export const API_PREFIX = '/api/fmc';
export const MAX_BODY = 256 * 1024;

const NAME = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
const ROUTES = [
  { method: 'GET', re: /^\/communications$/ },
  { method: 'POST', re: /^\/communications$/, write: true },
  { method: 'GET', re: new RegExp(`^/communications/${NAME}$`) },
  { method: 'GET', re: new RegExp(`^/communications/${NAME}/status$`) },
];

/** Returns { path, write } for an allowed request, or null. path is relative to the API prefix. */
export function matchApi(pathname, method) {
  if (!pathname.startsWith(`${API_PREFIX}/`)) return null;
  const path = pathname.slice(API_PREFIX.length);
  const hit = ROUTES.find((r) => r.method === String(method).toUpperCase() && r.re.test(path));
  return hit ? { path, write: !!hit.write } : null;
}

/**
 * Who may call: any signed-in session may read; only employees (not code-based guests) may write.
 * @returns {{ok:true}|{ok:false,status:number,error:string}}
 */
export function authorize(session, route) {
  if (!session) return { ok: false, status: 401, error: 'sign in required' };
  if (route.write && session.guest) return { ok: false, status: 403, error: 'guests cannot create communications' };
  return { ok: true };
}

/** A short, header-safe user id for the service: the CDSID (email local part) or subject. */
export function userId(session) {
  const raw = String((session && (session.email || session.sub)) || '').split('@')[0];
  return raw.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
}

/** True when a write request can be forwarded: JSON content type and a body within the limit. */
export function checkWrite(contentType, length) {
  if (!/^application\/json\b/i.test(String(contentType || ''))) return { ok: false, status: 415, error: 'content-type must be application/json' };
  if (length > MAX_BODY) return { ok: false, status: 413, error: 'request too large' };
  return { ok: true };
}
