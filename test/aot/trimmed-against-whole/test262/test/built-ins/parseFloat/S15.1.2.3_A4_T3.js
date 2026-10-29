// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: |
    Compute the longest prefix of Result(2), which might be Result(2) itself,
    which satisfies the syntax of a StrDecimalLiteral
esid: sec-parsefloat-string
description: StrDecimalLiteral not contain HexIntegerLiteral
---*/

//CHECK#0
if (parseFloat("0x0") !== 0) {
  throw new Test262Error('#0: parseFloat("0x0") === 0. Actual: ' + (parseFloat("0x0")));
}

//CHECK#1
if (parseFloat("0x1") !== 0) {
  throw new Test262Error('#1: parseFloat("0x1") === 0. Actual: ' + (parseFloat("0x1")));
}

//CHECK#2
if (parseFloat("0x2") !== 0) {
  throw new Test262Error('#2: parseFloat("0x2") === 0. Actual: ' + (parseFloat("0x2")));
}

//CHECK#3
if (parseFloat("0x3") !== 0) {
  throw new Test262Error('#3: parseFloat("0x3") === 0. Actual: ' + (parseFloat("0x3")));
}

//CHECK#4
if (parseFloat("0x4") !== 0) {
  throw new Test262Error('#4: parseFloat("0x4") === 0. Actual: ' + (parseFloat("0x4")));
}

//CHECK#5
if (parseFloat("0x5") !== 0) {
  throw new Test262Error('#5: parseFloat("0x5") === 0. Actual: ' + (parseFloat("0x5")));
}

//CHECK#6
if (parseFloat("0x6") !== 0) {
  throw new Test262Error('#6: parseFloat("0x6") === 0. Actual: ' + (parseFloat("0x6")));
}

//CHECK#7
if (parseFloat("0x7") !== 0) {
  throw new Test262Error('#7: parseFloat("0x7") === 0. Actual: ' + (parseFloat("0x7")));
}

//CHECK#8
if (parseFloat("0x8") !== 0) {
  throw new Test262Error('#8: parseFloat("0x8") === 0. Actual: ' + (parseFloat("0x8")));
}

//CHECK#9
if (parseFloat("0x9") !== 0) {
  throw new Test262Error('#9: parseFloat("0x9") === 0. Actual: ' + (parseFloat("0x9")));
}

//CHECK#A
if (parseFloat("0xA") !== 0) {
  throw new Test262Error('#A: parseFloat("0xA") === 0. Actual: ' + (parseFloat("0xA")));
}

//CHECK#B
if (parseFloat("0xB") !== 0) {
  throw new Test262Error('#B: parseFloat("0xB") === 0. Actual: ' + (parseFloat("0xB")));
}

//CHECK#C
if (parseFloat("0xC") !== 0) {
  throw new Test262Error('#C: parseFloat("0xC") === 0. Actual: ' + (parseFloat("0xC")));
}

//CHECK#D
if (parseFloat("0xD") !== 0) {
  throw new Test262Error('#D: parseFloat("0xD") === 0. Actual: ' + (parseFloat("0xD")));
}

//CHECK#E
if (parseFloat("0xE") !== 0) {
  throw new Test262Error('#E: parseFloat("0xE") === 0. Actual: ' + (parseFloat("0xE")));
}

//CHECK#F
if (parseFloat("0xF") !== 0) {
  throw new Test262Error('#F: parseFloat("0xF") === 0. Actual: ' + (parseFloat("0xF")));
}
