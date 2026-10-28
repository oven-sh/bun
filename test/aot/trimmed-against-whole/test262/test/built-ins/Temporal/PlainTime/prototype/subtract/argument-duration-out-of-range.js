// Copyright (C) 2023 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.plaintime.prototype.subtract
description: Duration-like argument that is out of range
features: [Temporal]
---*/

const instance = new Temporal.PlainTime();

const cases = [
  // 2^32 = 4294967296
  ["P4294967296Y", "string with years > max"],
  [{ years: 4294967296 }, "property bag with years > max"],
  ["-P4294967296Y", "string with years < min"],
  [{ years: -4294967296 }, "property bag with years < min"],
  ["P4294967296M", "string with months > max"],
  [{ months: 4294967296 }, "property bag with months > max"],
  ["-P4294967296M", "string with months < min"],
  [{ months: -4294967296 }, "property bag with months < min"],
  ["P4294967296W", "string with weeks > max"],
  [{ weeks: 4294967296 }, "property bag with weeks > max"],
  ["-P4294967296W", "string with weeks < min"],
  [{ weeks: -4294967296 }, "property bag with weeks < min"],

  // ceil(max safe integer / 86400) = 104249991375
  ["P104249991375D", "string with days > max"],
  [{ days: 104249991375 }, "property bag with days > max"],
  ["P104249991374DT24H", "string where hours balance into days > max"],
  [{ days: 104249991374, hours: 24 }, "property bag where hours balance into days > max"],
  ["-P104249991375D", "string with days < min"],
  [{ days: -104249991375 }, "property bag with days < min"],
  ["-P104249991374DT24H", "string where hours balance into days < min"],
  [{ days: -104249991374, hours: -24 }, "property bag where hours balance into days < min"],

  // ceil(max safe integer / 3600) = 2501999792984
  ["PT2501999792984H", "string with hours > max"],
  [{ hours: 2501999792984 }, "property bag with hours > max"],
  ["PT2501999792983H60M", "string where minutes balance into hours > max"],
  [{ hours: 2501999792983, minutes: 60 }, "property bag where minutes balance into hours > max"],
  ["-PT2501999792984H", "string with hours < min"],
  [{ hours: -2501999792984 }, "property bag with hours < min"],
  ["-PT2501999792983H60M", "string where minutes balance into hours < min"],
  [{ hours: -2501999792983, minutes: -60 }, "property bag where minutes balance into hours < min"],

  // ceil(max safe integer / 60) = 150119987579017
  ["PT150119987579017M", "string with minutes > max"],
  [{ minutes: 150119987579017 }, "property bag with minutes > max"],
  ["PT150119987579016M60S", "string where seconds balance into minutes > max"],
  [{ minutes: 150119987579016, seconds: 60 }, "property bag where seconds balance into minutes > max"],
  ["-PT150119987579017M", "string with minutes < min"],
  [{ minutes: -150119987579017 }, "property bag with minutes < min"],
  ["-PT150119987579016M60S", "string where seconds balance into minutes < min"],
  [{ minutes: -150119987579016, seconds: -60 }, "property bag where seconds balance into minutes < min"],

  // 2^53 = 9007199254740992
  ["PT9007199254740992S", "string with seconds > max"],
  [{ seconds: 9007199254740992 }, "property bag with seconds > max"],
  [{ seconds: 9007199254740991, milliseconds: 1000 }, "property bag where milliseconds balance into seconds > max"],
  [{ seconds: 9007199254740991, microseconds: 1000000 }, "property bag where microseconds balance into seconds > max"],
  [{ seconds: 9007199254740991, nanoseconds: 1000000000 }, "property bag where nanoseconds balance into seconds > max"],
  ["-PT9007199254740992S", "string with seconds < min"],
  [{ seconds: -9007199254740992 }, "property bag with seconds < min"],
  [{ seconds: -9007199254740991, milliseconds: -1000 }, "property bag where milliseconds balance into seconds < min"],
  [{ seconds: -9007199254740991, microseconds: -1000000 }, "property bag where microseconds balance into seconds < min"],
  [{ seconds: -9007199254740991, nanoseconds: -1000000000 }, "property bag where nanoseconds balance into seconds < min"],
];

for (const [arg, descr] of cases) {
  assert.throws(RangeError, () => instance.subtract(arg), `${descr} is out of range`);
}
