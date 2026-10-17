// Copyright (C) 2015 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
es6id: 26.1.14
description: >
  Return false if target is not extensible, without changing the prototype.
info: |
  26.1.14 Reflect.setPrototypeOf ( target, proto )

  ...
  3. Return target.[[SetPrototypeOf]](proto).

  9.1.2 [[SetPrototypeOf]] (V)

  ...
  5. If extensible is false, return false.
  ...
features: [Reflect, Reflect.setPrototypeOf]
---*/

var o1 = {};
Object.preventExtensions(o1);
assert.sameValue(Reflect.setPrototypeOf(o1, {}), false);
assert.sameValue(Object.getPrototypeOf(o1), Object.prototype);

var o2 = {};
Object.preventExtensions(o2);
assert.sameValue(Reflect.setPrototypeOf(o2, null), false);
assert.sameValue(Object.getPrototypeOf(o2), Object.prototype);

var o3 = Object.create(null);
Object.preventExtensions(o3);
assert.sameValue(Reflect.setPrototypeOf(o3, {}), false);
assert.sameValue(Object.getPrototypeOf(o3), null);
