/*
 * Profile attributes read from Okta ID token / userinfo claims. Pure, so it is unit-tested.
 */

/** A trimmed string claim, or '' when it is missing or not a string. */
export const stringClaim = (claims, name) => (claims && typeof claims[name] === 'string'
  ? claims[name].trim() : '');

/**
 * A custom claim (e.g. `country`) wins, then the standard OIDC `address.<field>`
 * (Okta fills it from the user profile via the `address` scope); '' otherwise.
 */
function addressClaim(claims, claimName, field) {
  const custom = stringClaim(claims, claimName);
  if (custom) return custom;
  const addr = claims && claims.address;
  if (addr && typeof addr[field] === 'string' && addr[field].trim()) return addr[field].trim();
  return '';
}

/**
 * The user's country for ABAC: a custom claim (default `country`), then `address.country`
 * (Okta's profile countryCode). `locale` is deliberately ignored: it is a language
 * preference and Okta defaults it to en_US for everyone.
 */
export const countryFrom = (claims, claimName = 'country') => addressClaim(claims, claimName, 'country');

/** The user's state / region: a custom claim (default `state`), then `address.region`. */
export const stateFrom = (claims, claimName = 'state') => addressClaim(claims, claimName, 'region');
