// Copyright (C) 2018 Peter Wong.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
description: Compare the values of an iterator with an array of expected values
defines: [assert.compareIterator]
---*/

// Example:
//
//    function* numbers() {
//      yield 1;
//      yield 2;
//      yield 3;
//    }
//
//    assert.compareIterator(numbers(), [
//      v => assert.sameValue(v, 1),
//      v => assert.sameValue(v, 2),
//      v => assert.sameValue(v, 3),
//    ]);
//
assert.compareIterator = function(iter, validators, message) {
  message = message || '';

  var i, result;
  for (i = 0; i < validators.length; i++) {
    result = iter.next();
    assert(!result.done, 'Expected ' + i + ' values(s). Instead iterator only produced ' + (i - 1) + ' value(s). ' + message);
    validators[i](result.value);
  }

  result = iter.next();
  assert(result.done, 'Expected only ' + i + ' values(s). Instead iterator produced more. ' + message);
  assert.sameValue(result.value, undefined, 'Expected value of `undefined` when iterator completes. ' + message);
}
