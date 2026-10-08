a = {
  a: "a"
};

a = {
  'b': "b"
};

a = {
  // Escapes should stay as escapes and not be unquoted.
  '\u0062': "b",
  '\u0031': "1"
};

a = {
  c1: "c1",
  'c2': "c2"
};

a = {
  d1: "d1",
  'd-2': "d2"
};

// None of these should become quoted, regardless of the quoteProps value.
a = {
  NaN: null,
  1: null,
  1.5: null,
  .1: null,
  1.: null,
  1.0: null,
  999999999999999999999: null,
  0.99999999999999999: null,
  1E2: null,
  1e+3: null,
  1e+100: null,
  0b10: null,
  0o10: null,
  0xf: null,
  2n: null,
}

a = {
  // These should be unquoted for quoteProps=as-needed.
  "NaN": null,
  "1": null,
  "1.5": null,
  // These should never be unquoted. `1e+100` technically could (it’s the only
  // one where `String(Number(key)) === key`), but we came to the conclusion
  // that it is unexpected.
  ".1": null,
  "1.": null,
  "1.0": null,
  "999999999999999999999": null,
  "0.99999999999999999": null,
  "1E2": null,
  "1e+3": null,
  "1e+100": null,
  "0b10": null,
  "0o10": null,
  "0xf": null,
  "2n": null,
}

Object.entries({
  // To force quotes for quoteProps=consistent.
  'a-': 'a-',
  // These can be quoted:
  NaN: 'NaN',
  1: '1',
  1.5: '1.5',
  // Prettier will normalize these to `0.1` and `1` – then they can be quoted.
  .1: '.1',
  1.: '1.',
  // These should never be quoted. The _actual_ keys are shown as comments.
  // Copy-paste this into the console to verify. If we were to convert these
  // numbers into decimal (which completely valid), “information/intent” is
  // lost. Either way, writing code like this is super confusing.
  1.0: '1.0', // 1
  999999999999999999999: '999999999999999999999', // 1e+21
  0.99999999999999999: '0.99999999999999999', // 1
  1E2: '1E2', // 100
  1e+3: '1e+3', // 1000
  1e+100: '1e+100', // 1e+100 – this one is identical, but would be inconsistent to quote.
  0b10: '0b10', // 2
  0o10: '0o10', // 8
  0xf: '0xf', // 15
  2n: '2n', // 2
  0xan: '0xan', // 10
})

// Negative numbers cannot be unquoted.
!{
  "-1": null,
  "-1.5": null,
}

a = {
  "\a": 1,
  "b": 2
}
