// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: |
    If B1 = 110xxxxx ([0xC0 - 0xDF]), B2 = 10xxxxxx ([0x80 - 0xBF), without
    B1 = [0xC0, 0xC1], return UTF8(B1, B2)
esid: sec-decodeuricomponent-encodeduricomponent
description: Complex tests, use RFC 3629
includes: [decimalToHexString.js]
---*/

var errorCount = 0;
var count = 0;
var indexP;
var indexO = 0;

for (var indexB1 = 0xC2; indexB1 <= 0xDF; indexB1++) {
  var hexB1 = decimalToPercentHexString(indexB1);
  for (var indexB2 = 0x80; indexB2 <= 0xBF; indexB2++) {
    count++;
    var hexB1_B2 = hexB1 + decimalToPercentHexString(indexB2);
    var index = (indexB1 & 0x1F) * 0x40 + (indexB2 & 0x3F);
    if (decodeURIComponent(hexB1_B2) === String.fromCharCode(index)) continue;

    if (indexO === 0) {
      indexO = index;
    } else {
      if ((index - indexP) !== 1) {
        if ((indexP - indexO) !== 0) {
          var hexP = decimalToHexString(indexP);
          var hexO = decimalToHexString(indexO);
          throw new Test262Error('#' + hexO + '-' + hexP + ' ');
        }
        else {
          var hexP = decimalToHexString(indexP);
          throw new Test262Error('#' + hexP + ' ');
        }
        indexO = index;
      }
    }
    indexP = index;
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
