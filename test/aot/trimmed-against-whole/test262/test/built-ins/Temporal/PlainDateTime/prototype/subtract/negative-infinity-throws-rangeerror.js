// Copyright (C) 2020 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
description: Temporal.PlainDateTime.prototype.subtract throws a RangeError if any value in a property bag is -Infinity
esid: sec-temporal.plaindatetime.prototype.subtract
features: [Temporal]
---*/

const overflows = ["constrain", "reject"];
const fields = ["years", "months", "weeks", "days", "hours", "minutes", "seconds", "milliseconds", "microseconds", "nanoseconds"];

const instance = Temporal.PlainDateTime.from({ year: 2000, month: 5, day: 2, minute: 34, second: 56, millisecond: 987, microsecond: 654, nanosecond: 321 });

overflows.forEach((overflow) => {
  fields.forEach((field) => {
    assert.throws(RangeError, () => instance.subtract({ [field]: -Infinity }, { overflow }));
  });
});

let calls = 0;
const obj = {
  valueOf() {
    calls++;
    return -Infinity;
  }
};

overflows.forEach((overflow) => {
  fields.forEach((field) => {
    calls = 0;
    assert.throws(RangeError, () => instance.subtract({ [field]: obj }, { overflow }));
    assert.sameValue(calls, 1, "it fails after fetching the primitive value");
  });
});
