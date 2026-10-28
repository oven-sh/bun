// Copyright (C) 2023 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
description: Test isSubsetOf set method on a set like with equal size.
features: [set-methods]
---*/

const SetLike = {
  arr: [42, 44, 45],
  size: 3,
  keys() {
    return this.arr[Symbol.iterator]();
  },
  has(key) {
    return this.arr.indexOf(key) != -1;
  }
};

const firstSet = new Set();
firstSet.add(42);
firstSet.add(43);
firstSet.add(45);

assert.sameValue(firstSet.isSubsetOf(SetLike), false);
