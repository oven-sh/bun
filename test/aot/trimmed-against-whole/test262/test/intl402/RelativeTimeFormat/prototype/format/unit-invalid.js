// Copyright 2018 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-Intl.RelativeTimeFormat.prototype.format
description: Checks the handling of invalid unit arguments to Intl.RelativeTimeFormat.prototype.format().
info: |
    SingularRelativeTimeUnit ( unit )

    10. If unit is not one of "second", "minute", "hour", "day", "week", "month", "quarter", "year", throw a RangeError exception.

features: [Intl.RelativeTimeFormat]
---*/

const rtf = new Intl.RelativeTimeFormat("en-US");

assert.sameValue(typeof rtf.format, "function");

const values = [
  undefined,
  null,
  true,
  1,
  0.1,
  NaN,
  {},
  "",
  "SECOND",
  "MINUTE",
  "HOUR",
  "DAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "YEAR",
  "decade",
  "decades",
  "century",
  "centuries",
  "millisecond",
  "milliseconds",
  "microsecond",
  "microseconds",
  "nanosecond",
  "nanoseconds",
];

for (const value of values) {
  assert.throws(RangeError, () => rtf.format(0, value), String(value));
}

const symbol = Symbol();
assert.throws(TypeError, () => rtf.format(0, symbol), "symbol");
