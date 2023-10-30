'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { isLoneLongOption } = require('../utils.js');

test('isLoneLongOption: when passed short option then returns false', (t) => {
  t.false(isLoneLongOption('-s'));
  t.end();
});

test('isLoneLongOption: when passed short option group then returns false', (t) => {
  t.false(isLoneLongOption('-abc'));
  t.end();
});

test('isLoneLongOption: when passed lone long option then returns true', (t) => {
  t.true(isLoneLongOption('--foo'));
  t.end();
});

test('isLoneLongOption: when passed single character long option then returns true', (t) => {
  t.true(isLoneLongOption('--f'));
  t.end();
});

test('isLoneLongOption: when passed long option and value then returns false', (t) => {
  t.false(isLoneLongOption('--foo=bar'));
  t.end();
});

test('isLoneLongOption: when passed empty string then returns false', (t) => {
  t.false(isLoneLongOption(''));
  t.end();
});

test('isLoneLongOption: when passed plain text then returns false', (t) => {
  t.false(isLoneLongOption('foo'));
  t.end();
});

test('isLoneLongOption: when passed single dash then returns false', (t) => {
  t.false(isLoneLongOption('-'));
  t.end();
});

test('isLoneLongOption: when passed double dash then returns false', (t) => {
  t.false(isLoneLongOption('--'));
  t.end();
});

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test('isLoneLongOption: when passed arg starting with triple dash then returns true', (t) => {
  t.true(isLoneLongOption('---foo'));
  t.end();
});

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test("isLoneLongOption: when passed '--=' then returns true", (t) => {
  t.true(isLoneLongOption('--='));
  t.end();
});
