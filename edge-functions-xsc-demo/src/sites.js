/*
 * Per-hostname site settings. The edge function serves several EDS sites that
 * share one Okta app and one session secret; everything that differs per
 * site (origin, public URL, origin credentials, guest-code support) lives here.
 *
 * Hosts not listed fall back to the xsc-demo defaults from loadEnv().
 */
export const SITES = {
  'fmcdealer.ynaka-adobe.com': {
    ORIGIN_HOSTNAME: 'main--fmcdealer-communications--ynaka-adobe.aem.live',
    PUBLIC_ORIGIN: 'https://fmcdealer.ynaka-adobe.com',
    // optional per-site aem.live site-authentication token (never reuse xsc-demo's)
    siteTokenKey: 'XSC_FMCDEALER_SITE_TOKEN',
    // xsc-demo-only features: guest access codes and Dynamic Media tokens
    guestCodes: false,
  },
};

/** Returns the site overrides for a hostname, or null for the default site. */
export function siteForHost(hostname) {
  return SITES[String(hostname || '').toLowerCase()] || null;
}

/** Auth routes that only exist on the default (xsc-demo) site. */
export const DEFAULT_SITE_ONLY_ROUTES = new Set(['/auth/code', '/auth/demos', '/auth/dm-token']);

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
