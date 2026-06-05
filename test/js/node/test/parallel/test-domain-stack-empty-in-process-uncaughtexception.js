'use strict';

const common = require('../common');
const domain = require('domain');
const assert = require('assert');

// Note for Bun: skipped on Windows. A handled uncaught exception thrown
// synchronously from the main module leaves the process hanging there
// (pre-existing event loop bug, same one tracked by the
// zeroExitWithUncaughtHandler windows-todo in
// test/js/node/process/process.test.js).
if (common.isWindows) {
  common.skip('handled uncaught exception from the main module hangs on Windows');
}

const d = domain.create();

process.once('uncaughtException', common.mustCall(function onUncaught() {
  assert.strictEqual(
    process.domain, null,
    'Domains stack should be empty in uncaughtException handler ' +
    `but the value of process.domain is ${JSON.stringify(process.domain)}`);
}));

process.on('beforeExit', common.mustCall(function onBeforeExit() {
  assert.strictEqual(
    process.domain, null,
    'Domains stack should be empty in beforeExit handler ' +
    `but the value of process.domain is ${JSON.stringify(process.domain)}`);
}));

d.run(function() {
  throw new Error('boom');
});
