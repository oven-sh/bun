'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { isOptionLikeValue } = require('../utils.js');

// Basically rejecting values starting with a dash, but run through the interesting possibilities.

test('isOptionLikeValue: when passed plain text then returns false', (t) => {
  t.false(isOptionLikeValue('abc'));
  t.end();
});

test('isOptionLikeValue: when passed digits then returns false', (t) => {
  t.false(isOptionLikeValue(123));
  t.end();
});

test('isOptionLikeValue: when passed empty string then returns false', (t) => {
  t.false(isOptionLikeValue(''));
  t.end();
});

// Special case, used as stdin/stdout et al and not reason to reject
test('isOptionLikeValue: when passed dash then returns false', (t) => {
  t.false(isOptionLikeValue('-'));
  t.end();
});

test('isOptionLikeValue: when passed -- then returns true', (t) => {
  // Not strictly option-like, but is supect
  t.true(isOptionLikeValue('--'));
  t.end();
});

// Supporting undefined so can pass element off end of array without checking
test('isOptionLikeValue: when passed undefined then returns false', (t) => {
  t.false(isOptionLikeValue(undefined));
  t.end();
});

test('isOptionLikeValue: when passed short option then returns true', (t) => {
  t.true(isOptionLikeValue('-a'));
  t.end();
});

test('isOptionLikeValue: when passed short option digit then returns true', (t) => {
  t.true(isOptionLikeValue('-1'));
  t.end();
});

test('isOptionLikeValue: when passed negative number then returns true', (t) => {
  t.true(isOptionLikeValue('-123'));
  t.end();
});

test('isOptionLikeValue: when passed short option group of short option with value then returns true', (t) => {
  t.true(isOptionLikeValue('-abd'));
  t.end();
});

test('isOptionLikeValue: when passed long option then returns true', (t) => {
  t.true(isOptionLikeValue('--foo'));
  t.end();
});

test('isOptionLikeValue: when passed long option with value then returns true', (t) => {
  t.true(isOptionLikeValue('--foo=bar'));
  t.end();
});
