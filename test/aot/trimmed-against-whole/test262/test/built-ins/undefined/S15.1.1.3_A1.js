// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: The initial value of undefined is undefined
esid: sec-undefined
description: Use typeof, isNaN, isFinite
---*/

// CHECK#1
if (typeof(undefined) !== "undefined") {
  throw new Test262Error('#1: typeof(undefined) === "undefined". Actual: ' + (typeof(undefined)));
}

// CHECK#2
if (undefined !== void 0) {
  throw new Test262Error('#2: undefined === void 0. Actual: ' + (undefined));
}

// CHECK#3
if (undefined !== eval("var x")) {
  throw new Test262Error('#3: undefined === eval("var x"). Actual: ' + (undefined));
}
