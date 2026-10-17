// Copyright (C) 2024 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
description: Test DisposableStack constructor and prototype.
includes: [propertyHelper.js]
features: [globalThis, explicit-resource-management]
---*/

// constructor --------
assert.sameValue(
    typeof DisposableStack, 'function',
    'The value of `typeof DisposableStack` is "function"');

// prototype --------
verifyProperty(DisposableStack, 'prototype', {
  value: DisposableStack.prototype,
  writable: false,
  enumerable: false,
  configurable: false,
});
