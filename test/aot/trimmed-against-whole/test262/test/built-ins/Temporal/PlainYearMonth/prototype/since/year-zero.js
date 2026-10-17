// Copyright (C) 2022 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.plainyearmonth.prototype.since
description: Negative zero, as an extended year, is rejected
features: [Temporal, arrow-function]
---*/

const invalidStrings = [
  "-000000-06",
  "-000000-06-24",
  "-000000-06-24T15:43:27",
  "-000000-06-24T15:43:27+01:00",
  "-000000-06-24T15:43:27+00:00[UTC]",
];
const instance = new Temporal.PlainYearMonth(2000, 5);
invalidStrings.forEach((arg) => {
  assert.throws(
    RangeError,
    () => instance.since(arg),
    "reject minus zero as extended year"
  );
});
