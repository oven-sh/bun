// Copyright 2023 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-collator-comparestrings
description: test CompareStrings sync with resolvedOptions().ignorePunctuation.
locale: [en, th, ja]
---*/
// test on three locales, 'th' has different default.
['en', 'th', 'ja'].forEach((locale) => {
  [undefined, true, false].forEach((ignorePunctuation) => {
    let col = new Intl.Collator(locale, {ignorePunctuation});
    // if ignorePunctuation is true, the comparison will be 0
    let expected = col.resolvedOptions().ignorePunctuation ? 0 : -1;
    assert.sameValue(col.compare("", " "), expected, "Compare to space");
    assert.sameValue(col.compare("", "*"), expected, "Compare to star");
  });
});
