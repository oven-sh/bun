// Copyright (C) 2015 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-weakmap-iterable
description: >
  If the iterable argument is undefined, return new WeakMap object.
info: |
  23.3.1.1 WeakMap ( [ iterable ] )

  ...
  7. Else,
    d. Let iter be GetIterator(iterable).
    e. ReturnIfAbrupt(iter).
  ...
---*/

assert.throws(TypeError, function() {
  new WeakMap({});
});
