'use strict';
require('../common');
const assert = require('assert');
const util = require('util');

[
  undefined,
  null,
  false,
  5n,
  5,
  Symbol(),
  () => {},
  {},
].forEach((invalidOption) => {
  assert.throws(() => {
    util.styleText(invalidOption, 'test');
  }, {
    code: 'ERR_INVALID_ARG_VALUE',
  });
  assert.throws(() => {
    util.styleText('red', invalidOption);
  }, {
    code: 'ERR_INVALID_ARG_TYPE'
  });
});

assert.throws(() => {
  util.styleText('invalid', 'text');
}, {
  code: 'ERR_INVALID_ARG_VALUE',
});

// styleText only colorizes when the target stream can show colors.
const raw = { validateStream: false };

assert.strictEqual(util.styleText('red', 'test', raw), '\u001b[31mtest\u001b[39m');

assert.strictEqual(util.styleText(['bold', 'red'], 'test', raw), '\u001b[1m\u001b[31mtest\u001b[39m\u001b[22m');
assert.strictEqual(util.styleText(['bold', 'red'], 'test', raw),
                   util.styleText('bold', util.styleText('red', 'test', raw), raw));

assert.throws(() => {
  util.styleText(['invalid'], 'text');
}, {
  code: 'ERR_INVALID_ARG_VALUE',
});

assert.throws(() => {
  util.styleText('red', 'text', { stream: {} });
}, {
  code: 'ERR_INVALID_ARG_TYPE',
});

// does not throw
util.styleText('red', 'text', { stream: {}, validateStream: false });

assert.strictEqual(util.styleText('none', 'test'), 'test');
