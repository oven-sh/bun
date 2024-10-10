//#FILE: test-process-env-windows-error-reset.js
//#SHA1: f7e32cc8da8c33ecfa3cddeb13d3dd8689d6af64
//-----------------
"use strict";

// This checks that after accessing a missing env var, a subsequent
// env read will succeed even for empty variables.

test("empty env var after accessing missing env var", () => {
  process.env.FOO = "";
  process.env.NONEXISTENT_ENV_VAR; // eslint-disable-line no-unused-expressions
  const foo = process.env.FOO;

  expect(foo).toBe("");
});

test("env var existence after accessing missing env var", () => {
  process.env.FOO = "";
  process.env.NONEXISTENT_ENV_VAR; // eslint-disable-line no-unused-expressions
  const hasFoo = "FOO" in process.env;

  expect(hasFoo).toBe(true);
});

//<#END_FILE: test-process-env-windows-error-reset.js
