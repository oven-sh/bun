// Copyright (C) 2020 Rick Waldron. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-atomics.waitasync
description: >
  A null value for bufferData throws a TypeError
info: |
  Atomics.waitAsync( typedArray, index, value, timeout )

  1. Return DoWait(async, typedArray, index, value, timeout).

  DoWait ( mode, typedArray, index, value, timeout )

  1. Let buffer be ? ValidateSharedIntegerTypedArray(typedArray, true).

  ValidateSharedIntegerTypedArray ( typedArray [ , waitable ] )

  2. Perform ? RequireInternalSlot(typedArray, [[TypedArrayName]]).

  RequireInternalSlot ( O, internalSlot )

  1. If Type(O) is not Object, throw a TypeError exception.
  2. If O does not have an internalSlot internal slot, throw a TypeError exception.

includes: [detachArrayBuffer.js]
features: [Atomics.waitAsync, ArrayBuffer, Atomics, TypedArray, BigInt]
---*/
assert.sameValue(typeof Atomics.waitAsync, 'function', 'The value of `typeof Atomics.waitAsync` is "function"');
const i64a = new BigInt64Array(
  new ArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT * 4)
);

const poisoned = {
  valueOf() {
    throw new Test262Error('should not evaluate this code');
  }
};

try {
  $DETACHBUFFER(i64a.buffer); // Detaching a non-shared ArrayBuffer sets the [[ArrayBufferData]] value to null
} catch (error) {
  throw new Test262Error(`An unexpected error occurred when detaching ArrayBuffer: ${error.message}`);
}

assert.throws(TypeError, function() {
  Atomics.waitAsync(i64a, poisoned, poisoned, poisoned);
}, '`Atomics.waitAsync(i64a, poisoned, poisoned, poisoned)` throws a TypeError exception');

