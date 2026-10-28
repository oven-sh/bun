// Copyright (C) 2023 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
description: Test isSubsetOf set method receiver is cleared.
features: [set-methods]
---*/

const firstSet = new Set();
firstSet.add(42);
firstSet.add(43);

const otherSet = new Set();
otherSet.add(42);
otherSet.add(43);
otherSet.add(47);

Object.defineProperty(otherSet, 'size', {
  get: function() {
    firstSet.clear();
    return 3;
  },

});

assert.sameValue(firstSet.isSubsetOf(otherSet), true);
