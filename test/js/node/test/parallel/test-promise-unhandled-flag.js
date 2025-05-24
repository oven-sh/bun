'use strict';
// Test modified because bun's error message has a capital letter

require('../common');
const assert = require('assert');
const cp = require('child_process');

// Verify that a faulty environment variable throws on bootstrapping.
// Therefore we do not need any special handling for the child process.
const child = cp.spawnSync(
  process.execPath,
  ['--unhandled-rejections=foobar', __filename]
);

assert.strictEqual(child.stdout.toString(), '');
assert(child.stderr.includes(
  (typeof Bun === "undefined" ? "i" : "I") +
  'nvalid value for --unhandled-rejections'), child.stderr);
