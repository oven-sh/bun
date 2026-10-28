// Copyright 2018 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-symbol.prototype.description
description: Ensure that 'description' is not an own property of Symbols
features: [Symbol.prototype.description]
---*/

assert.sameValue(
  Symbol().hasOwnProperty('description'),
  false,
  'Symbol().hasOwnProperty("description") returns false'
);
