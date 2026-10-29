// Copyright (C) 2024 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.plaintime.prototype.tolocalestring
description: Each time component can be formatted individually
locale: [en]
features: [Temporal]
---*/

const epochMs = 1735213600_321;  // 2024-12-26T11:46:40.321Z
const legacyDateLocal = new Date(epochMs);
const legacyDate = new Date(epochMs + legacyDateLocal.getTimezoneOffset() * 60 * 1000);
const plainTime = new Temporal.PlainTime(11, 46, 40, 321);

for (const options of [
  { "hour": "numeric" },
  { "minute": "numeric" },
  { "second": "numeric" },
  { "fractionalSecondDigits": 3 },
  { "dayPeriod": "short" },
]) {
  const plainTimeResult = plainTime.toLocaleString("en", options);
  const legacyDateResult = legacyDate.toLocaleString("en", options);
  assert.sameValue(plainTimeResult, legacyDateResult, `PlainTime.toLocaleString should format lone option ${JSON.stringify(options)}`);
}
