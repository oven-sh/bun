'use strict';

const common = require('../common');
const fixtures = require('../common/fixtures');
const assert = require('assert');
const execFile = require('child_process').execFile;
const warnmod = require.resolve(fixtures.path('warnings.js'));
const node = process.execPath;

const normal = [warnmod];
const noWarn = ['--no-warnings', warnmod];
const traceWarn = ['--trace-warnings', warnmod];

const warningMessage = /^\(.+\)\sWarning: a bad practice warning/;

execFile(node, normal, common.mustCall((er, stdout, stderr) => {
  // Show Process Warnings
  assert.strictEqual(er, null);
  assert.strictEqual(stdout, '');
  assert.match(stderr, warningMessage);
}));

execFile(node, noWarn, common.mustCall((er, stdout, stderr) => {
  // Hide Process Warnings
  assert.strictEqual(er, null);
  assert.strictEqual(stdout, '');
  assert.doesNotMatch(stderr, warningMessage);
}));

execFile(node, traceWarn, common.mustCall((er, stdout, stderr) => {
  // Show Warning Trace
  assert.strictEqual(er, null);
  assert.strictEqual(stdout, '');
  assert.match(stderr, warningMessage);
  // Bun's stack frames have no V8-style "Object.<anonymous>" receiver prefix.
  assert.match(stderr, /at .+warnings\.js:3:9/);
}));
