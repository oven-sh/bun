// Copyright (C) 2018 Ujjwal Sharma. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-intl.numberformat
description: >
  Tests that passing a string value to the Intl.NumberFormat constructor is
  equivalent to passing an Array containing the same string value.
info: |
  9.2.1 CanonicalizeLocaleList ( locales )

  3 .If Type(locales) is String, then
    a. Let O be CreateArrayFromList(« locales »).
---*/

const actual = Intl.NumberFormat('en-US').resolvedOptions();
const expected = Intl.NumberFormat(['en-US']).resolvedOptions();

assert.sameValue(actual.locale, expected.locale);
assert.sameValue(actual.minimumIntegerDigits, expected.minimumIntegerDigits);
assert.sameValue(actual.minimumFractionDigits, expected.minimumFractionDigits);
assert.sameValue(actual.maximumFractionDigits, expected.maximumFractionDigits);
assert.sameValue(actual.numberingSystem, expected.numberingSystem);
assert.sameValue(actual.style, expected.style);
assert.sameValue(actual.useGrouping, expected.useGrouping);
