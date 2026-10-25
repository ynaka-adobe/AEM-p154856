/*
 * Pure guest-access rules (no runtime imports, so they can be unit-tested).
 *
 * A guest session holds demos: [{ customer, path }]. On xsc-demo each path is one
 * /customer-demo/<name> page. A site that sets `guest.root` (e.g. '/' for the
 * fmc-dealer app) grants the whole site instead.
 */
export const GUEST_ROOT = '/customer-demo/';

/** Demo paths are restricted to /customer-demo/<name> with no trailing slash. */
export function normalizePath(p, root = GUEST_ROOT) {
  const path = `/${String(p || '').trim().replace(/^\/+|\/+$/g, '')}`;
  if (!path.startsWith(root) || path.includes('..') || path.length <= root.length) return null;
  return path;
}

/** Paths a site-root guest grant never covers (employee-only content such as the code sheet). */
const ROOT_GRANT_DENY = /^\/internal(\/|\.|$)/;

/** True when a guest session grants the request path. */
export function guestAllows(session, pathname) {
  if (!session?.guest) return false;
  const demos = session.demos || [];
  // media (media_<hash>.*) is stored next to the page and has unguessable names
  if (/^\/customer-demo\/(.+\/)?media_[0-9a-f]+\.[a-z0-9]+$/i.test(pathname)) return demos.length > 0;
  return demos.some(({ path }) => (path === '/' && !ROOT_GRANT_DENY.test(pathname))
    || pathname === path || pathname.startsWith(`${path}/`) || pathname.startsWith(`${path}.`));
}
