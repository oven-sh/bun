// Copyright (C) 2019 Leo Balter. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-aggregate-error.prototype.constructor
description: >
  The `AggregateError.prototype.constructor` property descriptor.
info: |
  The initial value of AggregateError.prototype.constructor is the intrinsic
  object %AggregateError%.

  17 ECMAScript Standard Built-in Objects:

  Every other data property described (...) has the attributes { [[Writable]]: true,
    [[Enumerable]]: false, [[Configurable]]: true } unless otherwise specified.
includes: [propertyHelper.js]
features: [AggregateError]
---*/

verifyProperty(AggregateError.prototype, 'constructor', {
  value: AggregateError,
  enumerable: false,
  writable: true,
  configurable: true
});
