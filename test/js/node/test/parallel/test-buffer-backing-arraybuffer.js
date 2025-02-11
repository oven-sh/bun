'use strict';
require('../common');
const assert = require('assert');
// const { internalBinding } = require('internal/test/binding');
// const { arrayBufferViewHasBuffer } = internalBinding('util');
const { arrayBufferViewHasBuffer } = require('bun:internal-for-testing');

const tests = [
  { length: 0 },
  { length: 48 },
  { length: 96 },
  { length: 1024 },
];

for (const { length, expectOnHeap } of tests) {
  const arrays = [
    new Uint8Array(length),
    new Uint16Array(length / 2),
    new Uint32Array(length / 4),
    new Float32Array(length / 4),
    new Float64Array(length / 8),
    Buffer.alloc(length),
    Buffer.allocUnsafeSlow(length),
    // Buffer.allocUnsafe() is missing because it may use pooled allocations.
  ];

  for (const array of arrays) {
    const isOnHeap = arrayBufferViewHasBuffer(array);
    const expectOnHeap = false; // in JSC this will always be false until `.buffer` is first accessed.
    assert.strictEqual(isOnHeap, expectOnHeap, `mismatch: ${isOnHeap} vs ${expectOnHeap} ` + `for ${array.constructor.name}, length = ${length}`);

    // Consistency check: Accessing .buffer should create it.
    array.buffer; // eslint-disable-line no-unused-expressions
    assert(arrayBufferViewHasBuffer(array));
  }
}
