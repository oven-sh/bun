// Copyright (C) 2016 André Bargull. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-parseint-string-radix
description: >
  Leading U+180E is not recognized as whitespace
info: |
  18.2.5 parseInt (string , radix)

  ...
  3. Let S be a newly created substring of inputString consisting of the
     first code unit that is not a StrWhiteSpaceChar and all code units
     following that code unit. (In other words, remove leading white
     space.) If inputString does not contain any such code unit, let S
     be the empty string
  ...
  13. If S contains a code unit that is not a radix-R digit, let Z be
      the substring of S consisting of all code units before the first
      such code unit; otherwise, let Z be S.
  14. If Z is empty, return NaN.
  ...
features: [u180e]
---*/

var mongolianVowelSeparator = "\u180E";

assert.sameValue(parseInt(mongolianVowelSeparator + "1"), NaN, 'parseInt(mongolianVowelSeparator + "1") must return NaN');
assert.sameValue(parseInt(mongolianVowelSeparator + mongolianVowelSeparator + mongolianVowelSeparator + "1"), NaN, 'parseInt( mongolianVowelSeparator + mongolianVowelSeparator + mongolianVowelSeparator + "1" ) must return NaN');
assert.sameValue(parseInt(mongolianVowelSeparator), NaN, 'parseInt("\\"\\\\u180E\\"") must return NaN');
