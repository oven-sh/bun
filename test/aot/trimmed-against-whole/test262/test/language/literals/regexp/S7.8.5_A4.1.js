// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: |
    A regular expression literal is an input element that is converted to
    a RegExp object when it is scanned
es5id: 7.8.5_A4.1
description: "Check ((/(?:)/ instanceof RegExp) === true)"
---*/

//CHECK#1
if ((/(?:)/ instanceof RegExp) !== true) {
  throw new Test262Error('#1: (/(?:)/ instanceof RegExp) === true. Actual: ' + ((/(?:)/ instanceof RegExp)));
}
