//#FILE: test-intl-v8BreakIterator.js
//#SHA1: c1592e4a1a3d4971e70d4b2bc30e31bb157f8646
//-----------------
"use strict";

if (!globalThis.Intl) {
  test.skip("missing Intl");
}

test("v8BreakIterator is not in Intl", () => {
  expect("v8BreakIterator" in Intl).toBe(false);
});

test("v8BreakIterator is not in Intl in a new context", () => {
  const vm = require("vm");
  expect(vm.runInNewContext('"v8BreakIterator" in Intl')).toBe(false);
});

//<#END_FILE: test-intl-v8BreakIterator.js
