// Copyright (C) 2022 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-Intl.DurationFormat.prototype.formatToParts
description: >
  Intl.DurationFormat.prototype.formatToParts does not implement [[Construct]], is not new-able
info: |
    Built-in function objects that are not identified as constructors do not implement the
    [[Construct]] internal method unless otherwise specified in the description of a particular
    function.
includes: [isConstructor.js]
features: [Reflect.construct, Intl.DurationFormat]
---*/

assert.throws(TypeError, () => {
  new Intl.DurationFormat.prototype.formatToParts();
}, "Calling as constructor");

assert.sameValue(isConstructor(Intl.DurationFormat.prototype.formatToParts), false,
  "isConstructor(Intl.DurationFormat.prototype.formatToParts)");
