// Copyright (C) 2015 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-generator.prototype.return
description: >
  A TypeError should be thrown from GeneratorValidate (25.3.3.2) if the "this"
  value of `return` is not an object.
info: |
  [...]
  3. Return ? GeneratorResumeAbrupt(g, C).

  25.3.3.4 GeneratorResumeAbrupt

  1. Let state be ? GeneratorValidate(generator).

  25.3.3.2 GeneratorValidate

  1. If Type(generator) is not Object, throw a TypeError exception.
features: [generators, Symbol]
---*/

function* g() {}
var GeneratorPrototype = Object.getPrototypeOf(g).prototype;
var symbol = Symbol();

assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call(undefined);
  },
  'undefined (without value)'
);
assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call(undefined, 1);
  },
  'undefined (with value)'
);

assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call(null);
  },
  'null (without value)'
);
assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call(null, 1);
  },
  'null (with value)'
);

assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call(true);
  },
  'boolean (without value)'
);
assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call(true, 1);
  },
  'boolean (with value)'
);

assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call('s');
  },
  'string (without value)'
);
assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call('s', 1);
  },
  'string (with value)'
);

assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call(1);
  },
  'number (without value)'
);
assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call(1, 1);
  },
  'number (with value)'
);

assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call(symbol);
  },
  'symbol (without value)'
);
assert.throws(
  TypeError,
  function() {
    GeneratorPrototype.return.call(symbol, 1);
  },
  'symbol (with value)'
);
