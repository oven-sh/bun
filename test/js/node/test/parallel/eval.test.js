//#FILE: test-eval.js
//#SHA1: 3ea606b33a3ee4b40ef918317b32008e0f5d5e49
//-----------------
"use strict";

// Verify that eval is allowed by default.
test("eval is allowed by default", () => {
  expect(eval('"eval"')).toBe("eval");
});

//<#END_FILE: test-eval.js
