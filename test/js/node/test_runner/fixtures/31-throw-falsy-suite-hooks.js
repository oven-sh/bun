// A suite-level before() or after() hook that throws a falsy value is still an
// error. Node v26.3.0 reports "not ok" for every suite here. Bun reports each
// thrown value as an error between tests, and the test in the suite passes.
const { test, describe, before, after } = require("node:test");

for (const [label, value] of [
  ["0", 0],
  ["false", false],
  ['""', ""],
  ["NaN", NaN],
  ["0n", 0n],
]) {
  describe(`a before hook that throws ${label}`, () => {
    before(() => {
      throw value;
    });
    test("child", () => {});
  });
  describe(`an after hook that throws ${label}`, () => {
    after(() => {
      throw value;
    });
    test("child", () => {});
  });
}
