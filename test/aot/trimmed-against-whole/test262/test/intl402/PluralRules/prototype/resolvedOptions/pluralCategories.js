// Copyright 2018 Igalia S.L. All rights reserved.
// This code is governed by the license found in the LICENSE file.

/*---
esid: sec-Intl.PluralRules.prototype.resolvedOptions
description: >
    Tests that Intl.PluralRules.prototype.resolvedOptions creates a new array
    for the pluralCategories property on every call.
includes: [propertyHelper.js, compareArray.js]
features: [Array.prototype.includes]
---*/

const allowedValues = ["zero", "one", "two", "few", "many", "other"];

const pluralrules = new Intl.PluralRules();
const options1 = pluralrules.resolvedOptions();
const options2 = pluralrules.resolvedOptions();

assert.notSameValue(options1.pluralCategories, options2.pluralCategories, "Should have different arrays");
assert.compareArray(options1.pluralCategories, options2.pluralCategories, "Arrays should have same values");

for (const category of options1.pluralCategories) {
  assert(allowedValues.includes(category), `Found ${category}, expected one of ${allowedValues}`);
}

verifyProperty(options1, "pluralCategories", {
  writable: true,
  enumerable: true,
  configurable: true,
});
