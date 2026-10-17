// Copyright (C) 2016 The V8 Project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-isnan-number
description: >
  Return abrupt completion from ToNumber(number)
info: |
  isNaN (number)

  1. Let num be ? ToNumber(number).
---*/

var obj1 = {
  valueOf: function() {
    throw new Test262Error();
  }
};

var obj2 = {
  toString: function() {
    throw new Test262Error();
  }
};

assert.throws(Test262Error, function() {
  isNaN(obj1);
}, "valueOf");

assert.throws(Test262Error, function() {
  isNaN(obj2);
}, "toString");
