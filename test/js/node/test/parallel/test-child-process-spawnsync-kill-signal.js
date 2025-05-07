// This test is modified to not test node internals, only public APIs.

'use strict';
const common = require('../common');
const assert = require('assert');
const cp = require('child_process');

if (process.argv[2] === 'child') {
  setInterval(() => {}, 1000);
} else {
  const { SIGKILL } = require('os').constants.signals;

  function spawn(killSignal) {
    const child = cp.spawnSync(process.execPath,
                               [__filename, 'child'],
                               { killSignal, timeout: 100 });
    assert.strictEqual(child.status, null);
    assert.strictEqual(child.error.code, 'ETIMEDOUT');
    return child;
  }

  // Verify that an error is thrown for unknown signals.
  assert.throws(() => {
    spawn('SIG_NOT_A_REAL_SIGNAL');
  }, { code: 'ERR_UNKNOWN_SIGNAL', name: 'TypeError' });

  // Verify that the default kill signal is SIGTERM.
  {
    const child = spawn(undefined);

    assert.strictEqual(child.signal, 'SIGTERM');
  }

  // Verify that a string signal name is handled properly.
  {
    const child = spawn('SIGKILL');

    assert.strictEqual(child.signal, 'SIGKILL');
  }

  // Verify that a numeric signal is handled properly.
  {
    assert.strictEqual(typeof SIGKILL, 'number');

    const child = spawn(SIGKILL);

    assert.strictEqual(child.signal, 'SIGKILL');
  }
}
