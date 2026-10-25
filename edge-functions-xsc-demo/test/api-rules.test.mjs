import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorize, checkWrite, clientId, matchApi, userId, MAX_BODY,
} from '../src/api-rules.js';

test('only the documented routes and methods match', () => {
  assert.deepEqual(matchApi('/api/fmc/communications', 'GET'), { path: '/communications', write: false });
  assert.deepEqual(matchApi('/api/fmc/communications', 'post'), { path: '/communications', write: true });
  assert.ok(matchApi('/api/fmc/communications/EFC260061', 'GET'));
  assert.ok(matchApi('/api/fmc/communications/DRAFT-20261022140000-ab1c/status', 'GET'));
  ['DELETE', 'PUT', 'PATCH'].forEach((m) => assert.equal(matchApi('/api/fmc/communications', m), null));
  assert.equal(matchApi('/api/fmc/communications/EFC1', 'POST'), null);
  assert.equal(matchApi('/api/fmc/other', 'GET'), null);
  assert.equal(matchApi('/api/fmc/', 'GET'), null);
  assert.equal(matchApi('/api/other/communications', 'GET'), null);
});

test('names cannot smuggle path segments or odd characters', () => {
  ['/api/fmc/communications/..', '/api/fmc/communications/a/b/status', '/api/fmc/communications/a%2Fb',
    '/api/fmc/communications/-lead', '/api/fmc/communications/a b', `/api/fmc/communications/${'a'.repeat(65)}`,
    '/api/fmc/communications//status', '/api/fmc/communications/x/status/extra'].forEach((p) => assert.equal(matchApi(p, 'GET'), null, p));
});

test('anonymous is rejected; guests can read but not write', () => {
  const read = matchApi('/api/fmc/communications', 'GET');
  const write = matchApi('/api/fmc/communications', 'POST');
  assert.equal(authorize(null, read).status, 401);
  assert.equal(authorize(null, write).status, 401);
  assert.equal(authorize({ guest: true }, read).ok, true);
  assert.equal(authorize({ guest: true }, write).status, 403);
  assert.equal(authorize({ email: 'a@ford.com' }, write).ok, true);
});

test('user id is the CDSID and is header-safe', () => {
  assert.equal(userId({ email: 'sgorle1@ford.com' }), 'sgorle1');
  assert.equal(userId({ sub: '00u1abc' }), '00u1abc');
  assert.equal(userId({ email: 'bad\r\nx-evil: 1@ford.com' }), 'badx-evil1');
  assert.equal(userId(null), '');
  assert.equal(userId({ email: `${'a'.repeat(100)}@x.com` }).length, 64);
});

test('writes need JSON and a bounded body', () => {
  assert.equal(checkWrite('application/json', 10).ok, true);
  assert.equal(checkWrite('application/json; charset=utf-8', 10).ok, true);
  assert.equal(checkWrite('text/plain', 10).status, 415);
  assert.equal(checkWrite('application/x-www-form-urlencoded', 10).status, 415);
  assert.equal(checkWrite(null, 10).status, 415);
  assert.equal(checkWrite('application/json', MAX_BODY + 1).status, 413);
});

test('per-site policy: anonymous, session or employee for reads and writes', () => {
  const read = matchApi('/api/fmc/communications', 'GET');
  const write = matchApi('/api/fmc/communications', 'POST');
  const open = { read: 'anonymous', write: 'anonymous' };
  assert.equal(authorize(null, read, open).ok, true);
  assert.equal(authorize(null, write, open).ok, true);
  assert.equal(authorize({ guest: true }, write, open).ok, true);

  const readOnly = { read: 'anonymous', write: 'session' };
  assert.equal(authorize(null, read, readOnly).ok, true);
  assert.equal(authorize(null, write, readOnly).status, 401);
  assert.equal(authorize({ guest: true }, write, readOnly).ok, true);

  const strict = { read: 'session', write: 'employee' };
  assert.equal(authorize(null, read, strict).status, 401);
  assert.equal(authorize({ guest: true }, write, strict).status, 403);
  assert.equal(authorize({ email: 'a@ford.com' }, write, strict).ok, true);

  // an unset or unknown level falls back to the strict default rather than opening up
  assert.equal(authorize(null, read, {}).status, 401);
  assert.equal(authorize(null, write, { write: 'whatever' }).status, 401);
});

test('client id comes from the CDN header and is address-safe', () => {
  const h = (o) => new Headers(o);
  assert.equal(clientId(h({ 'fastly-client-ip': '203.0.113.7' })), '203.0.113.7');
  assert.equal(clientId(h({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' })), '198.51.100.2');
  assert.equal(clientId(h({ 'fastly-client-ip': '2001:db8::1' })), '2001:db8::1');
  // a stand-in object can carry characters that a real Headers object would reject
  assert.equal(clientId({ get: () => 'zz198.51.100.2\r\n; x-evil: 1' }), '', 'not an address -> nothing');
  assert.equal(clientId({ get: () => '198.51.100.2\r\nx-evil: 1' }), '');
  assert.equal(clientId({ get: () => 'a'.repeat(100) }), '', 'too long -> nothing');
  assert.equal(clientId({ get: () => '  198.51.100.2  ' }), '198.51.100.2');
  assert.equal(clientId(h({})), '');
  assert.equal(clientId(null), '');
});

test('draft saves: PUT /drafts/{well-formed id} only, and it counts as a write', () => {
  const ok = matchApi('/api/fmc/drafts/DRAFT-20261025101500-ab12', 'PUT');
  assert.deepEqual(ok, { path: '/drafts/DRAFT-20261025101500-ab12', write: true });
  assert.equal(authorize({ guest: true }, ok, { read: 'anonymous', write: 'employee' }).status, 403);
  ['GET', 'POST', 'DELETE'].forEach((m) => assert.equal(matchApi('/api/fmc/drafts/DRAFT-20261025101500-ab12', m), null));
  ['/api/fmc/drafts', '/api/fmc/drafts/', '/api/fmc/drafts/EFC260061', '/api/fmc/drafts/DRAFT-2026-ab12',
    '/api/fmc/drafts/DRAFT-20261025101500-AB12', '/api/fmc/drafts/DRAFT-20261025101500-ab12/x',
    '/api/fmc/drafts/../communications'].forEach((p) => assert.equal(matchApi(p, 'PUT'), null, p));
});
