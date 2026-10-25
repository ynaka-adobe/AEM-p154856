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
  // save a draft's form progress (the service stores it in a sheet; no AEM call)
  { method: 'PUT', re: /^\/drafts\/DRAFT-\d{14}-[a-z0-9]{4}$/, write: true },
];

/** Returns { path, write } for an allowed request, or null. path is relative to the API prefix. */
export function matchApi(pathname, method) {
  if (!pathname.startsWith(`${API_PREFIX}/`)) return null;
  const path = pathname.slice(API_PREFIX.length);
  const hit = ROUTES.find((r) => r.method === String(method).toUpperCase() && r.re.test(path));
  return hit ? { path, write: !!hit.write } : null;
}

/** Default policy when a site does not set one: sign-in to read, employees to write. */
export const DEFAULT_ACCESS = { read: 'session', write: 'employee' };

/**
 * Who may call, per site policy `access` = { read, write } where each is one of
 *   'anonymous'  no sign-in needed
 *   'session'    any signed-in session (employees and code-based guests)
 *   'employee'   signed-in employees only (not code-based guests)
 * Anonymous access to writes is bounded by the service itself (see the service's limits).
 * @returns {{ok:true}|{ok:false,status:number,error:string}}
 */
export function authorize(session, route, access = DEFAULT_ACCESS) {
  const level = (route.write ? access.write : access.read) || DEFAULT_ACCESS[route.write ? 'write' : 'read'];
  if (level === 'anonymous') return { ok: true };
  if (!session) return { ok: false, status: 401, error: 'sign in required' };
  if (level === 'employee' && session.guest) return { ok: false, status: 403, error: 'guests cannot create communications' };
  return { ok: true };
}

/** Caller address for the service's per-caller limits; empty when the CDN does not provide it. */
export function clientId(headers) {
  const v = String((headers && headers.get && (headers.get('fastly-client-ip') || headers.get('x-forwarded-for'))) || '').split(',')[0].trim();
  // an address or nothing: never forward anything else as the caller id
  return /^[0-9a-fA-F:.]{2,45}$/.test(v) ? v : '';
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
