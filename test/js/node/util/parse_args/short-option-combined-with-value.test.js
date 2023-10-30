'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { parseArgs } = require('../index.js');

test('when combine string short with plain text then parsed as value', (t) => {
  const args = ['-aHELLO'];
  const options = { alpha: { short: 'a', type: 'string' } };
  const expected = { values: { __proto__: null, alpha: 'HELLO' }, positionals: [] };

  const result = parseArgs({ args, options });

  t.deepEqual(result, expected);
  t.end();
});

test('when combine low-config string short with plain text then parsed as value', (t) => {
  const args = ['-aHELLO'];
  const options = { a: { type: 'string' } };
  const expected = { values: { __proto__: null, a: 'HELLO' }, positionals: [] };

  const result = parseArgs({ args, options });

  t.deepEqual(result, expected);
  t.end();
});

test('when combine string short with value like short option then parsed as value', (t) => {
  const args = ['-a-b'];
  const options = { alpha: { short: 'a', type: 'string' } };
  const expected = { values: { __proto__: null, alpha: '-b' }, positionals: [] };

  const result = parseArgs({ args, options });

  t.deepEqual(result, expected);
  t.end();
});

test('when combine string short with value like long option then parsed as value', (t) => {
  const args = ['-a--bar'];
  const options = { alpha: { short: 'a', type: 'string' } };
  const expected = { values: { __proto__: null, alpha: '--bar' }, positionals: [] };

  const result = parseArgs({ args, options });

  t.deepEqual(result, expected);
  t.end();
});

test('when combine string short with value like negative number then parsed as value', (t) => {
  const args = ['-a-5'];
  const options = { alpha: { short: 'a', type: 'string' } };
  const expected = { values: { __proto__: null, alpha: '-5' }, positionals: [] };

  const result = parseArgs({ args, options });

  t.deepEqual(result, expected);
  t.end();
});


test('when combine string short with value which matches configured flag then parsed as value', (t) => {
  const args = ['-af'];
  const options = { alpha: { short: 'a', type: 'string' }, file: { short: 'f', type: 'boolean' } };
  const expected = { values: { __proto__: null, alpha: 'f' }, positionals: [] };
  const result = parseArgs({ args, options });

  t.deepEqual(result, expected);
  t.end();
});

test('when combine string short with value including equals then parsed with equals in value', (t) => {
  const args = ['-a=5'];
  const options = { alpha: { short: 'a', type: 'string' } };
  const expected = { values: { __proto__: null, alpha: '=5' }, positionals: [] };

  const result = parseArgs({ args, options });

  t.deepEqual(result, expected);
  t.end();
});
