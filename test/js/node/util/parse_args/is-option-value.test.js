'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { isOptionValue } = require('../utils.js');

// Options are greedy so simple behaviour, but run through the interesting possibilities.

test('isOptionValue: when passed plain text then returns true', (t) => {
  t.true(isOptionValue('abc'));
  t.end();
});

test('isOptionValue: when passed digits then returns true', (t) => {
  t.true(isOptionValue(123));
  t.end();
});

test('isOptionValue: when passed empty string then returns true', (t) => {
  t.true(isOptionValue(''));
  t.end();
});

// Special case, used as stdin/stdout et al and not reason to reject
test('isOptionValue: when passed dash then returns true', (t) => {
  t.true(isOptionValue('-'));
  t.end();
});

test('isOptionValue: when passed -- then returns true', (t) => {
  t.true(isOptionValue('--'));
  t.end();
});

// Checking undefined so can pass element off end of array.
test('isOptionValue: when passed undefined then returns false', (t) => {
  t.false(isOptionValue(undefined));
  t.end();
});

test('isOptionValue: when passed short option then returns true', (t) => {
  t.true(isOptionValue('-a'));
  t.end();
});

test('isOptionValue: when passed short option digit then returns true', (t) => {
  t.true(isOptionValue('-1'));
  t.end();
});

test('isOptionValue: when passed negative number then returns true', (t) => {
  t.true(isOptionValue('-123'));
  t.end();
});

test('isOptionValue: when passed short option group of short option with value then returns true', (t) => {
  t.true(isOptionValue('-abd'));
  t.end();
});

test('isOptionValue: when passed long option then returns true', (t) => {
  t.true(isOptionValue('--foo'));
  t.end();
});

test('isOptionValue: when passed long option with value then returns true', (t) => {
  t.true(isOptionValue('--foo=bar'));
  t.end();
});
