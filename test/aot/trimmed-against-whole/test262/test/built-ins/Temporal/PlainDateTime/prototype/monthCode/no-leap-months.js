// Copyright (C) 2025 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.plaindatetime.prototype.monthcode
description: iso8601 calendar does not have leap months
features: [Temporal]
---*/


for (var year = 1970; year < 1975; year++) {
  for (var month = 1; month < 13; month++) {
    const date = Temporal.PlainDateTime.from({
      year,
      month,
      day: 1, hour: 12, minute: 34
    });
    assert.sameValue(date.monthCode.endsWith("L"), false);
  }
}
