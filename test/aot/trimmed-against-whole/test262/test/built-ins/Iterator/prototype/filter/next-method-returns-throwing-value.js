// Copyright (C) 2023 Michael Ficarra. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-iteratorprototype.filter
description: >
  Underlying iterator next returns object with throwing value getter
info: |
  %Iterator.prototype%.filter ( predicate )

  3.b.iii. Let value be ? IteratorValue(next).

features: [iterator-helpers]
flags: []
---*/
class ThrowingIterator extends Iterator {
  next() {
    return {
      done: false,
      get value() {
        throw new Test262Error();
      },
    };
  }
  return() {
    throw new Error();
  }
}

let iterator = new ThrowingIterator().filter(() => true);

assert.throws(Test262Error, function () {
  iterator.next();
});
