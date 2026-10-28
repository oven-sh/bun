// Copyright (C) 2025 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.plaindatetime.from
description: Basic functionality of resolving fields in hebrew calendar leap year
features: [Temporal, Intl.Era-monthcode]
includes: [temporalHelpers.js]
---*/

const calendar = "hebrew";
const options = { overflow: "reject" };

const leapYear = 5784;
const monthLengths5784 = [
  undefined,
  ["M01", 30],
  ["M02", 29],
  ["M03", 29],
  ["M04", 29],
  ["M05", 30],
  ["M05L", 30],
  ["M06", 29],
  ["M07", 30],
  ["M08", 29],
  ["M09", 30],
  ["M10", 29],
  ["M11", 30],
  ["M12", 29]
];

for (let month = 1; month < 14; month++) {
  const [monthCode, day] = monthLengths5784[month];

  const startOfMonth = Temporal.PlainDateTime.from({ year: leapYear, month, day: 1, hour: 12, minute: 34, calendar }, options);
  TemporalHelpers.assertPlainDateTime(
    startOfMonth,
    leapYear, month, monthCode, 1, 12, 34, 0, 0, 0, 0,
    `Start of month ${monthCode} in leap year`,
    "am", leapYear
  );

  const endOfMonth = Temporal.PlainDateTime.from({ year: leapYear, month, day, hour: 12, minute: 34, calendar }, options);
  TemporalHelpers.assertPlainDateTime(
    endOfMonth,
    leapYear, month, monthCode, day, 12, 34, 0, 0, 0, 0,
    `End of month ${monthCode} in leap year`,
    "am", leapYear
  );
}

