// Copyright (C) 2026 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-partitiondatetimerangepattern
description: TimeClip is not applied for Temporal plain objects.
info: |
  PartitionDateTimeRangePattern ( _dateTimeFormat_, _x_, _y_ )
    2. Let _xFormatRecord_ be ? ValueFormatRecord(_dateTimeFormat_, _x_).
    3. Let _yFormatRecord_ be ? ValueFormatRecord(_dateTimeFormat_, _y_).
features: [Temporal]
locale: [en]
---*/

// Based on the test in
// DateTime/prototype/format/temporal-objects-no-time-clip.js by André Bargull.

// Test with Temporal default calendar "iso8601" and additionally "gregory".
var calendars = ["iso8601", "gregory"];

for (var calendar of calendars) {
  var dtf = new Intl.DateTimeFormat("en", {calendar});

  // Minimum and maximum PlainDate values
  var minDate = new Temporal.PlainDate(-271821, 4, 19, calendar);
  var maxDate = new Temporal.PlainDate(275760, 9, 13, calendar);
  var dateResult = dtf.formatRange(minDate, maxDate);
  assert(dateResult.includes("-271821") || dateResult.includes("271822"), "dateResult includes min year");
  assert(dateResult.includes("4"), "dateResult includes min month");
  assert(dateResult.includes("19"), "dateResult includes min day");
  assert(dateResult.includes("275760"), "dateResult includes max year");
  // no point in asserting it includes month "9", since it already includes "19"
  assert(dateResult.includes("13"), "result includes max day");

  // Minimum and maximum PlainDateTime values
  var minDateTime = new Temporal.PlainDateTime(-271821, 4, 19, 0, 0, 0, 0, 0, 1, calendar);
  var maxDateTime = new Temporal.PlainDateTime(275760, 9, 13, 23, 59, 59, 999, 999, 999, calendar);
  var dateTimeResult = dtf.formatRange(minDateTime, maxDateTime);
  assert(dateTimeResult.includes("-271821") || dateTimeResult.includes("271822"), "dateTimeResult includes min year");
  assert(dateTimeResult.includes("4"), "dateTimeResult includes min month");
  assert(dateTimeResult.includes("19"), "dateTimeResult includes min day");
  assert(dateTimeResult.includes("275760"), "dateTimeResult includes max year");
  assert(dateTimeResult.includes("13"), "dateTimeResult includes max day");

  // Minimum and maximum PlainYearMonth values
  var minYearMonth = new Temporal.PlainYearMonth(-271821, 4, calendar);
  var maxYearMonth = new Temporal.PlainYearMonth(275760, 9, calendar);
  var yearMonthResult = dtf.formatRange(minYearMonth, maxYearMonth);
  assert(yearMonthResult.includes("-271821") || yearMonthResult.includes("271822"), "yearMonthResult includes min year");
  assert(yearMonthResult.includes("4"), "yearMonthResult includes min month");
  assert(yearMonthResult.includes("275760"), "yearMonthResult includes max year");
  assert(yearMonthResult.includes("9"), "yearMonthResult includes max month");
}
