import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callerAddress, describeVisitor } from '../src/geo.js';

const headers = (h) => ({ get: (n) => h[n] });

test('prefers the CDN-forwarded address over the function client', () => {
  assert.deepEqual(callerAddress(headers({ 'fastly-client-ip': '203.0.113.9' }), '10.0.0.1'), { ip: '203.0.113.9', source: 'fastly-client-ip' });
  assert.deepEqual(callerAddress(headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.2' }), '10.0.0.1'), { ip: '198.51.100.7', source: 'x-forwarded-for' });
  assert.deepEqual(callerAddress(headers({}), '2001:db8::1'), { ip: '2001:db8::1', source: 'client' });
});

test('ignores anything that is not an address', () => {
  assert.deepEqual(callerAddress(headers({ 'fastly-client-ip': '<script>' }), ''), { ip: '', source: '' });
});

test('maps Fastly geolocation and blanks missing fields', () => {
  const body = describeVisitor({ ip: '203.0.113.9', source: 'client' }, {
    city: 'san jose', region: 'CA', country_name: 'united states', country_code: 'US', as_name: 'example isp', as_number: 64500, conn_type: 'wired', conn_speed: 'broadband', proxy_type: '?', latitude: 37.3, longitude: -121.9, utc_offset: -800,
  });
  assert.equal(body.city, 'san jose');
  assert.equal(body.connection, 'wired / broadband');
  assert.equal(body.proxy, '');
  assert.equal(body.postalCode, '');
  assert.equal(describeVisitor({ ip: '', source: '' }, null).country, '');
});
