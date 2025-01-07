// Flags: --abort-on-uncaught-exception
'use strict';
const common = require('../common');
if (common.isWindows) return; // TODO: BUN https://github.com/oven-sh/bun/issues/12827
const assert = require('assert');

assert.strictEqual(process.hasUncaughtExceptionCaptureCallback(), false);

// This should make the process not crash even though the flag was passed.
process.setUncaughtExceptionCaptureCallback(common.mustCall((err) => {
  assert.strictEqual(err.message, 'foo');
}));
process.on('uncaughtException', common.mustNotCall());
throw new Error('foo');
