// Every test here must FAIL: a falsy value that is thrown is still a failure.
// node-test.test.ts asserts the exact counts. Node v26.3.0 fails all of them.
const { test, describe, beforeEach, afterEach } = require("node:test");

for (const [label, value] of [
  ["0", 0],
  ["false", false],
  ['""', ""],
  ["NaN", NaN],
  ["0n", 0n],
]) {
  test(`a body that throws ${label}`, () => {
    throw value;
  });
  test(`an async body that throws ${label}`, async () => {
    throw value;
  });
  test(`a body with a done callback that throws ${label}`, (t, done) => {
    throw value;
  });
  describe(`a beforeEach hook that throws ${label}`, () => {
    beforeEach(() => {
      throw value;
    });
    test("fails the test", () => {});
  });
  describe(`an afterEach hook that throws ${label}`, () => {
    afterEach(() => {
      throw value;
    });
    test("fails the test", () => {});
  });
}
