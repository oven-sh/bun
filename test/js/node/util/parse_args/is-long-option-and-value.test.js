'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { isLongOptionAndValue } = require('../utils.js');

test('isLongOptionAndValue: when passed short option then returns false', (t) => {
  t.false(isLongOptionAndValue('-s'));
  t.end();
});

test('isLongOptionAndValue: when passed short option group then returns false', (t) => {
  t.false(isLongOptionAndValue('-abc'));
  t.end();
});

test('isLongOptionAndValue: when passed lone long option then returns false', (t) => {
  t.false(isLongOptionAndValue('--foo'));
  t.end();
});

test('isLongOptionAndValue: when passed long option and value then returns true', (t) => {
  t.true(isLongOptionAndValue('--foo=bar'));
  t.end();
});

test('isLongOptionAndValue: when passed single character long option and value then returns true', (t) => {
  t.true(isLongOptionAndValue('--f=bar'));
  t.end();
});

test('isLongOptionAndValue: when passed empty string then returns false', (t) => {
  t.false(isLongOptionAndValue(''));
  t.end();
});

test('isLongOptionAndValue: when passed plain text then returns false', (t) => {
  t.false(isLongOptionAndValue('foo'));
  t.end();
});

test('isLongOptionAndValue: when passed single dash then returns false', (t) => {
  t.false(isLongOptionAndValue('-'));
  t.end();
});

test('isLongOptionAndValue: when passed double dash then returns false', (t) => {
  t.false(isLongOptionAndValue('--'));
  t.end();
});

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test('isLongOptionAndValue: when passed arg starting with triple dash and value then returns true', (t) => {
  t.true(isLongOptionAndValue('---foo=bar'));
  t.end();
});

// This is a bit bogus, but simple consistent behaviour: long option follows double dash.
test("isLongOptionAndValue: when passed '--=' then returns false", (t) => {
  t.false(isLongOptionAndValue('--='));
  t.end();
});
