// Copyright (C) 2020 Rick Waldron. All rights reserved.
// Copyright (C) 2025 Jonas Haukenes. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-weakmap.prototype.getorinsertcomputed
description: |
  WeakMap.prototype.getOrInsertComputed does not implement [[Construct]], is not new-able
info: |
  ECMAScript Function Objects

  Built-in function objects that are not identified as constructors do not
  implement the [[Construct]] internal method unless otherwise specified in
  the description of a particular function.

  sec-evaluatenew

  ...
  7. If IsConstructor(constructor) is false, throw a TypeError exception.
  ...
includes: [isConstructor.js]
features: [Reflect.construct, WeakMap, arrow-function, upsert]
---*/
assert.sameValue(
  isConstructor(WeakMap.prototype.getOrInsertComputed),
  false,
  'isConstructor(WeakMap.prototype.getOrInsertComputed) must return false'
);

let wm = new WeakMap();
assert.throws(TypeError, () => {
  new wm.getOrInsertComputed({}, () => 1);
});

