import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorize, checkWrite, matchApi, userId, MAX_BODY,
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
