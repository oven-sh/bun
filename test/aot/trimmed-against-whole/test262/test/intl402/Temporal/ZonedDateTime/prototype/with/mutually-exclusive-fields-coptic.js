// Copyright (C) 2025 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.zoneddatetime.prototype.with
description: Calendar-specific mutually exclusive keys in the coptic calendar
info: NonIsoFieldKeysToIgnore ( _calendar_, _keys_ )
includes: [temporalHelpers.js]
features: [Temporal, Intl.Era-monthcode]
---*/

const options = { overflow: "reject" };
const instance = Temporal.ZonedDateTime.from({ year: 1742, monthCode: "M12", day: 15, hour: 12, minute: 34, timeZone: "UTC", calendar: "coptic" }, options);

TemporalHelpers.assertPlainDateTime(
  instance.toPlainDateTime(),
  1742, 12, "M12", 15, 12, 34, 0, 0, 0, 0,
  "check that all fields are as expected",
  /* era = */ "am", /* eraYear = */ 1742
);

TemporalHelpers.assertPlainDateTime(
  instance.with({ era: "am", eraYear: 1740 }, options).toPlainDateTime(),
  1740, 12, "M12", 15, 12, 34, 0, 0, 0, 0,
  "era and eraYear together exclude year",
  "am", 1740
);

TemporalHelpers.assertPlainDateTime(
  instance.with({ year: 1735 }, options).toPlainDateTime(),
  1735, 12, "M12", 15, 12, 34, 0, 0, 0, 0,
  "year excludes era and eraYear",
  "am", 1735
);

TemporalHelpers.assertPlainDateTime(
  instance.with({ month: 5 }, options).toPlainDateTime(),
  1742, 5, "M05", 15, 12, 34, 0, 0, 0, 0,
  "month excludes monthCode",
  "am", 1742
);

TemporalHelpers.assertPlainDateTime(
  instance.with({ monthCode: "M05" }, options).toPlainDateTime(),
  1742, 5, "M05", 15, 12, 34, 0, 0, 0, 0,
  "monthCode excludes month",
  "am", 1742
);

assert.throws(
  TypeError,
  () => instance.with({ eraYear: 1741 }),
  "eraYear excludes year and era, and cannot be provided without era",
);

assert.throws(
  TypeError,
  () => instance.with({ era: "am" }),
  "era excludes year and eraYear, and cannot be provided without eraYear",
);
