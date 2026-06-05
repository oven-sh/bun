'use strict';
const common = require('../common');
const assert = require('assert');

// Flags: --pending-deprecation

if (common.isWindows) {
  // Bun: on Windows process.env is a Proxy that coerces values to strings
  // before they reach the native env object, so the DEP0104 deprecation
  // warning is not emitted there yet.
  common.skip('DEP0104 is not emitted on Windows in Bun');
}

common.expectWarning(
  'DeprecationWarning',
  'Assigning any value other than a string, number, or boolean to a ' +
  'process.env property is deprecated. Please make sure to convert the value ' +
  'to a string before setting process.env with it.',
  'DEP0104'
);

// Make sure setting a valid environment variable doesn't
// result in warning being suppressed, see:
// https://github.com/nodejs/node/pull/25157
process.env.FOO = 'apple';
process.env.ABC = undefined;
assert.strictEqual(process.env.ABC, 'undefined');
