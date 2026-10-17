// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: The Function.prototype.call.length property has the attribute DontEnum
es5id: 15.3.4.4_A11
description: >
    Checking if enumerating the Function.prototype.call.length
    property fails
---*/
assert(
  Function.prototype.call.hasOwnProperty('length'),
  'Function.prototype.call.hasOwnProperty(\'length\') must return true'
);

assert(
  !Function.prototype.call.propertyIsEnumerable('length'),
  'The value of !Function.prototype.call.propertyIsEnumerable(\'length\') is expected to be true'
);

// CHECK#2
for (var p in Function.prototype.call) {
  assert.notSameValue(p, "length", 'The value of p is not "length"');
}

// TODO: Convert to verifyProperty() format.
