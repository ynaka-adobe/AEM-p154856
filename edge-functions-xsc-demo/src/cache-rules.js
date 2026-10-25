/*
 * Cache-Control for a site's code files (blocks, scripts, styles, icons). The origin sends a
 * two hour max-age for them, so a change shows up late in browsers; a site can opt in to a
 * shorter one with `codeCache: { maxAge }` (see sites.js). Pure, so it is unit-tested.
 */
const CODE_PATH = /^\/(blocks|scripts|styles|icons)\//;

/** The header value to send, or null to leave the origin's alone. */
export function codeCacheControl(site, pathname, method, status) {
  const age = site && site.codeCache && site.codeCache.maxAge;
  if (!Number.isInteger(age) || age < 0 || age > 3600) return null;
  if (!['GET', 'HEAD'].includes(String(method).toUpperCase()) || status !== 200) return null;
  if (!CODE_PATH.test(pathname) || pathname.includes('..')) return null;
  return `public, max-age=${age}`;
}
