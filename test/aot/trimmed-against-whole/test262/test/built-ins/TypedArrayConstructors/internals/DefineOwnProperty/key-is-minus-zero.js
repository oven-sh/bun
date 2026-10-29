// Copyright (C) 2016 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-integer-indexed-exotic-objects-defineownproperty-p-desc
description: >
  Returns false if numericIndex is "-0"
info: |
  9.4.5.3 [[DefineOwnProperty]] ( P, Desc)
  ...
  3. If Type(P) is String, then
    a. Let numericIndex be ! CanonicalNumericIndexString(P).
    b. If numericIndex is not undefined, then
      i. If IsInteger(numericIndex) is false, return false.
      ii. Let intIndex be numericIndex.
      iii. If intIndex = -0, return false.
  ...
includes: [testTypedArray.js]
features: [Reflect, TypedArray]
---*/

testWithTypedArrayConstructors(function(TA, makeCtorArg) {
  var sample = new TA(makeCtorArg(2));

  assert.sameValue(
    Reflect.defineProperty(sample, "-0", {
      value: 42,
      configurable: false,
      enumerable: true,
      writable: true
    }),
    false,
    "defineProperty returns false"
  );
  assert.sameValue(sample[0], 0, "does not change the value for [0]");
  assert.sameValue(sample["-0"], undefined, "does define a value for ['-0']");
}, null, ["passthrough"]);
