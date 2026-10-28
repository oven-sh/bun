// Copyright (C) 2021 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-get-arraybuffer.prototype.resizable
description: Return value according to [[ArrayBufferMaxByteLength]] internal slot
info: |
  get ArrayBuffer.prototype.resizable

  1. Let O be the this value.
  2. Perform ? RequireInternalSlot(O, [[ArrayBufferData]]).
  3. If IsSharedArrayBuffer(O) is true, throw a TypeError exception.
  4. Return IsResizableArrayBuffer(O).

  IsResizableArrayBuffer ( arrayBuffer )

  1. Assert: Type(arrayBuffer) is Object and arrayBuffer has an
     [[ArrayBufferData]] internal slot.
  2. If buffer has an [[ArrayBufferMaxByteLength]] internal slot, return true.
  3. Return false.
features: [resizable-arraybuffer]
---*/

var ab1 = new ArrayBuffer(1);

assert.sameValue(ab1.resizable, false);

var ab2 = new ArrayBuffer(1, {maxByteLength: 1});

assert.sameValue(ab2.resizable, true);
