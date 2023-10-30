'use strict';
/* eslint max-len: 0 */

const test = require('tape');
const { parseArgs } = require('../index.js');


// Rationale
//
// John Gee:
// - Looks like a boolean option, stored like a boolean option.
// - Looks like a string option, stored like a string option.
// No loss of information. No new pattern to learn in result.
//
// Jordan Harband: In other words, the way they're stored matches the intention of the user,
// not the configurer, which will ensure the configurer can most accurately respond to the
// user's intentions.

test('when use string short option used as boolean then result as if boolean', (t) => {
  const args = ['-o'];
  const stringOptions = { opt: { short: 'o', type: 'string' } };
  const booleanOptions = { opt: { short: 'o', type: 'boolean' } };

  const stringConfigResult = parseArgs({ args, options: stringOptions, strict: false });
  const booleanConfigResult = parseArgs({ args, options: booleanOptions, strict: false });

  t.deepEqual(stringConfigResult, booleanConfigResult);
  t.end();
});

test('when use string long option used as boolean then result as if boolean', (t) => {
  const args = ['--opt'];
  const stringOptions = { opt: { short: 'o', type: 'string' } };
  const booleanOptions = { opt: { short: 'o', type: 'boolean' } };

  const stringConfigResult = parseArgs({ args, options: stringOptions, strict: false });
  const booleanConfigResult = parseArgs({ args, options: booleanOptions, strict: false });

  t.deepEqual(stringConfigResult, booleanConfigResult);
  t.end();
});

test('when use boolean long option used as string then result as if string', (t) => {
  const args = ['--bool=OOPS'];
  const stringOptions = { bool: { type: 'string' } };
  const booleanOptions = { bool: { type: 'boolean' } };

  const stringConfigResult = parseArgs({ args, options: stringOptions, strict: false });
  const booleanConfigResult = parseArgs({ args, options: booleanOptions, strict: false });

  t.deepEqual(booleanConfigResult, stringConfigResult);
  t.end();
});
