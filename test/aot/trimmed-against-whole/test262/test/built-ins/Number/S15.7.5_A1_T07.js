// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: |
    Number instances have no special properties beyond those
    inherited from the Number prototype object
es5id: 15.7.5_A1_T07
description: Checking property toPrecision
---*/
assert.sameValue(
  (new Number()).hasOwnProperty("toPrecision"),
  false,
  '(new Number()).hasOwnProperty("toPrecision") must return false'
);

assert.sameValue(
  (new Number()).toPrecision,
  Number.prototype.toPrecision,
  'The value of (new Number()).toPrecision is expected to equal the value of Number.prototype.toPrecision'
);
