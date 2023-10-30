'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { findLongOptionForShort } = require('../utils.js');

test('findLongOptionForShort: when passed empty options then returns short', (t) => {
  t.equal(findLongOptionForShort('a', {}), 'a');
  t.end();
});

test('findLongOptionForShort: when passed short not present in options then returns short', (t) => {
  t.equal(findLongOptionForShort('a', { foo: { short: 'f', type: 'string' } }), 'a');
  t.end();
});

test('findLongOptionForShort: when passed short present in options then returns long', (t) => {
  t.equal(findLongOptionForShort('a', { alpha: { short: 'a' } }), 'alpha');
  t.end();
});
