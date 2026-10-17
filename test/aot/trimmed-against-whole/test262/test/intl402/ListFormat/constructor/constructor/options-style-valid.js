// Copyright 2018 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-Intl.ListFormat
description: Checks handling of valid values for the style option to the ListFormat constructor.
info: |
    InitializeListFormat (listFormat, locales, options)
    InitializeListFormat (listFormat, locales, options)
    12. Let type be ? GetOption(options, "type", "string", « "conjunction",
        "disjunction", "unit" », "conjunction").
    13. Set listFormat.[[Type]] to type.
    14. Let style be ? GetOption(options, "style", "string", « "long", "short",
        "narrow" », "long").
    15. Set listFormat.[[Style]] to style.
features: [Intl.ListFormat]
---*/

const validOptions = [
  [undefined, "long"],
  ["long", "long"],
  ["short", "short"],
  ["narrow", "narrow"],
  [{ toString() { return "short"; } }, "short"],
  [{ toString() { return "long"; } }, "long"],
  [{ toString() { return "narrow"; } }, "narrow"],
];

for (const [validOption, expected] of validOptions) {
  const lf = new Intl.ListFormat([], {"style": validOption});
  const resolvedOptions = lf.resolvedOptions();
  assert.sameValue(resolvedOptions.style, expected);
}
