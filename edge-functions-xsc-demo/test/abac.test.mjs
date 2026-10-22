import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePolicy, normaliseAttribute, normaliseCountry, parsePolicy, subjectAttributes,
} from '../src/abac.js';

const usUser = { sub: '1', email: 'a@x.com', groups: ['Everyone', 'partners'], country: 'US' };
const jpUser = { sub: '2', email: 'b@x.com', groups: ['Everyone'], country: 'JP' };
const noCountry = { sub: '3', email: 'c@x.com', groups: [] };
const guest = { sub: 'g', guest: true, demos: [{ customer: 'acme' }] };

test('normaliseCountry handles names, codes and locales', () => {
  assert.equal(normaliseCountry('USA'), 'US');
  assert.equal(normaliseCountry('United States'), 'US');
  assert.equal(normaliseCountry('Japan'), 'JP');
  assert.equal(normaliseCountry('jp'), 'JP');
  assert.equal(normaliseCountry('ja_JP'), 'JP');
  assert.equal(normaliseCountry('Narnia'), '');
  assert.equal(normaliseCountry(undefined), '');
});

test('normaliseAttribute classifies tokens', () => {
  assert.equal(normaliseAttribute(' Logged-In '), 'logged-in');
  assert.equal(normaliseAttribute('employees'), 'logged-in');
  assert.equal(normaliseAttribute('USA'), 'country:US');
  assert.equal(normaliseAttribute('Japan'), 'country:JP');
  assert.equal(normaliseAttribute('country:jp'), 'country:JP');
  assert.equal(normaliseAttribute('partners'), 'group:partners');
  assert.equal(normaliseAttribute('de'), 'group:de', 'bare 2-letter tokens stay groups');
  assert.equal(normaliseAttribute('group:usa'), 'group:usa', 'prefix escapes country aliases');
});

test('parsePolicy: comma is AND, pipe is OR, empty is any user', () => {
  assert.deepEqual(parsePolicy('logged-in, USA'), [['logged-in', 'country:US']]);
  assert.deepEqual(parsePolicy('USA | Japan'), [['country:US'], ['country:JP']]);
  assert.deepEqual(parsePolicy(''), [[]]);
  assert.deepEqual(parsePolicy(null), [[]]);
});

test('subjectAttributes', () => {
  assert.deepEqual(
    [...subjectAttributes(usUser)].sort(),
    ['country:US', 'group:everyone', 'group:partners', 'logged-in'],
  );
  assert.equal(subjectAttributes(guest).size, 0, 'guests hold no attributes');
  assert.equal(subjectAttributes(null).size, 0);
});

test('evaluatePolicy: user-requested rows', () => {
  assert.equal(evaluatePolicy(usUser, 'logged-in, USA').allowed, true);
  assert.equal(evaluatePolicy(jpUser, 'logged-in, USA').allowed, false);
  assert.deepEqual(evaluatePolicy(jpUser, 'logged-in, USA').missing, ['country:US']);
  assert.equal(evaluatePolicy(jpUser, 'logged-in, Japan').allowed, true);
  assert.equal(evaluatePolicy(noCountry, 'logged-in, Japan').allowed, false);
});

test('evaluatePolicy: backward compatible with group rows', () => {
  assert.equal(evaluatePolicy(usUser, '').allowed, true, 'empty = any signed-in user');
  assert.equal(evaluatePolicy(noCountry, 'employees').allowed, true);
  assert.equal(evaluatePolicy(usUser, 'partners').allowed, true);
  assert.equal(evaluatePolicy(jpUser, 'partners').allowed, false);
  assert.equal(evaluatePolicy(jpUser, 'partners | Japan').allowed, true);
});

test('evaluatePolicy fails closed for guests and anonymous', () => {
  assert.equal(evaluatePolicy(guest, '').allowed, false);
  assert.equal(evaluatePolicy(guest, 'employees').allowed, false);
  assert.equal(evaluatePolicy(null, '').allowed, false);
});
