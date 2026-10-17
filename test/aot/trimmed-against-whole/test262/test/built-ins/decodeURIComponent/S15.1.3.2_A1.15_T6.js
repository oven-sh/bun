// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: |
    If B = 11110xxx (n = 4) and C != 10xxxxxx (C - first of octets after B),
    throw URIError
esid: sec-decodeuricomponent-encodeduricomponent
description: Complex tests. B = [0xF0 - 0x0F7], C = [0xC0, 0xFF]
includes: [decimalToHexString.js]
---*/

var errorCount = 0;
var count = 0;
var indexP;
var indexO = 0;

for (var indexB = 0xF0; indexB <= 0xF7; indexB++) {
  count++;
  var hexB = decimalToPercentHexString(indexB);
  var result = true;
  for (var indexC = 0xC0; indexC <= 0xFF; indexC++) {
    var hexC = decimalToPercentHexString(indexC);
    try {
      decodeURIComponent(hexB + "%A0%A0" + hexC);
    } catch (e) {
      if ((e instanceof URIError) === true) continue;
    }
    result = false;
  }
  if (result !== true) {
    if (indexO === 0) {
      indexO = indexB;
    } else {
      if ((indexB - indexP) !== 1) {
        if ((indexP - indexO) !== 0) {
          var hexP = decimalToHexString(indexP);
          var hexO = decimalToHexString(indexO);
          throw new Test262Error('#' + hexO + '-' + hexP + ' ');
        }
        else {
          var hexP = decimalToHexString(indexP);
          throw new Test262Error('#' + hexP + ' ');
        }
        indexO = indexB;
      }
    }
    indexP = indexB;
    errorCount++;
  }
}

if (errorCount > 0) {
  if ((indexP - indexO) !== 0) {
    var hexP = decimalToHexString(indexP);
    var hexO = decimalToHexString(indexO);
    throw new Test262Error('#' + hexO + '-' + hexP + ' ');
  } else {
    var hexP = decimalToHexString(indexP);
    throw new Test262Error('#' + hexP + ' ');
  }
  throw new Test262Error('Total error: ' + errorCount + ' bad Unicode character in ' + count + ' ');
}
