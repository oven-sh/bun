// Copyright (C) 2026 Michael Ficarra. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-iterator.prototype.includes
description: >
  Iterator.prototype.includes returns false when the iterator has already been exhausted
features: [iterator-includes]
---*/

let iterator = (function* () {})();

let step = iterator.next();
assert.sameValue(step.value, undefined);
assert.sameValue(step.done, true);

assert.sameValue(iterator.includes(0), false);
