'use strict';
// Flags: --expose-internals

const common = require('../common');
common.skip('skipped because it tests a node internal irrelevant to bun');
const assert = require('assert');
const fixtures = require('../common/fixtures');
const { internalBinding } = require('internal/test/binding');

const {
  privateSymbols: {
    arrow_message_private_symbol,
  },
} = internalBinding('util');

const obj = {};
assert.strictEqual(obj[arrow_message_private_symbol], undefined);

obj[arrow_message_private_symbol] = 'bar';
assert.strictEqual(obj[arrow_message_private_symbol], 'bar');
assert.deepStrictEqual(Reflect.ownKeys(obj), []);

let arrowMessage;

try {
  require(fixtures.path('syntax', 'bad_syntax'));
} catch (err) {
  arrowMessage = err[arrow_message_private_symbol];
}

assert.match(arrowMessage, /bad_syntax\.js:1/);
