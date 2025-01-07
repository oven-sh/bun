'use strict';
const common = require('../common');
const assert = require('assert');

assert.strictEqual(process.assert(1, 'error'), undefined);
assert.throws(() => {
  process.assert(undefined, 'errorMessage');
}, {
  code: 'ERR_ASSERTION',
  name: 'Error',
  message: 'errorMessage'
});
assert.throws(() => {
  process.assert(false);
}, {
  code: 'ERR_ASSERTION',
  name: 'Error',
  message: 'assertion error'
});
