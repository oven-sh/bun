// Copyright 2012 Mozilla Corporation. All rights reserved.
// This code is governed by the license found in the LICENSE file.

/*---
es5id: 10.3.3
description: >
    Tests that the object returned by
    Intl.Collator.prototype.resolvedOptions  has the right properties.
author: Norbert Lindenberg
includes: [testIntl.js, propertyHelper.js]
---*/

var actual = new Intl.Collator().resolvedOptions();

var actual2 = new Intl.Collator().resolvedOptions();
assert.notSameValue(actual2, actual, "resolvedOptions returned the same object twice.");

var collations = ["default", ...allCollations()];

// this assumes the default values where the specification provides them
assert(isCanonicalizedStructurallyValidLanguageTag(actual.locale),
       "Invalid locale: " + actual.locale);
assert.sameValue(actual.usage, "sort");
assert.sameValue(actual.sensitivity, "variant");
assert.sameValue(actual.ignorePunctuation, false);
assert.notSameValue(actual.collation, "search");
assert.notSameValue(actual.collation, "standard");
assert.notSameValue(collations.indexOf(actual.collation), -1,
                    "Invalid collation: " + actual.collation);

var dataPropertyDesc = { writable: true, enumerable: true, configurable: true };
verifyProperty(actual, "locale", dataPropertyDesc);
verifyProperty(actual, "usage", dataPropertyDesc);
verifyProperty(actual, "sensitivity", dataPropertyDesc);
verifyProperty(actual, "ignorePunctuation", dataPropertyDesc);
verifyProperty(actual, "collation", dataPropertyDesc);

// "numeric" is an optional property.
if (actual.hasOwnProperty("numeric")) {
    assert.notSameValue([true, false].indexOf(actual.numeric), -1);
    verifyProperty(actual, "numeric", dataPropertyDesc);
}

// "caseFirst" is an optional property.
if (actual.hasOwnProperty("caseFirst")) {
    assert.notSameValue(["upper", "lower", "false"].indexOf(actual.caseFirst), -1);
    verifyProperty(actual, "caseFirst", dataPropertyDesc);
}
