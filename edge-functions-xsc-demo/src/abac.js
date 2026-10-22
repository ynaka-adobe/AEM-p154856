/*
 * Attribute-based access control (ABAC) for xsc-demo Closed User Groups.
 *
 * The site's closed-user-groups sheet lists *attributes* in the Groups column
 * instead of plain group names, e.g.
 *
 *   /members/usa/**    logged-in, USA
 *   /members/japan/**  logged-in, Japan
 *
 * AEM delivers that cell verbatim as the `x-aem-cug-groups` response header.
 * This module turns the header into a policy and the signed-in session into a
 * set of subject attributes, then decides. It is pure (no Fastly imports) so it
 * can be unit-tested with `node --test`.
 *
 * Semantics:
 *   - attributes within one rule are ANDed:   `logged-in, USA`
 *   - `|` separates alternative rules (OR):   `employees | partners`
 *   - an empty header means any signed-in IdP user
 *
 * Backward compatible with the earlier group model: a single group name
 * (`partners`, `cat-dealers-a`) or the `employees` keyword behaves as before.
 */

// ─── Vocabulary ─────────────────────────────────────────────────────────────

/** Anyone authenticated through the IdP (Okta). Guests never hold it. */
export const ATTR_LOGGED_IN = 'logged-in';
/** Legacy CUG keyword, equivalent to `logged-in`. */
export const ATTR_EMPLOYEES = 'employees';

const COUNTRY_PREFIX = 'country:';
const GROUP_PREFIX = 'group:';

/**
 * Country names and codes authors are likely to type, mapped to ISO 3166-1
 * alpha-2. Anything else that looks like a 2-letter code is used as-is.
 */
const COUNTRY_ALIASES = {
  us: 'US',
  usa: 'US',
  'united states': 'US',
  'united states of america': 'US',
  america: 'US',
  jp: 'JP',
  jpn: 'JP',
  japan: 'JP',
  uk: 'GB',
  gb: 'GB',
  'united kingdom': 'GB',
  de: 'DE',
  germany: 'DE',
  fr: 'FR',
  france: 'FR',
  ca: 'CA',
  canada: 'CA',
  in: 'IN',
  india: 'IN',
  au: 'AU',
  australia: 'AU',
  cn: 'CN',
  china: 'CN',
  kr: 'KR',
  korea: 'KR',
  'south korea': 'KR',
  mx: 'MX',
  mexico: 'MX',
  br: 'BR',
  brazil: 'BR',
};

/**
 * Normalises a country name, alias or code to ISO alpha-2, or '' when the
 * value is not recognisable as a country. Locale tags (`en-US`, `ja_JP`)
 * resolve to their region.
 */
export function normaliseCountry(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim().toLowerCase();
  if (!v) return '';
  if (COUNTRY_ALIASES[v]) return COUNTRY_ALIASES[v];
  const locale = v.match(/^[a-z]{2,3}[-_]([a-z]{2})$/);
  if (locale) return locale[1].toUpperCase();
  return '';
}

// ─── Policy (from the x-aem-cug-groups header) ──────────────────────────────

/**
 * Classifies one authored token. Explicit prefixes win; otherwise known
 * keywords, then country names, and finally a plain group name.
 * Returns a canonical string such as `logged-in`, `country:US`, `group:partners`.
 */
export function normaliseAttribute(token) {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return '';
  if (t === ATTR_LOGGED_IN || t === ATTR_EMPLOYEES) return ATTR_LOGGED_IN;
  if (t.startsWith(COUNTRY_PREFIX)) {
    const c = normaliseCountry(t.slice(COUNTRY_PREFIX.length))
      || t.slice(COUNTRY_PREFIX.length).trim().toUpperCase();
    return c ? `${COUNTRY_PREFIX}${c}` : '';
  }
  if (t.startsWith(GROUP_PREFIX)) {
    const g = t.slice(GROUP_PREFIX.length).trim();
    return g ? `${GROUP_PREFIX}${g}` : '';
  }
  // Only full names/aliases count as countries here; bare 2-letter tokens are
  // treated as group names so an unprefixed `in` or `de` group is not misread.
  const country = COUNTRY_ALIASES[t] && t.length > 2 ? COUNTRY_ALIASES[t] : '';
  if (country) return `${COUNTRY_PREFIX}${country}`;
  return `${GROUP_PREFIX}${t}`;
}

/**
 * Parses the header into alternative rules (OR), each a list of required
 * attributes (AND). An empty/absent header yields `[[]]`: one rule with no
 * requirements, i.e. any signed-in IdP user.
 */
export function parsePolicy(header) {
  const rules = String(header || '')
    .split('|')
    .map((rule) => rule.split(',').map(normaliseAttribute).filter(Boolean))
    .filter((rule) => rule.length > 0);
  return rules.length ? rules : [[]];
}

// ─── Subject (from the signed session) ──────────────────────────────────────

/**
 * Attributes the visitor holds. Guests (access-code visitors) hold none: they
 * are authorised only by their redeemed demo paths (see guest.js), which keeps
 * every attribute-protected folder closed to them.
 */
export function subjectAttributes(session) {
  const attrs = new Set();
  if (!session || session.guest) return attrs;
  attrs.add(ATTR_LOGGED_IN);
  const country = normaliseCountry(session.country);
  if (country) attrs.add(`${COUNTRY_PREFIX}${country}`);
  (Array.isArray(session.groups) ? session.groups : []).forEach((g) => {
    if (typeof g === 'string' && g.trim()) attrs.add(`${GROUP_PREFIX}${g.trim().toLowerCase()}`);
  });
  return attrs;
}

// ─── Decision ───────────────────────────────────────────────────────────────

/**
 * Fail-closed decision. Requires an IdP session; then any one rule must be
 * fully satisfied. Returns `{ allowed, missing }` where `missing` lists the
 * unmet attributes of the closest rule, for the 403 page.
 */
export function evaluatePolicy(session, header) {
  const subject = subjectAttributes(session);
  if (!subject.has(ATTR_LOGGED_IN)) return { allowed: false, missing: [ATTR_LOGGED_IN] };
  let closest = null;
  for (const rule of parsePolicy(header)) {
    const missing = rule.filter((a) => !subject.has(a));
    if (missing.length === 0) return { allowed: true, missing: [] };
    if (!closest || missing.length < closest.length) closest = missing;
  }
  return { allowed: false, missing: closest || [] };
}

/** Human-readable form of a canonical attribute (`country:US` → `country US`). */
export const describeAttribute = (attr) => attr.replace(':', ' ');
