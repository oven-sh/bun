// Copyright 2016 Mozilla Corporation. All rights reserved.
// This code is governed by the license found in the LICENSE file.

/*---
esid: sec-intl.getcanonicallocales
description: Test Intl.getCanonicalLocales.name for step 7.c.iii 
info: |
  9.2.1 CanonicalizeLocaleList (locales)
    7. Repeat, while k < len.
      c. If kPresent is true, then
        iii. Let tag be ? ToString(kValue).
includes: [compareArray.js]
---*/

var locales = {
  '0': { toString: function() { locales[1] = 'pt-BR'; return 'en-US'; }},
  length: 2
};

assert.compareArray(Intl.getCanonicalLocales(locales), [ "en-US", "pt-BR" ]);
