// Copyright 2011 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: Call the comparefn passing undefined as the this value (step 13b)
esid: sec-array.prototype.sort
description: comparefn tests that its this value is undefined
flags: [noStrict]
---*/

var global = this;
[2, 3].sort(function(x, y) {
  "use strict";

  if (this === global) {
    throw new Test262Error('#1: Sort leaks global');
  }
  if (this !== undefined) {
    throw new Test262Error('#2: Sort comparefn should be called with this===undefined. ' +
      'Actual: ' + this);
  }
  return x - y;
});
