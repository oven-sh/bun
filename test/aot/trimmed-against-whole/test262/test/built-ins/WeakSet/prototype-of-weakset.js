// Copyright (C) 2015 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-properties-of-the-weakset-constructor
description: >
  The value of the [[Prototype]] internal slot of the WeakSet constructor
  is the intrinsic object %FunctionPrototype% (19.2.3).
---*/

assert.sameValue(
  Object.getPrototypeOf(WeakSet),
  Function.prototype,
  '`Object.getPrototypeOf(WeakSet)` returns `Function.prototype`'
);
