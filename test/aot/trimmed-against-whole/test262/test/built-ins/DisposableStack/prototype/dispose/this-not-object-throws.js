// Copyright (C) 2023 Ron Buckton. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-disposablestack.prototype.dispose
description: Throws a TypeError if this is not an Object
info: |
  DisposableStack.prototype.dispose ( )

  1. Let disposableStack be the this value.
  2. Perform ? RequireInternalSlot(disposableStack, [[DisposableState]]).
  ...

  RequireInternalSlot ( O, internalSlot )

  1. If O is not an Object, throw a TypeError exception.
  ...

features: [explicit-resource-management]
---*/

assert.sameValue(typeof DisposableStack.prototype.dispose, 'function');

var dispose = DisposableStack.prototype.dispose;

assert.throws(TypeError, function() {
  dispose.call(undefined);
}, 'undefined');

assert.throws(TypeError, function() {
  dispose.call(null);
}, 'null');

assert.throws(TypeError, function() {
  dispose.call(true);
}, 'true');

assert.throws(TypeError, function() {
  dispose.call(false);
}, 'false');

assert.throws(TypeError, function() {
  dispose.call(1);
}, 'number');

assert.throws(TypeError, function() {
  dispose.call('object');
}, 'string');

var s = Symbol();
assert.throws(TypeError, function() {
  dispose.call(s);
}, 'symbol');
