// Copyright (C) 2015 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
es6id: 9.5.15
description: >
    Proxy ( target, handler )
    ...
    3. If Type(handler) is not Object, throw a TypeError exception.
    ...
features: [Proxy]
---*/

assert.throws(TypeError, function() {
  new Proxy({}, 0);
});
