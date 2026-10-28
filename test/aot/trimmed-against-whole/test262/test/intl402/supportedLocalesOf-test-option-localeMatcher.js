// Copyright 2012 Mozilla Corporation. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
es5id: 9.2.8_1_c
description: Tests that the option localeMatcher is processed correctly.
author: Norbert Lindenberg
includes: [testIntl.js]
---*/

testWithIntlConstructors(function (Constructor) {
    var defaultLocale = new Constructor().resolvedOptions().locale;
    
    var validValues = [undefined, "lookup", "best fit", {toString: function () { return "lookup"; }}];
    validValues.forEach(function (value) {
        var supported = Constructor.supportedLocalesOf([defaultLocale], {localeMatcher: value});
    });
    
    var invalidValues = [null, 0, 5, NaN, true, false, "invalid"];
    invalidValues.forEach(function (value) {
        assert.throws(RangeError, function() {
            var supported = Constructor.supportedLocalesOf([defaultLocale], {localeMatcher: value});
        }, "Invalid localeMatcher value " + value + " was not rejected.");
    });
});
