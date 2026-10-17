// Copyright 2019 Google Inc.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-Intl.ListFormat.prototype.formatToParts
description: >
    Checks the behavior of Abstract Operation StringListFromIterable
    called by Intl.ListFormat.prototype.formatToParts().
info: |
    StringListFromIterable
    1. If iterable is undefined, then
      a. Return a new empty List.
    2. Let iteratorRecord be ? GetIterator(iterable).
    3. Let list be a new empty List.
    4. Let next be true.
    5. Repeat, while next is not false
      a. Set next to ? IteratorStep(iteratorRecord).
      b. If next is not false, then
        i. Let nextValue be ? IteratorValue(next).
        ii. If Type(nextValue) is not String, then
          1. Let error be ThrowCompletion(a newly created TypeError object).
          2. Return ? IteratorClose(iteratorRecord, error).
        iii. Append nextValue to the end of the List list.
    6. Return list.
features: [Intl.ListFormat]
---*/

let lf = new Intl.ListFormat();
// Test the failure case.
let iterable_of_strings_and_number = {
  [Symbol.iterator]() {
    return this;
  },
  count: 0,
  next() {
    this.count++;
    if (this.count ==  3) {
      return {done:false, value: 3};
    }
    if (this.count < 5) {
      return {done: false, value: String(this.count)};
    }
    return {done:true}
  }
};
assert.throws(TypeError,
    ()=> {lf.formatToParts(iterable_of_strings_and_number)},
    "Iterable yielded 3 which is not a string");
assert.sameValue(iterable_of_strings_and_number.count, 3);
