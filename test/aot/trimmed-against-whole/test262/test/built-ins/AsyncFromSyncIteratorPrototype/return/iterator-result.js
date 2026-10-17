// Copyright (C) 2018 Valerie Young. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-%asyncfromsynciteratorprototype%.return
description: return() will return a iterator result object when built-in sync throw is called
info: |
  %AsyncFromSyncIteratorPrototype%.return ( value )
  ...
  2. Let promiseCapability be ! NewPromiseCapability(%Promise%).
  ...
  5. Let return be GetMethod(syncIterator, "return").
  ...
  8. Let returnResult be Call(return, syncIterator, « value »).
  ...
  22. Return promiseCapability.[[Promise]].

  Generator.prototype.return ( value )
  1. Let g be the this value.
  2. Let C be Completion{[[Type]]: return, [[Value]]: value, [[Target]]: empty}.
  3. Return ? GeneratorResumeAbrupt(g, C).

flags: [async]
features: [async-iteration]
---*/

function* g() {
  yield 42;
  throw new Test262Error('return closes iter');
  yield 43;
}

async function* asyncg() {
  yield* g();
}

var iter = asyncg();
var val = 'some specific return value'

iter.next().then(function(result) {

  // return will call sync generator prototype built-in function return
  iter.return(val).then(function(result) {

    assert.sameValue(result.done, true, 'the iterator is completed');
    assert.sameValue(result.value, val, 'expect agrument to `return`');

    iter.next().then(({ done, value }) => {
      assert.sameValue(done, true, 'the iterator is completed');
      assert.sameValue(value, undefined, 'value is undefined');
    }).then($DONE, $DONE);

  }).catch($DONE);

}).catch($DONE);
