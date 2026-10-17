// Copyright (C) 2014 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-%arrayiteratorprototype%.next
description: >
    Visits each element of the array in order and ceases iteration once all
    values have been visited.
features: [Symbol.iterator, TypedArray]
---*/
var array = new Int16Array([3, 1, 2]);
var iterator = array[Symbol.iterator]();
var result;

result = iterator.next();
assert.sameValue(result.value, 3, 'first result `value`');
assert.sameValue(result.done, false, 'first result `done` flag');

result = iterator.next();
assert.sameValue(result.value, 1, 'second result `value`');
assert.sameValue(result.done, false, 'second result `done` flag');

result = iterator.next();
assert.sameValue(result.value, 2, 'third result `value`');
assert.sameValue(result.done, false, 'third result `done` flag');

result = iterator.next();
assert.sameValue(result.value, undefined, 'exhausted result `value`');
assert.sameValue(result.done, true, 'exhausted result `done` flag');

result = iterator.next();
assert.sameValue(
  result.value, undefined, 'exhausted result `value` (repeated request)'
);
assert.sameValue(
  result.done, true, 'exhausted result `done` flag (repeated request)'
);
