// Copyright (C) 2025 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.plainyearmonth.prototype.subtract
description: Check various basic calculations involving leap years (ethioaa calendar)
features: [Temporal, Intl.Era-monthcode]
includes: [temporalHelpers.js]
---*/

const calendar = "ethioaa";
const options = { overflow: "reject" };

const leapDay = Temporal.PlainYearMonth.from({ year: 7515, monthCode: "M13", calendar }, options);

const years1 = new Temporal.Duration(-1);
const years1n = new Temporal.Duration(1);
const years4 = new Temporal.Duration(-4);
const years4n = new Temporal.Duration(4);

TemporalHelpers.assertPlainYearMonth(
  leapDay.subtract(years1, options),
  7516, 13, "M13", "Adding 1 year to epagomenal month",
  "aa", 7516, null);

TemporalHelpers.assertPlainYearMonth(
  leapDay.subtract(years1n, options),
  7514, 13, "M13", "Subtracting 1 year from epagomenal month",
  "aa", 7514, null);

TemporalHelpers.assertPlainYearMonth(
  leapDay.subtract(years4, options),
  7519, 13, "M13", "Adding 4 years to epagomenal month",
  "aa", 7519, null);

TemporalHelpers.assertPlainYearMonth(
  leapDay.subtract(years4n, options),
  7511, 13, "M13", "Subtracting 4 years from epagomenal month",
  "aa", 7511, null);
