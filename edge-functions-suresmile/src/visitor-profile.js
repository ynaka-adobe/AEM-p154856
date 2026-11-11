const HOST = 'suresmile.ynaka-adobe.com';
const PATH = '/api/visitor-profile';
const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store',
  'surrogate-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function validIp(value) {
  if (typeof value !== 'string' || value.length > 45) return null;
  if (/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) {
    return value.split('.').every((part) => Number(part) <= 255) ? value : null;
  }
  if (!value.includes(':') || !/^[\da-f:.]+$/i.test(value)) return null;
  try {
    return new URL(`http://[${value}]/`).hostname.startsWith('[') ? value : null;
  } catch {
    return null;
  }
}

function text(value) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean !== '?' && clean.length <= 120
    && !/[\u0000-\u001f\u007f<>&]/.test(clean) ? clean : null;
}

function countryCode(value) {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : null;
}

function regionCode(value) {
  const code = text(value);
  return code && /^(?:[A-Za-z]{2}-)?[A-Za-z0-9]{1,3}$/.test(code) ? code : null;
}

export function visitorProfile(ip, country, geo) {
  const latitude = geo?.latitude;
  const longitude = geo?.longitude;
  const coordinates = typeof latitude === 'number' && Number.isFinite(latitude)
    && Math.abs(latitude) <= 90 && typeof longitude === 'number'
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
  return {
    ip,
    city: text(geo?.city),
    region: regionCode(geo?.region),
    country: countryCode(country) || text(geo?.country_name),
    latitude: coordinates ? latitude : null,
    longitude: coordinates ? longitude : null,
    source: 'cdn',
    accuracy: coordinates ? 'approximate IP geolocation' : 'unavailable',
  };
}

// Only the CDN-overwritten headers identify a visitor; never use XFF,
// Fastly-Client-IP, query parameters, or the function's CDN-node client.
export function handleVisitorProfile(request, lookup) {
  const url = new URL(request.url);
  const host = request.headers.get('x-suresmile-profile-host');
  if (host !== HOST) {
    if (url.hostname !== HOST || url.pathname !== PATH) return null;
    return new Response(JSON.stringify({ error: 'CDN visitor metadata unavailable' }), {
      status: 503, headers: HEADERS,
    });
  }
  if (url.pathname !== PATH) {
    return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: HEADERS });
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405, headers: { ...HEADERS, allow: 'GET' },
    });
  }
  if (url.search) {
    return new Response(JSON.stringify({ error: 'Query parameters are not supported' }), {
      status: 400, headers: HEADERS,
    });
  }
  const ip = validIp(request.headers.get('x-suresmile-profile-ip'));
  const country = countryCode(request.headers.get('x-suresmile-profile-country'));
  let geo = null;
  if (ip) {
    try {
      geo = lookup(ip);
    } catch {
      // Do not log the address or runtime error (which may contain it).
      console.error('suresmile visitor profile: platform geolocation lookup failed');
      return new Response(JSON.stringify({ error: 'Platform geolocation unavailable' }), {
        status: 503, headers: HEADERS,
      });
    }
  }
  return new Response(JSON.stringify(visitorProfile(ip, country, geo)), { headers: HEADERS });
}
