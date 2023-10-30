'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { isShortOptionAndValue } = require('../utils.js');

test('isShortOptionAndValue: when passed lone short option then returns false', (t) => {
  t.false(isShortOptionAndValue('-s', {}));
  t.end();
});

test('isShortOptionAndValue: when passed group with leading zero-config boolean then returns false', (t) => {
  t.false(isShortOptionAndValue('-ab', {}));
  t.end();
});

test('isShortOptionAndValue: when passed group with leading configured implicit boolean then returns false', (t) => {
  t.false(isShortOptionAndValue('-ab', { aaa: { short: 'a' } }));
  t.end();
});

test('isShortOptionAndValue: when passed group with leading configured explicit boolean then returns false', (t) => {
  t.false(isShortOptionAndValue('-ab', { aaa: { short: 'a', type: 'boolean' } }));
  t.end();
});

test('isShortOptionAndValue: when passed group with leading configured string then returns true', (t) => {
  t.true(isShortOptionAndValue('-ab', { aaa: { short: 'a', type: 'string' } }));
  t.end();
});

test('isShortOptionAndValue: when passed long option then returns false', (t) => {
  t.false(isShortOptionAndValue('--foo', {}));
  t.end();
});

test('isShortOptionAndValue: when passed long option with value then returns false', (t) => {
  t.false(isShortOptionAndValue('--foo=bar', {}));
  t.end();
});

test('isShortOptionAndValue: when passed empty string then returns false', (t) => {
  t.false(isShortOptionAndValue('', {}));
  t.end();
});

test('isShortOptionAndValue: when passed plain text then returns false', (t) => {
  t.false(isShortOptionAndValue('foo', {}));
  t.end();
});

test('isShortOptionAndValue: when passed single dash then returns false', (t) => {
  t.false(isShortOptionAndValue('-', {}));
  t.end();
});

test('isShortOptionAndValue: when passed double dash then returns false', (t) => {
  t.false(isShortOptionAndValue('--', {}));
  t.end();
});
