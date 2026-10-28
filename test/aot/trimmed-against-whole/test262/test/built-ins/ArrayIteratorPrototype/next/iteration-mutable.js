// Copyright (C) 2013 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-%arrayiteratorprototype%.next
description: >
    When an item is added to the array after the iterator is created but
    before the iterator is "done" (as defined by 22.1.5.2.1), the new item
    should be accessible via iteration. When an item is added to the array
    after the iterator is "done", the new item should not be accessible via
    iteration.
es6id: 22.1.3.30
features: [Symbol.iterator]
---*/

var array = [];
var iterator = array[Symbol.iterator]();
var result;

array.push('a');

result = iterator.next();
assert.sameValue(result.done, false, 'First result `done` flag');
assert.sameValue(result.value, 'a', 'First result `value`');

result = iterator.next();
assert.sameValue(result.done, true, 'Exhausted result `done` flag');
assert.sameValue(result.value, undefined, 'Exhausted result `value`');

array.push('b');

result = iterator.next();
assert.sameValue(result.done, true, 'Exhausted result `done` flag (after push)');
assert.sameValue(result.value, undefined, 'Exhausted result `value (after push)');
