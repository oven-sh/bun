// Copyright 2025 Google Inc, Igalia S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.plainmonthday.from
description: monthCode should work for Chinese calendar leap dates
features: [Temporal]
includes: [temporalHelpers.js]
---*/

const calendar = "chinese";

const monthDayCases = [
  {
    year: 2001,
    month: 5,
    monthCode: "M04L",
    day: 15,
    referenceYear: 1963
  },
  {
    year: 2000,
    month: 6,
    monthCode: "M06",
    day: 29,
    referenceYear: 1972
  },
];
for (var {monthCode, month, day, year, referenceYear} of monthDayCases) {
  const md = Temporal.PlainMonthDay.from({
    year,
    month,
    day,
    calendar
  });

  TemporalHelpers.assertPlainMonthDay(md, monthCode, day, "md", referenceYear);

  const md2 = Temporal.PlainMonthDay.from({
    monthCode,
    day,
    calendar
  });
  TemporalHelpers.assertPlainMonthDay(md2, monthCode, day, "md2", referenceYear);
  assert.sameValue(md.equals(md2), true);

  assert.throws(RangeError, () => {
    Temporal.PlainMonthDay.from({
      monthCode: "M15",
      day: 1,
      calendar
    }, { overflow: "reject" });
  });

  assert.throws(RangeError, () => {
    Temporal.PlainMonthDay.from({
      monthCode: "M15",
      day: 1,
      calendar
    });
  });

  assert.throws(RangeError, () => {
    Temporal.PlainMonthDay.from({
      year,
      month: 15,
      day: 1,
      calendar
    }, { overflow: "reject" });
  });

  const constrained = Temporal.PlainMonthDay.from({
    year,
    month: 15,
    day: 1,
    calendar
  });
  assert.sameValue(constrained.monthCode, "M12");
}
