// Copyright (C) 2021 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.now.plaindatetimeiso
description: Conversion of ISO date-time strings to time zone IDs
features: [Temporal]
---*/

let timeZone = "2021-08-19T17:30";
assert.throws(RangeError, () => Temporal.Now.plainDateTimeISO(timeZone), "bare date-time string is not a time zone");

[
  "2021-08-19T17:30-07:00:01",
  "2021-08-19T17:30-07:00:00",
  "2021-08-19T17:30-07:00:00.1",
  "2021-08-19T17:30-07:00:00.0",
  "2021-08-19T17:30-07:00:00.01",
  "2021-08-19T17:30-07:00:00.00",
  "2021-08-19T17:30-07:00:00.001",
  "2021-08-19T17:30-07:00:00.000",
  "2021-08-19T17:30-07:00:00.0001",
  "2021-08-19T17:30-07:00:00.0000",
  "2021-08-19T17:30-07:00:00.00001",
  "2021-08-19T17:30-07:00:00.00000",
  "2021-08-19T17:30-07:00:00.000001",
  "2021-08-19T17:30-07:00:00.000000",
  "2021-08-19T17:30-07:00:00.0000001",
  "2021-08-19T17:30-07:00:00.0000000",
  "2021-08-19T17:30-07:00:00.00000001",
  "2021-08-19T17:30-07:00:00.00000000",
  "2021-08-19T17:30-07:00:00.000000001",
  "2021-08-19T17:30-07:00:00.000000000",
].forEach((timeZone) => {
  assert.throws(
    RangeError,
    () => Temporal.Now.plainDateTimeISO(timeZone),
    `ISO string ${timeZone} with a sub-minute offset is not a valid time zone`
  );
});

// The following are all valid strings so should not throw:

[
  "2021-08-19T17:30Z",
  "2021-08-19T1730Z",
  "2021-08-19T17:30-07:00",
  "2021-08-19T1730-07:00",
  "2021-08-19T17:30-0700",
  "2021-08-19T1730-0700",
  "2021-08-19T17:30[UTC]",
  "2021-08-19T1730[UTC]",
  "2021-08-19T17:30Z[UTC]",
  "2021-08-19T1730Z[UTC]",
  "2021-08-19T17:30-07:00[UTC]",
  "2021-08-19T1730-07:00[UTC]",
  "2021-08-19T17:30-0700[UTC]",
  "2021-08-19T1730-0700[UTC]",
].forEach((timeZone) => {
  Temporal.Now.plainDateTimeISO(timeZone);
});
