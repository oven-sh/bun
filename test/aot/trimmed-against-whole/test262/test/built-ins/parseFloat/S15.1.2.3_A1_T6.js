// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: Operator use ToString
esid: sec-parsefloat-string
description: Checking for String object
---*/

//CHECK#1
if (parseFloat(new String("-1.1")) !== parseFloat("-1.1")) {
  throw new Test262Error('#1: parseFloat(new String("-1.1")) === parseFloat("-1.1"). Actual: ' + (parseFloat(new String("-1.1"))));
}

//CHECK#2
if (parseFloat(new String("Infinity")) !== parseFloat("Infinity")) {
  throw new Test262Error('#2: parseFloat(new String("Infinity")) === parseFloat("Infinity"). Actual: ' + (parseFloat(new String("Infinity"))));
}

//CHECK#3
if (String(parseFloat(new String("NaN"))) !== "NaN") {
  throw new Test262Error('#3: String(parseFloat(new String("NaN"))) === "NaN". Actual: ' + (String(parseFloat(new String("NaN")))));
}

//CHECK#4
if (parseFloat(new String(".01e+2")) !== parseFloat(".01e+2")) {
  throw new Test262Error('#4: parseFloat(new String(".01e+2")) === parseFloat(".01e+2"). Actual: ' + (parseFloat(new String(".01e+2"))));
}

//CHECK#5
if (String(parseFloat(new String("false"))) !== "NaN") {
  throw new Test262Error('#5: String(parseFloat(new String("false"))) === "NaN". Actual: ' + (String(parseFloat(new String("false")))));
}
