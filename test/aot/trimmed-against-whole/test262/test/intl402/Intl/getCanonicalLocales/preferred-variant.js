// Copyright (C) 2017 André Bargull. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-intl.getcanonicallocales
description: >
  Call Intl.getCanonicalLocales function with grandfathered language tags.
info: |
  8.2.1 Intl.getCanonicalLocales (locales)
    1. Let ll be ? CanonicalizeLocaleList(locales).
    2. Return CreateArrayFromList(ll).

  9.2.1 CanonicalizeLocaleList (locales)
    ...
    7. Repeat, while k < len
      ...
      c. If kPresent is true, then
        ...
        v. Let canonicalizedTag be CanonicalizeLanguageTag(tag).
      ...

  6.2.3 CanonicalizeLanguageTag ( locale )
    The CanonicalizeLanguageTag abstract operation returns the canonical and case-regularized
    form of the locale argument (which must be a String value that is a structurally valid
    BCP 47 language tag as verified by the IsStructurallyValidLanguageTag abstract operation).
    A conforming implementation shall take the steps specified in RFC 5646 section 4.5, or
    successor, to bring the language tag into canonical form, and to regularize the case of
    the subtags. Furthermore, a conforming implementation shall not take the steps to bring
    a language tag into "extlang form", nor shall it reorder variant subtags.

    The specifications for extensions to BCP 47 language tags, such as RFC 6067, may include
    canonicalization rules for the extension subtag sequences they define that go beyond the
    canonicalization rules of RFC 5646 section 4.5. Implementations are allowed, but not
    required, to apply these additional rules.

includes: [testIntl.js]
---*/

// https://github.com/unicode-org/cldr/blame/master/common/supplemental/supplementalMetadata.xml#L531
// http://unicode.org/reports/tr35/#LocaleId_Canonicalization
var canonicalizedTags = {
  "ja-latn-hepburn-heploc": "ja-Latn-alalc97",
};

// make sure the data above is correct
Object.getOwnPropertyNames(canonicalizedTags).forEach(function (tag) {
  var canonicalizedTag = canonicalizedTags[tag];
  assert(
    isCanonicalizedStructurallyValidLanguageTag(canonicalizedTag),
    "Test data \"" + canonicalizedTag + "\" is not canonicalized and structurally valid language tag."
  );
});

Object.getOwnPropertyNames(canonicalizedTags).forEach(function (tag) {
  var canonicalLocales = Intl.getCanonicalLocales(tag);
  assert.sameValue(canonicalLocales.length, 1);
  assert.sameValue(canonicalLocales[0], canonicalizedTags[tag]);
});
