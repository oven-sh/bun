// Copyright (C) 2025 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.plainyearmonth.from
description: Month codes that are invalid for Hebrew calendar
features: [Temporal, Intl.Era-monthcode]
---*/

const calendar = "hebrew";

// 5779 is a leap year
assert.throws(RangeError, () => {
  Temporal.PlainYearMonth.from({ year: 5779, monthCode: "M13", calendar });
}, "M13 should not be a valid month code");

// 5781 is a common year
assert.throws(RangeError, () => {
  Temporal.PlainYearMonth.from({ year: 5781, monthCode: "M13", calendar });
}, "M13 should not be a valid month code");

// Invalid leap months: e.g. M02L
for (var i = 1; i <= 12; i++) {
  if (i === 5)
    continue;
  const monthCode = `M${ i.toString().padStart(2, "0") }L`;
  assert.throws(RangeError, function () {
    Temporal.PlainYearMonth.from({ year: 5779, monthCode, calendar });
  });
}
