'use strict';
const common = require('../common');
const assert = require('assert');

if (common.isWindows) {
  assert.strictEqual(process.initgroups, undefined);
  return;
}

if (!common.isMainThread)
  return;

// Test validation errors
assert.throws(
  () => {
    process.initgroups();
  },
  {
    code: 'ERR_INVALID_ARG_TYPE',
    name: 'TypeError',
  }
);

assert.throws(
  () => {
    process.initgroups('user');
  },
  {
    code: 'ERR_INVALID_ARG_TYPE',
    name: 'TypeError',
  }
);

// Invalid user and group types
[null, true, {}, [], () => {}].forEach((val) => {
  assert.throws(
    () => {
      process.initgroups(val, 1000);
    },
    {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
    }
  );

  assert.throws(
    () => {
      process.initgroups('user', val);
    },
    {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
    }
  );
});

// Test with invalid user (should throw ERR_UNKNOWN_CREDENTIAL)
assert.throws(() => {
  process.initgroups('fhqwhgadshgnsdhjsdbkhsdabkfabkveyb', 1000);
}, {
  code: 'ERR_UNKNOWN_CREDENTIAL',
  message: /User identifier does not exist/
});

// Test with invalid group (should throw ERR_UNKNOWN_CREDENTIAL)
assert.throws(() => {
  process.initgroups('root', 'fhqwhgadshgnsdhjsdbkhsdabkfabkveyb');
}, {
  code: 'ERR_UNKNOWN_CREDENTIAL',
  message: /Group identifier does not exist/
});

// Test with invalid uid (non-existent user)
assert.throws(() => {
  process.initgroups(9999999, 1000);
}, {
  code: 'ERR_UNKNOWN_CREDENTIAL',
  message: /User identifier does not exist/
});
