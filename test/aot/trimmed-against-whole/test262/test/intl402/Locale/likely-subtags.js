// Copyright 2018 André Bargull; Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-intl.locale
description: >
    Verifies canonicalization, minimization and maximization of specific tags.
info: |
    Intl.Locale.prototype.maximize ()
    3. Let maximal be the result of the Add Likely Subtags algorithm applied to loc.[[Locale]].

    Intl.Locale.prototype.minimize ()
    3. Let minimal be the result of the Remove Likely Subtags algorithm applied to loc.[[Locale]].
features: [Intl.Locale]
---*/

const testDataMaximal = {
    // Language subtag is present.
    "en": "en-Latn-US",

    // Language and script subtags are present.
    "en-Latn": "en-Latn-US",
    "en-Shaw": "en-Shaw-GB",
    "en-Arab": "en-Arab-US",

    // Language and region subtags are present.
    "en-US": "en-Latn-US",
    "en-GB": "en-Latn-GB",
    "en-FR": "en-Latn-FR",

    // Language, script, and region subtags are present.
    "it-Kana-CA": "it-Kana-CA",

    // Undefined primary language.
    "und": "en-Latn-US",
    "und-Thai": "th-Thai-TH",
    "und-419": "es-Latn-419",
    "und-150": "en-Latn-150",
    "und-AT": "de-Latn-AT",
    "und-Cyrl-RO": "bg-Cyrl-RO",

    // Before CLDR 44, "und" primary language subtag was left unchanged in some
    // cases. Starting with CLDR 44, the "und" language subtag is always replaced.
    "und-AQ": "en-Latn-AQ",
};

const testDataMinimal = {
    // Language subtag is present.
    "en": "en",

    // Language and script subtags are present.
    "en-Latn": "en",
    "ar-Arab": "ar",

    // Language and region subtags are present.
    "en-US": "en",
    "en-GB": "en-GB",

    // Reverse cases from |testDataMaximal|.
    "en-Latn-US": "en",
    "en-Shaw-GB": "en-Shaw",
    "en-Arab-US": "en-Arab",
    "en-Latn-GB": "en-GB",
    "en-Latn-FR": "en-FR",
    "it-Kana-CA": "it-Kana-CA",
    "th-Thai-TH": "th",
    "es-Latn-419": "es-419",
    "ru-Cyrl-RU": "ru",
    "de-Latn-AT": "de-AT",
    "bg-Cyrl-RO": "bg-RO",
    "und-Latn-AQ": "en-AQ",
};

// Add variants, extensions, and privateuse subtags and ensure they don't
// modify the result of the likely subtags algorithms.
const extras = [
    "",
    "-fonipa",
    "-a-not-assigned",
    "-u-attr",
    "-u-co",
    "-u-co-phonebk",
    "-x-private",
];

for (const [tag, maximal] of Object.entries(testDataMaximal)) {
    assert.sameValue(new Intl.Locale(maximal).maximize().toString(), maximal,
                     `"${maximal}" should be maximal`);

    for (const extra of extras) {
        const input = tag + extra;
        const output = maximal + extra;
        assert.sameValue(new Intl.Locale(input).maximize().toString(), output,
                         `"${input}".maximize() should be "${output}"`);
    }
}

for (const [tag, minimal] of Object.entries(testDataMinimal)) {
    assert.sameValue(new Intl.Locale(minimal).minimize().toString(), minimal,
                     `"${minimal}" should be minimal`);

    for (const extra of extras) {
        const input = tag + extra;
        const output = minimal + extra;
        assert.sameValue(new Intl.Locale(input).minimize().toString(), output,
                         `"${input}".minimize() should be "${output}"`);
    }
}

// privateuse only.
// "x" in "x-private" does not match unicode_language_subtag
// unicode_language_subtag = alpha{2,3} | alpha{5,8};
assert.throws(RangeError, () => new Intl.Locale("x-private"));
