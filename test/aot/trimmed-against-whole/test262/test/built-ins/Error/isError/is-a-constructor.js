// Copyright (C) 2024 Jordan Harband. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-error.iserror
description: >
  Error.isError does not implement [[Construct]]
info: |
  IsConstructor ( argument )

  The abstract operation IsConstructor takes argument argument (an ECMAScript language value).
  It determines if argument is a function object with a [[Construct]] internal method.
  It performs the following steps when called:

  If Type(argument) is not Object, return false.
  If argument has a [[Construct]] internal method, return true.
  Return false.
includes: [isConstructor.js]
features: [Error.isError, Reflect.construct]
---*/

assert.sameValue(isConstructor(Error.isError), false, 'isConstructor(Error.isError) must return false');
assert.throws(TypeError, function () { new Error.isError(); });

