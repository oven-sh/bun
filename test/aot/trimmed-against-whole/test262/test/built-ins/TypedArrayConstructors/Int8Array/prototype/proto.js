// Copyright (C) 2015 André Bargull. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-properties-of-typedarray-prototype-objects
description: >
  The prototype of Int8Array.prototype is %TypedArrayPrototype%.
info: |
  The value of the [[Prototype]] internal slot of a TypedArray prototype
  object is the intrinsic object %TypedArrayPrototype% (22.2.3).
includes: [testTypedArray.js]
features: [TypedArray]
---*/

assert.sameValue(Object.getPrototypeOf(Int8Array.prototype), TypedArray.prototype);
