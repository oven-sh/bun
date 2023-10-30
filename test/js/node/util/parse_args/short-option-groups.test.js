'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { parseArgs } = require('../index.js');

test('when pass zero-config group of booleans then parsed as booleans', (t) => {
  const args = ['-rf', 'p'];
  const options = { };
  const expected = { values: { __proto__: null, r: true, f: true }, positionals: ['p'] };

  const result = parseArgs({ strict: false, args, options });

  t.deepEqual(result, expected);
  t.end();
});

test('when pass full-config group of booleans then parsed as booleans', (t) => {
  const args = ['-rf', 'p'];
  const options = { r: { type: 'boolean' }, f: { type: 'boolean' } };
  const expected = { values: { __proto__: null, r: true, f: true }, positionals: ['p'] };

  const result = parseArgs({ allowPositionals: true, args, options });

  t.deepEqual(result, expected);
  t.end();
});

test('when pass group with string option on end then parsed as booleans and string option', (t) => {
  const args = ['-rf', 'p'];
  const options = { r: { type: 'boolean' }, f: { type: 'string' } };
  const expected = { values: { __proto__: null, r: true, f: 'p' }, positionals: [] };

  const result = parseArgs({ args, options });

  t.deepEqual(result, expected);
  t.end();
});

test('when pass group with string option in middle and strict:false then parsed as booleans and string option with trailing value', (t) => {
  const args = ['-afb', 'p'];
  const options = { f: { type: 'string' } };
  const expected = { values: { __proto__: null, a: true, f: 'b' }, positionals: ['p'] };

  const result = parseArgs({ args, options, strict: false });

  t.deepEqual(result, expected);
  t.end();
});
