// Copyright (c) 2012 Ecma International.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
es5id: 15.2.3.7-5-b-92
description: >
    Object.defineProperties - value of 'configurable' property of
    'descObj' is NaN (8.10.5 step 4.b)
includes: [propertyHelper.js]
---*/

var obj = {};

Object.defineProperties(obj, {
  property: {
    configurable: NaN
  }
});

verifyProperty(obj, "property", {
  configurable: false,
});
