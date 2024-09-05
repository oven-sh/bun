//#FILE: test-util-primordial-monkeypatching.js
//#SHA1: 72e754f1abd435e598620901f26b087e0bf9d5a7
//-----------------
"use strict";

// Monkeypatch Object.keys() so that it throws an unexpected error. This tests
// that `util.inspect()` is unaffected by monkey-patching `Object`.

const util = require("util");

test("util.inspect() is unaffected by monkey-patching Object.keys()", () => {
  const originalObjectKeys = Object.keys;

  // Monkey-patch Object.keys
  Object.keys = () => {
    throw new Error("fhqwhgads");
  };

  try {
    expect(util.inspect({})).toBe("{}");
  } finally {
    // Restore original Object.keys to avoid affecting other tests
    Object.keys = originalObjectKeys;
  }
});
