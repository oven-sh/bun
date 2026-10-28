// Copyright (C) 2025 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.instant.prototype.tolocalestring
description: Using both dateStyle and timeStyle should not throw
features: [Temporal]
---*/

const item = new Temporal.Instant(0n);
var result = item.toLocaleString("en", { dateStyle: "full", timeStyle: "full" });
assert.sameValue(result.includes(":00"), true, "using both dateStyle and timeStyle should not throw");
