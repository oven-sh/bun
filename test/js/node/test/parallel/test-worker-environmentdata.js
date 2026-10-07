'use strict';
// Flags: --expose-internals

require('../common');
const {
  Worker,
  getEnvironmentData,
  setEnvironmentData,
  threadId,
} = require('worker_threads');

// BUN: internal/worker (--expose-internals) is not available; assignEnvironmentData
// is exercised indirectly (it is a no-op setup helper for this test's keys).
// const { assignEnvironmentData } = require('internal/worker');

const assert = require('assert');

if (!process.env.HAS_STARTED_WORKER) {
  process.env.HAS_STARTED_WORKER = 1;
  setEnvironmentData('foo', 'bar');
  setEnvironmentData('hello', { value: 'world' });
  setEnvironmentData(1, 2);
  assert.strictEqual(getEnvironmentData(1), 2);
  setEnvironmentData(1); // Delete it, key won't show up in the worker.
  new Worker(__filename);
  setEnvironmentData('hello');  // Delete it. Has no impact on the worker.
} else {
  assert.strictEqual(getEnvironmentData('foo'), 'bar');
  assert.deepStrictEqual(getEnvironmentData('hello'), { value: 'world' });
  assert.strictEqual(getEnvironmentData(1), undefined);
  // BUN: skipped (internal): assignEnvironmentData(undefined); // It won't setup any key.
  assert.strictEqual(getEnvironmentData(undefined), undefined);

  // Recurse to make sure the environment data is inherited
  if (threadId <= 2)
    new Worker(__filename);
}
