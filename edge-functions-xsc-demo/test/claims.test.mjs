import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countryFrom, stateFrom } from '../src/claims.js';

test('state comes from a custom claim first, then address.region', () => {
  assert.equal(stateFrom({ state: ' CA ', address: { region: 'NY' } }), 'CA');
  assert.equal(stateFrom({ address: { region: ' Ontario ' } }), 'Ontario');
  assert.equal(stateFrom({ st: 'TX', address: { region: 'NY' } }, 'st'), 'TX');
});

test('state is empty when missing or not a string', () => {
  assert.equal(stateFrom({}), '');
  assert.equal(stateFrom(null), '');
  assert.equal(stateFrom({ state: 5, address: { region: '' } }), '');
});

test('country keeps custom claim, then address.country', () => {
  assert.equal(countryFrom({ country: 'JP', address: { country: 'US' } }), 'JP');
  assert.equal(countryFrom({ address: { country: 'US', region: 'CA' } }), 'US');
  assert.equal(countryFrom({ locale: 'en_US' }), '');
});
