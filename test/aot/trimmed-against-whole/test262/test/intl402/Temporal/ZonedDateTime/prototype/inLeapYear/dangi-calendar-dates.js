// Copyright 2025 Google Inc, Igalia S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.zoneddatetime.prototype.inleapyear
description: inLeapYear should work for Dangi calendar dates
features: [Temporal]
---*/

const calendar = "dangi";

const leapYears = [
  1971, 1974, 1976, 1979, 1982,
  1984, 1987, 1990, 1993, 1995,
  1998, 2001, 2004, 2006, 2009,
  2012, 2014, 2017, 2020, 2023,
  2025, 2028, 2031, 2033, 2036,
  2039, 2042, 2044, 2047
];

for (var year = 1970; year < 2050; year++) {
  const date = Temporal.ZonedDateTime.from({
    year,
    month: 1,
    day: 1,
    timeZone: "UTC",
    calendar
  });
  assert.sameValue(date.inLeapYear, leapYears.includes(year));
}
