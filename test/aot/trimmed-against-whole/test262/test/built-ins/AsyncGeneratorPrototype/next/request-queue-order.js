// Copyright (C) 2018 Valerie Young. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-asyncgenerator-prototype-next
description: queue
info: >
  AsyncGenerator.prototype.next ( value )
  1. Let generator be the this value.
  2. Let completion be NormalCompletion(value).
  3. Return ! AsyncGeneratorEnqueue(generator, completion).

  AsyncGeneratorEnqueue ( generator, completion )
  ...
  4. Let queue be generator.[[AsyncGeneratorQueue]].
  5. Let request be AsyncGeneratorRequest{[[Completion]]: completion,
     [[Capability]]: promiseCapability}.
  6. Append request to the end of queue.
  ...

  AsyncGeneratorResolve ( generator, value, done )
  ...
  2. Let queue be generator.[[AsyncGeneratorQueue]].
  3. Assert: queue is not an empty List.
  4. Remove the first element from queue and let next be the value of that element.
  ...

flags: [async]
features: [async-iteration]
---*/

var order = 0;

async function* g() {
  yield 'first';
  yield 'second';
}

var iter = g();

var item1 = iter.next();
var item2 = iter.next();
var item3 = iter.next();

var resolvedorder = 0;

Promise.all([

  item3.then(function(result) {
    resolvedorder++;
    assert.sameValue(resolvedorder, 3);
    assert.sameValue(result.value, undefined);
    assert.sameValue(result.done, true);
  }),

  item2.then(function(result) {
    resolvedorder++;
    assert.sameValue(resolvedorder, 2);
    assert.sameValue(result.value, "second");
    assert.sameValue(result.done, false);
  }),

  item1.then(function(result) {
    resolvedorder++;
    assert.sameValue(resolvedorder, 1);
    assert.sameValue(result.value, "first");
    assert.sameValue(result.done, false);
  })

]).then(function() { $DONE(); }, $DONE);

