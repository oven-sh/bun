//#FILE: test-process-hrtime-bigint.js
//#SHA1: 2fbd7286e22ca2f6d3155f829032524692e4d77c
//-----------------
"use strict";

// Tests that process.hrtime.bigint() works.

test("process.hrtime.bigint() works", () => {
  const start = process.hrtime.bigint();
  expect(typeof start).toBe("bigint");

  const end = process.hrtime.bigint();
  expect(typeof end).toBe("bigint");

  expect(end - start).toBeGreaterThanOrEqual(0n);
});

//<#END_FILE: test-process-hrtime-bigint.js
