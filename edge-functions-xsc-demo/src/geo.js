/**
 * Visitor network context for the presenter insights panel: the caller's IP
 * and its IP-based location. Pure helpers so they run under node --test; the
 * Fastly geolocation lookup itself happens in index.js.
 */

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * The browser's address. Behind the Adobe CDN the function's own client is the
 * CDN node, so prefer the address the CDN forwards.
 * @returns {{ip:string, source:string}}
 */
export function callerAddress(headers, clientAddress) {
  const fromHeader = (name) => String((headers && headers.get && headers.get(name)) || '').split(',')[0].trim();
  const candidates = [
    ['fastly-client-ip', fromHeader('fastly-client-ip')],
    ['x-forwarded-for', fromHeader('x-forwarded-for')],
    ['client', String(clientAddress || '')],
  ];
  const hit = candidates.find(([, v]) => IP_RE.test(v));
  return hit ? { ip: hit[1], source: hit[0] } : { ip: '', source: '' };
}

/** A stable JSON shape for the panel; every field may be empty. */
export function describeVisitor({ ip, source }, g) {
  const geo = g || {};
  const v = (x) => (x === null || x === undefined ? '' : x);
  return {
    ip,
    ipSource: source,
    city: v(geo.city),
    region: v(geo.region),
    postalCode: v(geo.postal_code),
    country: v(geo.country_name),
    countryCode: v(geo.country_code),
    continent: v(geo.continent),
    latitude: v(geo.latitude),
    longitude: v(geo.longitude),
    utcOffset: v(geo.utc_offset),
    network: v(geo.as_name),
    asn: v(geo.as_number),
    connection: [geo.conn_type, geo.conn_speed].filter((x) => x && x !== '?').join(' / '),
    proxy: [geo.proxy_type, geo.proxy_description].filter((x) => x && x !== '?').join(' / '),
  };
}
