// Copyright (C) 2019 Leo Balter. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-finalization-registry.prototype.register
description: unregisterToken may be the same as holdings and target
info: |
  FinalizationRegistry.prototype.register ( target , holdings [, unregisterToken ] )

  1. Let finalizationRegistry be the this value.
  2. If Type(finalizationRegistry) is not Object, throw a TypeError exception.
  3. If finalizationRegistry does not have a [[Cells]] internal slot, throw a TypeError exception.
  4. If Type(target) is not Object, throw a TypeError exception.
  5. If SameValue(target, holdings), throw a TypeError exception.
  6. If Type(unregisterToken) is not Object,
    a. If unregisterToken is not undefined, throw a TypeError exception.
    b. Set unregisterToken to empty.
  7. Let cell be the Record { [[Target]] : target, [[Holdings]]: holdings, [[UnregisterToken]]: unregisterToken }.
  8. Append cell to finalizationRegistry.[[Cells]].
  9. Return undefined.
features: [FinalizationRegistry]
---*/

var finalizationRegistry = new FinalizationRegistry(function() {});

var target = {};
assert.throws(TypeError, () => finalizationRegistry.register(target, target, target));
