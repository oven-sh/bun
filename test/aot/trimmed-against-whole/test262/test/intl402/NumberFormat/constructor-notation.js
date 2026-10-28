// Copyright 2019 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-intl.numberformat
description: Checks handling of the notation option to the NumberFormat constructor.
info: |
  Intl.NumberFormat ( [ locales [ , options ] ] )

  1. Let _notation_ be ? GetOption(_options_, *"notation"*, ~string~,
     « *"standard"*, *"scientific"*, *"engineering"*, *"compact"* »,
     *"standard"*).
  1. Set _numberFormat_.[[Notation]] to _notation_.

features: [Intl.NumberFormat-unified]
---*/

const values = [
  [undefined, "standard"],
  ["standard"],
  ["scientific"],
  ["engineering"],
  ["compact"],
];

for (const [value, expected = value] of values) {
  const nf = new Intl.NumberFormat([], {
    notation: value,
  });
  const resolvedOptions = nf.resolvedOptions();
  assert.sameValue("notation" in resolvedOptions, true);
  assert.sameValue(resolvedOptions.notation, expected);
}
