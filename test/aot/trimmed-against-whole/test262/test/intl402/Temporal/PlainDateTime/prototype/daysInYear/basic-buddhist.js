// Copyright (C) 2025 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.plaindatetime.prototype.daysinyear
description: Leap years in the Buddhist calendar
features: [Temporal, Intl.Era-monthcode]
---*/

const calendar = "buddhist";
const options = { overflow: "reject" };

// 2513 = ISO year 1970
const leapYears = [
  2515,
  2519,
  2523,
  2527,
  2531,
  2535,
  2539,
  2543,
  2547,
  2551,
  2555,
  2559,
  2563,
  2567,
  2571,
  2575,
  2579,
  2583,
  2587,
  2591,
];

for (var year = 2513; year < 2593; year++) {
    const date = Temporal.PlainDateTime.from({
        year,
        month: 1,
        calendar, day: 1, hour: 12, minute: 34
    });
    assert.sameValue(date.daysInYear, leapYears.includes(year) ? 366 : 365);
}
