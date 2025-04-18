// This test is modified to not test node internals, only public APIs. windowsHide is not observable,
// so this only tests that the flag does not cause an error.

'use strict';
const common = require('../common');
const assert = require('assert');
const cp = require('child_process');
const { test } = require('node:test');
const cmd = process.execPath;
const args = ['-p', '42'];
const options = { windowsHide: true };

test('spawnSync() passes windowsHide correctly', (t) => {
  const child = cp.spawnSync(cmd, args, options);

  assert.strictEqual(child.status, 0);
  assert.strictEqual(child.signal, null);
  assert.strictEqual(child.stdout.toString().trim(), '42');
  assert.strictEqual(child.stderr.toString().trim(), '');
});

test('spawn() passes windowsHide correctly', (t, done) => {
  const child = cp.spawn(cmd, args, options);

  child.on('exit', common.mustCall((code, signal) => {
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
    done();
  }));
});

test('execFile() passes windowsHide correctly', (t, done) => {
  cp.execFile(cmd, args, options, common.mustSucceed((stdout, stderr) => {
    assert.strictEqual(stdout.trim(), '42');
    assert.strictEqual(stderr.trim(), '');
    done();
  }));
});
