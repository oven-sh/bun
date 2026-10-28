// Copyright (C) 2013 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
es6id: 25.2
description: >
    The `next` method returns an object that has "own" properties `value` and
    `done` and that inherits directly from the Object prototype.
features: [generators]
---*/

function* g() {}
var result = g().next();

assert(
  Object.prototype.hasOwnProperty.call(result, 'value'), 'Has "own" property `value`'
);
assert(
  Object.prototype.hasOwnProperty.call(result, 'done'), 'Has "own" property `done`'
);
assert.sameValue(Object.getPrototypeOf(result), Object.prototype);
