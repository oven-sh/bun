// Copyright (C) 2025 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.plaindate.prototype.daysinyear
description: Leap years in the Indian calendar
features: [Temporal, Intl.Era-monthcode]
---*/

const calendar = "indian";
const options = { overflow: "reject" };

// 1892 = ISO year 1970
const leapYears = [
  1894,
  1898,
  1902,
  1906,
  1910,
  1914,
  1918,
  1922,
  1926,
  1930,
  1934,
  1938,
  1942,
  1946,
  1950,
  1954,
  1958,
  1962,
  1966,
  1970,
];

for (var year = 1894; year < 1974; year++) {
    const date = Temporal.PlainDate.from({
        year,
        month: 1,
        calendar, day: 1
    });
    assert.sameValue(date.daysInYear, leapYears.includes(year) ? 366 : 365);
}
