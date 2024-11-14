//#FILE: test-assert-strict-exists.js
//#SHA1: 390d3a53b3e79630cbb673eed78ac5857a49352f
//-----------------
"use strict";

test("assert/strict is the same as assert.strict", () => {
  const assert = require("assert");
  const assertStrict = require("assert/strict");

  expect(assertStrict).toBe(assert.strict);
});

//<#END_FILE: test-assert-strict-exists.js
