// Copyright (C) 2015 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
es6id: 19.4.3.4
description: >
    Behavior when `this` value is an object without a [[SymbolData]] internal
    slot
info: |
    1. Let s be the this value.
    2. If Type(s) is Symbol, return s.
    3. If Type(s) is not Object, throw a TypeError exception.
    4. If s does not have a [[SymbolData]] internal slot, throw a TypeError
       exception.
features: [Symbol.toPrimitive]
---*/

assert.throws(TypeError, function() {
  Symbol.prototype[Symbol.toPrimitive].call({});
});
