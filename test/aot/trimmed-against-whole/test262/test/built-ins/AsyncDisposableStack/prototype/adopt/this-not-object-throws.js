// Copyright (C) 2023 Ron Buckton. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-asyncdisposablestack.prototype.adopt
description: Throws a TypeError if this is not an Object
info: |
  AsyncDisposableStack.prototype.adopt ( value, onDisposeAsync )

  1. Let asyncDisposableStack be the this value.
  2. Perform ? RequireInternalSlot(asyncDisposableStack, [[AsyncDisposableState]]).
  ...

  RequireInternalSlot ( O, internalSlot )

  1. If O is not an Object, throw a TypeError exception.
  ...

features: [explicit-resource-management]
---*/

assert.sameValue(typeof AsyncDisposableStack.prototype.adopt, 'function');

var adopt = AsyncDisposableStack.prototype.adopt;

assert.throws(TypeError, function() {
  adopt.call(undefined);
}, 'undefined');

assert.throws(TypeError, function() {
  adopt.call(null);
}, 'null');

assert.throws(TypeError, function() {
  adopt.call(true);
}, 'true');

assert.throws(TypeError, function() {
  adopt.call(false);
}, 'false');

assert.throws(TypeError, function() {
  adopt.call(1);
}, 'number');

assert.throws(TypeError, function() {
  adopt.call('object');
}, 'string');

var s = Symbol();
assert.throws(TypeError, function() {
  adopt.call(s);
}, 'symbol');
