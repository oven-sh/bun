// Copyright (C) 2021 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.zoneddatetime.prototype.with
description: Fallback value for overflow option
info: |
    sec-getoption step 3:
      3. If _value_ is *undefined*, return _fallback_.
    sec-temporal-totemporaloverflow step 1:
      1. Return ? GetOption(_normalizedOptions_, *"overflow"*, « String », « *"constrain"*, *"reject"* », *"constrain"*).
    sec-temporal-interprettemporaldatetimefields steps 2–3:
      2. Let _temporalDate_ be ? DateFromFields(_calendar_, _fields_, _options_).
      3. Let _overflow_ be ? ToTemporalOverflow(_options_).
    sec-temporal.zoneddatetime.prototype.with step 24:
      24. Let _dateTimeResult_ be ? InterpretTemporalDateTimeFields(_calendar_, _fields_, _options_).
features: [Temporal]
---*/

const datetime = new Temporal.ZonedDateTime(1_000_000_000_987_654_321n, "UTC");
const explicit = datetime.with({ second: 67 }, { overflow: undefined });
assert.sameValue(explicit.epochNanoseconds, 1_000_000_019_987_654_321n, "default overflow is constrain");
const implicit = datetime.with({ second: 67 }, {});
assert.sameValue(implicit.epochNanoseconds, 1_000_000_019_987_654_321n, "default overflow is constrain");
const lambda = datetime.with({ second: 67 }, () => {});
assert.sameValue(lambda.epochNanoseconds, 1_000_000_019_987_654_321n, "default overflow is constrain");
