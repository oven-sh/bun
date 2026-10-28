// Copyright (C) 2018 Peter Wong. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: pending
description: Iterates over each match
info: |
  %RegExpStringIteratorPrototype%.next ( )
    [...]
    4. If O.[[Done]] is true, then
      a. Return ! reateIterResultObject(undefined, true).
    [...]
    9. Let match be ? RegExpExec(R, S).
    10. If match is null, then
      a. Set O.[[Done]] to true.
      b. Return ! CreateIterResultObject(undefined, true).
    11. Else,
      a. If global is true,
        i. Let matchStr be ? ToString(? Get(match, "0")).
        ii. If matchStr is the empty string,
          1. Let thisIndex be ? ToLength(? Get(R, "lastIndex").
          2. Let nextIndex be ! AdvanceStringIndex(S, thisIndex, fullUnicode).
          3. Perform ? Set(R, "lastIndex", nextIndex, true).
        iii. Return ! CreateIterResultObject(match, false).
features: [Symbol.matchAll]
includes: [compareArray.js, compareIterator.js, regExpUtils.js]
---*/

var regexp = /\w/g;
var str = 'a*b';
var iter = regexp[Symbol.matchAll](str);

assert.compareIterator(iter, [
  matchValidator(['a'], 0, str),
  matchValidator(['b'], 2, str)
]);

// Verifies %RegExpStringIteratorPrototype%.next() step 4
var result = iter.next();
assert.sameValue(result.value, undefined);
assert(result.done);
