// Copyright 2018 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-Intl.RelativeTimeFormat.prototype
description: >
    Checks the "prototype" property of the RelativeTimeFormat constructor.
info: |
    Intl.RelativeTimeFormat.prototype

    The value of Intl.RelativeTimeFormat.prototype is %RelativeTimeFormatPrototype%.

    This property has the attributes { [[Writable]]: false, [[Enumerable]]: false, [[Configurable]]: false }.
includes: [propertyHelper.js]
features: [Intl.RelativeTimeFormat]
---*/

verifyProperty(Intl.RelativeTimeFormat, "prototype", {
  writable: false,
  enumerable: false,
  configurable: false,
});
