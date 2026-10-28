// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: If the parse fails, throw a SyntaxError exception (but see also clause 16)
es5id: 15.1.2.1_A2_T1
description: >
    Checking if execution of "eval("x = 1; x\u000A++"), catch
    SyntaxError" passes
---*/

//CHECK#1
var x;
try {
  eval("x = 1; x\u000A++");
  throw new Test262Error('#1.1: eval("x = 1; x\\u000A++") must throw a SyntaxError. Actual: ' + (eval("x = 1; x\u000A++")));
} catch (e) {
  if ((e instanceof SyntaxError) !== true) {
    throw new Test262Error('#1.2: eval("x = 1; x\\u000A++") must throw a SyntaxError. Actual: ' + (e));
  }  
}
