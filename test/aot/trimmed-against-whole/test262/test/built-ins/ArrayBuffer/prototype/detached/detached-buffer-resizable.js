// Copyright (C) 2023 Jordan Harband. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-get-arraybuffer.prototype.detached
description: Return a boolean indicating if the ArrayBuffer is detached
info: |
  get ArrayBuffer.prototype.detached

  1. Let O be the this value.
  2. Perform ? RequireInternalSlot(O, [[ArrayBufferData]]).
  3. If IsSharedArrayBuffer(O) is true, throw a TypeError exception.
  4. Return IsDetachedBuffer(O).
includes: [detachArrayBuffer.js]
features: [ArrayBuffer, arraybuffer-transfer, resizable-arraybuffer]
---*/

var ab1 = new ArrayBuffer(0, { maxByteLength: 0 });
assert.sameValue(ab1.detached, false, 'Resizable ArrayBuffer with maxByteLength of 0 is not detached');

$DETACHBUFFER(ab1);

assert.sameValue(ab1.detached, true, 'Resizable ArrayBuffer with maxByteLength of 0 is now detached');

var ab2 = new ArrayBuffer(0, { maxByteLength: 23 });
assert.sameValue(ab2.detached, false, 'Resizable ArrayBuffer with maxByteLength of 23 is not detached');

$DETACHBUFFER(ab2);

assert.sameValue(ab2.detached, true, 'Resizable ArrayBuffer with maxByteLength of 23 is now detached');

var ab3 = new ArrayBuffer(42, { maxByteLength: 42 });
assert.sameValue(ab3.detached, false, 'Resizable ArrayBuffer with maxByteLength of 42 is not detached');

$DETACHBUFFER(ab3);

assert.sameValue(ab3.detached, true, 'Resizable ArrayBuffer with maxByteLength of 42 is now detached');
