'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { isShortOptionGroup } = require('../utils.js');

test('isShortOptionGroup: when passed lone short option then returns false', (t) => {
  t.false(isShortOptionGroup('-s', {}));
  t.end();
});

test('isShortOptionGroup: when passed group with leading zero-config boolean then returns true', (t) => {
  t.true(isShortOptionGroup('-ab', {}));
  t.end();
});

test('isShortOptionGroup: when passed group with leading configured implicit boolean then returns true', (t) => {
  t.true(isShortOptionGroup('-ab', { aaa: { short: 'a' } }));
  t.end();
});

test('isShortOptionGroup: when passed group with leading configured explicit boolean then returns true', (t) => {
  t.true(isShortOptionGroup('-ab', { aaa: { short: 'a', type: 'boolean' } }));
  t.end();
});

test('isShortOptionGroup: when passed group with leading configured string then returns false', (t) => {
  t.false(isShortOptionGroup('-ab', { aaa: { short: 'a', type: 'string' } }));
  t.end();
});

test('isShortOptionGroup: when passed group with trailing configured string then returns true', (t) => {
  t.true(isShortOptionGroup('-ab', { bbb: { short: 'b', type: 'string' } }));
  t.end();
});

// This one is dubious, but leave it to caller to handle.
test('isShortOptionGroup: when passed group with middle configured string then returns true', (t) => {
  t.true(isShortOptionGroup('-abc', { bbb: { short: 'b', type: 'string' } }));
  t.end();
});

test('isShortOptionGroup: when passed long option then returns false', (t) => {
  t.false(isShortOptionGroup('--foo', {}));
  t.end();
});

test('isShortOptionGroup: when passed long option with value then returns false', (t) => {
  t.false(isShortOptionGroup('--foo=bar', {}));
  t.end();
});

test('isShortOptionGroup: when passed empty string then returns false', (t) => {
  t.false(isShortOptionGroup('', {}));
  t.end();
});

test('isShortOptionGroup: when passed plain text then returns false', (t) => {
  t.false(isShortOptionGroup('foo', {}));
  t.end();
});

test('isShortOptionGroup: when passed single dash then returns false', (t) => {
  t.false(isShortOptionGroup('-', {}));
  t.end();
});

test('isShortOptionGroup: when passed double dash then returns false', (t) => {
  t.false(isShortOptionGroup('--', {}));
  t.end();
});
