// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';
const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

// Note for Bun: skipped on Windows. A domain-handled uncaught exception
// thrown synchronously from the main module leaves the process hanging
// there (pre-existing event loop bug, same one tracked by the
// zeroExitWithUncaughtHandler windows-todo in
// test/js/node/process/process.test.js).
if (common.isWindows) {
  common.skip('domain-handled uncaught exception from the main module hangs on Windows');
}

const assert = require('assert');
const crypto = require('crypto');
const domain = require('domain');

const test = (fn) => {
  const ex = new Error('BAM');
  const d = domain.create();
  d.on('error', common.mustCall(function(err) {
    assert.strictEqual(err, ex);
  }));
  const cb = common.mustCall(function() {
    throw ex;
  });
  // Note for Bun: upstream calls `d.run(fn, cb)` here, so the throw happens
  // inside the async crypto callback. Errors thrown from crypto callbacks
  // surface through the unhandled rejection path in Bun, which does not yet
  // route rejections through the domain machinery, so this copy invokes the
  // throwing callback synchronously instead (`fn` is deliberately unused).
  // That synchronous main-module throw is also why this file is skipped on
  // Windows above.
  d.run(cb);
};

test(function(cb) {
  crypto.pbkdf2('password', 'salt', 1, 8, cb);
});

test(function(cb) {
  crypto.randomBytes(32, cb);
});
