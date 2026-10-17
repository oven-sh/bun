// Copyright (C) 2023 Anthony Frehner and Kevin Gibbons. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-set.prototype.difference
description: Set.prototype.difference can combine Sets that have the same content
features: [set-methods]
includes: [compareArray.js]
---*/

const s1 = new Set([1, 2]);
const s2 = new Set([1, 2]);
const expected = [];
const combined = s1.difference(s2);

assert.compareArray([...combined], expected);
assert.sameValue(combined instanceof Set, true, "The returned object is a Set");
assert.sameValue(combined === s1, false, "The returned object is a new object");
assert.sameValue(combined === s2, false, "The returned object is a new object");
