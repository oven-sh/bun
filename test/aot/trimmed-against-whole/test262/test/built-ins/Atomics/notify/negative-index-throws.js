// Copyright (C) 2018 Amal Hussein. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-atomics.notify
description: >
  Throws a RangeError is index < 0
info: |
  Atomics.notify( typedArray, index, count )

  2.Let i be ? ValidateAtomicAccess(typedArray, index).
    ...
      2.Let accessIndex be ? ToIndex(requestIndex).
        ...
        2.b If integerIndex < 0, throw a RangeError exception
features: [Atomics, SharedArrayBuffer, TypedArray]
---*/

const i32a = new Int32Array(
  new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4)
);

const poisoned = {
  valueOf: function() {
    throw new Test262Error('should not evaluate this code');
  }
};

assert.throws(RangeError, function() {
  Atomics.notify(i32a, -Infinity, poisoned);
});
assert.throws(RangeError, function() {
  Atomics.notify(i32a, -7.999, poisoned);
});
assert.throws(RangeError, function() {
  Atomics.notify(i32a, -1, poisoned);
});
assert.throws(RangeError, function() {
  Atomics.notify(i32a, -300, poisoned);
});
