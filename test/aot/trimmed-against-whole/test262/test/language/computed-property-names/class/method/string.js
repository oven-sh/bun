// Copyright (C) 2014 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
es6id: 12.2.5
description: >
    computed property class method names can be a string
includes: [compareArray.js]
---*/

function ID(x) {
  return x;
}

class C {
  a() { return 'A'}
  ['b']() { return 'B'; }
  c() { return 'C'; }
  [ID('d')]() { return 'D'; }
}
assert.sameValue(new C().a(), 'A', "`new C().a()` returns `'A'`. Defined as `a() { return 'A'}`");
assert.sameValue(new C().b(), 'B', "`new C().b()` returns `'B'`. Defined as `['b']() { return 'B'; }`");
assert.sameValue(new C().c(), 'C', "`new C().c()` returns `'C'`. Defined as `c() { return 'C'; }`");
assert.sameValue(new C().d(), 'D', "`new C().d()` returns `'D'`. Defined as `[ID('d')]() { return 'D'; }`");
assert.sameValue(Object.keys(C.prototype).length, 0, "No enum keys from C.prototype");
assert.compareArray(
  Object.getOwnPropertyNames(C.prototype),
  ['constructor', 'a', 'b', 'c', 'd']
);
