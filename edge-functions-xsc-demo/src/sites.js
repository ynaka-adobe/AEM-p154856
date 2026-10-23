/*
 * Per-hostname site settings. The edge function serves several EDS sites that
 * share one Okta app (its redirect URIs use a wildcard, https://*.ynaka-adobe.com)
 * and one session secret. Everything that differs per site lives here.
 *
 * - Hosts in SITES use their explicit EDS origin.
 * - Any other *.ynaka-adobe.com host that cdn.yaml routes to the function uses
 *   the convention main--<subdomain>--ynaka-adobe.aem.live.
 * - xsc-demo and every other host use the defaults from loadEnv().
 *
 * The public origin is always derived from the matched host, never hard-coded.
 */
const DEFAULT_HOST = 'xsc-demo.ynaka-adobe.com';
const WILDCARD = /^([a-z0-9-]+)\.ynaka-adobe\.com$/;

export const SITES = {
  // subdomain differs from the EDS repo name
  'fmc-dealer-communications.ynaka-adobe.com': {
    ORIGIN_HOSTNAME: 'main--fmcdealer-communications--ynaka-adobe.aem.live',
    // guest access codes: a code row in xsc-demo's demo-codes sheet whose path is grantPath
    // unlocks the whole site (root '/'); anonymous visitors are sent to /access to enter it
    guest: { grantPath: '/customer-demo/fmc-dealer-communications', root: '/', landing: '/access' },
  },
};

/** Returns the site overrides for a hostname, or null for the default site. */
export function siteForHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host === DEFAULT_HOST) return null;
  const match = host.match(WILDCARD);
  if (!match) return null;
  const site = SITES[host] || { ORIGIN_HOSTNAME: `main--${match[1]}--ynaka-adobe.aem.live` };
  return {
    ...site,
    PUBLIC_ORIGIN: `https://${host}`,
    // optional per-site aem.live site-authentication token (never reuse xsc-demo's)
    siteTokenKey: `XSC_${match[1].toUpperCase().replace(/-/g, '_')}_SITE_TOKEN`,
    // guest codes only on sites that opt in (above); Dynamic Media tokens are xsc-demo only
    guest: site.guest || null,
  };
}

/** Auth routes that only exist on the default (xsc-demo) site. */
export const DEFAULT_SITE_ONLY_ROUTES = new Set(['/auth/code', '/auth/demos', '/auth/dm-token']);

/** Whether an /auth route is served for a site: extra sites get /auth/code only if they opt in. */
export function authRouteAllowed(pathname, site) {
  if (!site) return true;
  if (pathname === '/auth/code') return !!site.guest;
  return !DEFAULT_SITE_ONLY_ROUTES.has(pathname);
}

/**
 * Finds the site for a request. The CDN may hand the function an internal URL,
 * so check the forwarded/original host headers before the URL's own host.
 */
export function siteForRequest(request, url) {
  const names = ['x-forwarded-host', 'x-original-host', 'host'];
  const candidates = names.map((n) => (request.headers.get(n) || '').split(',')[0].trim().split(':')[0]);
  candidates.push(url.hostname);
  const host = candidates.find((h) => h && siteForHost(h));
  return host ? { host, site: siteForHost(host) } : null;
}
