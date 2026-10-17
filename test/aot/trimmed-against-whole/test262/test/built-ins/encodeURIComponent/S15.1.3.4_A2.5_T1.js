// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: |
    If string.charAt(k) in [0xE000 - 0xFFFF], return 3 octets (xxxxyyyy
    yyzzzzzz -> 1110xxxx 10yyyyyy 10zzzzzz)
esid: sec-encodeuricomponent-uricomponent
description: Complex tests, use RFC 3629
includes: [decimalToHexString.js]
---*/

var errorCount = 0;
var count = 0;
var indexP;
var indexO = 0;
for (var index = 0xE000; index <= 0xFFFF; index++) {
  count++;
  var hex1 = decimalToPercentHexString(0x0080 + (index & 0x003F));
  var hex2 = decimalToPercentHexString(0x0080 + (index & 0x0FC0) / 0x0040);
  var hex3 = decimalToPercentHexString(0x00E0 + (index & 0xF000) / 0x1000);
  var str = String.fromCharCode(index);
  if (encodeURIComponent(str).toUpperCase() === hex3 + hex2 + hex1) continue;

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
