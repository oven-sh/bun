// Copyright (C) 2020 Alexey Shvayka. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-async-function-prototype-properties
description: >
  %AsyncFunction.prototype% is an ordinary non-callable object.
info: |
  Properties of the AsyncFunction Prototype Object

  The AsyncFunction prototype object:

  [...]
  * is an ordinary object.
  * is not a function object and does not have an [[ECMAScriptCode]] internal slot
    or any other of the internal slots listed in Table 28.
features: [async-functions]
---*/

var AsyncFunctionPrototype = Object.getPrototypeOf(async function() {});

assert.sameValue(typeof AsyncFunctionPrototype, "object");
assert.throws(TypeError, function() {
  AsyncFunctionPrototype();
});

assert(!AsyncFunctionPrototype.hasOwnProperty("length"), "length");
assert(!AsyncFunctionPrototype.hasOwnProperty("name"), "name");
