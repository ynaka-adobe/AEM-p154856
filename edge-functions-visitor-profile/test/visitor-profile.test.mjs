import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleVisitorProfile, visitorProfile } from '../src/visitor-profile.js';

const host = 'suresmile.ynaka-adobe.com';
const path = '/api/visitor-profile';
const hosts = [
  host, 'granddesignrv.xsc.demo.adobe.com', 'xsc-demo.ynaka-adobe.com',
  '3m.ynaka-adobe.com', 'new-demo.example.com', 'another.customer.example',
];
const platform = {
  'x-visitor-profile-host': host,
  'x-visitor-profile-ip': '203.0.113.7',
  'x-visitor-profile-country': 'US',
};
const req = (headers = platform, suffix = '', method = 'GET') => new Request(
  `https://${host}${path}${suffix}`, { method, headers },
);
const geo = { city: 'Example City', region: 'CA', country_name: 'Example Country', latitude: 40, longitude: -70 };
const noLookup = () => assert.fail('must not look up caller-supplied data');
const noStore = (response) => {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('surrogate-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
};

test('only CDN metadata is used, not spoofed forwarding headers or runtime node', async () => {
  const response = handleVisitorProfile(req({
    ...platform, 'fastly-client-ip': '198.51.100.9',
    'x-forwarded-for': '198.51.100.9', 'x-forwarded-host': 'evil.example',
    'x-visitor-profile-region': 'ZZ',
  }), (ip) => {
    assert.equal(ip, platform['x-visitor-profile-ip']);
    return geo;
  });
  assert.equal(response.status, 200);
  noStore(response);
  assert.deepEqual(await response.json(), {
    ip: '203.0.113.7', city: 'Example City', region: 'CA', country: 'US',
    latitude: 40, longitude: -70, source: 'cdn', accuracy: 'approximate IP geolocation',
  });
});

test('unavailable metadata is null, never CDN-node or default location', async () => {
  const response = handleVisitorProfile(req({
    'x-visitor-profile-host': host, 'fastly-client-ip': '198.51.100.9',
    'x-forwarded-for': '198.51.100.9',
  }), noLookup);
  noStore(response);
  assert.deepEqual(await response.json(), {
    ip: null, city: null, region: null, country: null, latitude: null, longitude: null,
    source: 'cdn', accuracy: 'unavailable',
  });
  const missing = handleVisitorProfile(req({}), noLookup);
  assert.equal(missing.status, 503);
  noStore(missing);
});

test('strict IP validation before the platform lookup', async () => {
  for (const ip of ['203.0.113.7', '2001:db8::7', '::ffff:192.0.2.1']) {
    const response = handleVisitorProfile(req({ ...platform, 'x-visitor-profile-ip': ip }), (value) => {
      assert.equal(value, ip);
      return null;
    });
    assert.equal((await response.json()).ip, ip);
  }
  for (const ip of ['999.1.1.1', '1.2.3', '01.2.3.4', ':::', '203.0.113.7, 10.0.0.1', '<script>', 'fe80::1%eth0']) {
    const response = handleVisitorProfile(req({ ...platform, 'x-visitor-profile-ip': ip }), noLookup);
    assert.equal((await response.json()).ip, null);
  }
});

test('country and text sanitization; coordinate pair is finite numeric and in range', () => {
  for (const bad of ['<script>', 'Town\nInjected', '?', '', 'a'.repeat(101), 12]) {
    assert.equal(visitorProfile(null, null, { city: bad }).city, null);
  }
  assert.equal(visitorProfile(null, null, { city: 'a'.repeat(100) }).city.length, 100);
  assert.equal(visitorProfile(null, '??', { country_name: 'Example Country' }).country, 'Example Country');
  for (const coordinates of [
    { latitude: '40', longitude: -70 }, { latitude: 40, longitude: null },
    { latitude: NaN, longitude: -70 }, { latitude: 91, longitude: 10 },
    { latitude: 0, longitude: Infinity }, { latitude: 0, longitude: 181 },
  ]) {
    const body = visitorProfile(null, null, coordinates);
    assert.equal(body.latitude, null);
    assert.equal(body.longitude, null);
    assert.equal(body.accuracy, 'unavailable');
  }
  assert.equal(visitorProfile(null, null, { latitude: 0, longitude: 0 }).latitude, 0);
});

test('region is only an observed subdivision code, never inferred from city or country', () => {
  for (const region of ['CA', 'US-CA', 'JP-13', 'GB-ENG', '01', 'IDF']) {
    assert.equal(visitorProfile(null, 'US', { region }).region, region);
  }
  assert.equal(visitorProfile(null, null, { region: ' CA ' }).region, 'CA');
  for (const region of [null, undefined, '?', '', 'California', '<script>', 'CA\nInjected', 'US-CA-extra', 12]) {
    assert.equal(visitorProfile(null, 'US', { region, city: 'Example City' }).region, null);
  }
  assert.equal(visitorProfile(null, 'US', { city: 'San Francisco' }).region, null);
});

test('no query lookups or writes; all error responses are no-store', () => {
  for (const suffix of ['?ip=198.51.100.9', '?address=94121', '?latitude=40', '?foo=bar']) {
    const response = handleVisitorProfile(req(platform, suffix), noLookup);
    assert.equal(response.status, 400);
    noStore(response);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) {
    const response = handleVisitorProfile(req(platform, '', method), noLookup);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
    noStore(response);
  }
  const missing = handleVisitorProfile(new Request(`https://new-demo.example.com${path}`), noLookup);
  assert.equal(missing.status, 503);
  noStore(missing);
  assert.equal(handleVisitorProfile(new Request(`https://${host}/en-us`), noLookup), null);
  const response = handleVisitorProfile(new Request(`https://${host}${path}/extra`, { headers: platform }), noLookup);
  assert.equal(response.status, 404);
  noStore(response);
});

test('any CDN-served host works through platform metadata, including internal runtime URLs', async () => {
  for (const site of hosts) {
    const headers = { ...platform, 'x-visitor-profile-host': site };
    for (const origin of [`https://${site}`, 'https://internal.example']) {
      const response = handleVisitorProfile(new Request(`${origin}${path}`, { headers }), () => geo);
      assert.equal(response.status, 200);
      noStore(response);
      assert.deepEqual(await response.json(), visitorProfile('203.0.113.7', 'US', geo));
    }
    const missing = handleVisitorProfile(new Request(`https://${site}${path}`, {
      headers: { 'x-forwarded-host': host, 'x-forwarded-for': '198.51.100.9' },
    }), noLookup);
    assert.equal(missing.status, 503);
    noStore(missing);
    for (const other of ['/auth/geo', '/auth/login', '/', '/api/fmc', `${path}/`]) {
      assert.equal(handleVisitorProfile(new Request(`https://${site}${other}`), noLookup), null);
    }
  }
});

test('missing or malformed CDN host metadata never enables geolocation', () => {
  for (const site of [
    '', 'bad host', 'example.com:443', 'example.com,other.example',
    'https://example.com', 'example..com', '-example.com',
    'example-.com', `${'a'.repeat(64)}.example`, 'a'.repeat(254),
  ]) {
    const response = handleVisitorProfile(new Request(`https://${host}${path}`, {
      headers: { ...platform, 'x-visitor-profile-host': site },
    }), noLookup);
    assert.equal(response.status, 503);
    noStore(response);
  }
});

test('successive visitors cannot share state; lookup failure is explicit without logging IP', async () => {
  const first = await handleVisitorProfile(req(), () => geo).json();
  const secondResponse = handleVisitorProfile(new Request(`https://xsc-demo.ynaka-adobe.com${path}`, { headers: {
    ...platform, 'x-visitor-profile-ip': '198.51.100.8',
    'x-visitor-profile-host': 'xsc-demo.ynaka-adobe.com',
    'x-visitor-profile-country': 'CA',
  } }), () => null);
  noStore(secondResponse);
  const second = await secondResponse.json();
  assert.notEqual(second.ip, first.ip);
  assert.equal(second.city, null);
  assert.equal(second.region, null);
  assert.equal(second.latitude, null);
  const original = console.error;
  const messages = [];
  console.error = (message) => messages.push(message);
  try {
    const failed = handleVisitorProfile(req(), () => { throw new Error('203.0.113.7'); });
    assert.equal(failed.status, 503);
    noStore(failed);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].includes('203.0.113.7'), false);
  } finally {
    console.error = original;
  }
});
