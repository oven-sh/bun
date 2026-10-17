// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: |
    If string.charAt(k) in [0xD800 - 0xDBFF] and string.charAt(k+1) in
    [0xDC00 � 0xDFFF], return 4 octets (000wwwxx xxxxyyyy yyzzzzzz ->
    11110www 10xxxxxx 10yyyyyy 10zzzzzz)
esid: sec-encodeuri-uri
description: >
    Complex tests, use RFC 3629, string.charAt(k) in [0xD800, 0xDBFF,
    0xD9FF]
includes: [decimalToHexString.js]
---*/

var chars = [0xD800, 0xDBFF, 0xD9FF];
var errorCount = 0;
var count = 0;
var indexP;
var indexO = 0;
for (var index = 0xDC00; index <= 0xDFFF; index++) {
  var res = true;
  for (var indexC = 0; indexC < chars.length; indexC++) {
    var index1 = (chars[indexC] - 0xD800) * 0x400 + (index - 0xDC00) + 0x10000;
    var hex1 = decimalToPercentHexString(0x0080 + (index1 & 0x003F));
    var hex2 = decimalToPercentHexString(0x0080 + (index1 & 0x0FC0) / 0x0040);
    var hex3 = decimalToPercentHexString(0x0080 + (index1 & 0x3F000) / 0x1000);
    var hex4 = decimalToPercentHexString(0x00F0 + (index1 & 0x1C0000) / 0x40000);
    var str = String.fromCharCode(chars[indexC], index);
    if (encodeURI(str).toUpperCase() === hex4 + hex3 + hex2 + hex1) continue;

    res = false;
  }
  if (res !== true) {
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
  count++;
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
