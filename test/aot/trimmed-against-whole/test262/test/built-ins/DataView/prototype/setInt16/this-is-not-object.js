// Copyright (C) 2016 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-dataview.prototype.setint16
description: Throws a TypeError if this is not Object
info: |
  24.2.4.16 DataView.prototype.setInt16 ( byteOffset, value [ , littleEndian ] )

  1. Let v be the this value.
  2. If littleEndian is not present, let littleEndian be false.
  3. Return ? SetViewValue(v, byteOffset, littleEndian, "Int16", value).

  24.2.1.2 SetViewValue ( view, requestIndex, isLittleEndian, type, value )

  1. If Type(view) is not Object, throw a TypeError exception.
  ...
features: [Symbol]
---*/

var setInt16 = DataView.prototype.setInt16;

assert.throws(TypeError, function() {
  setInt16.call(undefined);
}, "undefined");

assert.throws(TypeError, function() {
  setInt16.call(null);
}, "null");

assert.throws(TypeError, function() {
  setInt16.call(1);
}, "1");

assert.throws(TypeError, function() {
  setInt16.call("string");
}, "string");

assert.throws(TypeError, function() {
  setInt16.call(true);
}, "true");

assert.throws(TypeError, function() {
  setInt16.call(false);
}, "false");

var s = Symbol("1");
assert.throws(TypeError, function() {
  setInt16.call(s);
}, "symbol");
