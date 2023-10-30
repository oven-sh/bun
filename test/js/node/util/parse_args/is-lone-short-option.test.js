'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { isLoneShortOption } = require('../utils.js');

test('isLoneShortOption: when passed short option then returns true', (t) => {
  t.true(isLoneShortOption('-s'));
  t.end();
});

test('isLoneShortOption: when passed short option group (or might be short and value) then returns false', (t) => {
  t.false(isLoneShortOption('-abc'));
  t.end();
});

test('isLoneShortOption: when passed long option then returns false', (t) => {
  t.false(isLoneShortOption('--foo'));
  t.end();
});

test('isLoneShortOption: when passed long option with value then returns false', (t) => {
  t.false(isLoneShortOption('--foo=bar'));
  t.end();
});

test('isLoneShortOption: when passed empty string then returns false', (t) => {
  t.false(isLoneShortOption(''));
  t.end();
});

test('isLoneShortOption: when passed plain text then returns false', (t) => {
  t.false(isLoneShortOption('foo'));
  t.end();
});

test('isLoneShortOption: when passed single dash then returns false', (t) => {
  t.false(isLoneShortOption('-'));
  t.end();
});

test('isLoneShortOption: when passed double dash then returns false', (t) => {
  t.false(isLoneShortOption('--'));
  t.end();
});
