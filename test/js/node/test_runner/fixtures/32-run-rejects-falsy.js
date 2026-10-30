// Every test here must FAIL: the run of the test itself rejects with a falsy value.
// The `code` getter throws while the expectFailure validation reads the thrown object.
// Node v26.3.0 does not finish a test of this shape, so the verdicts are Bun's own.
const { test } = require("node:test");

for (const [label, value] of [
  ["0", 0],
  ["false", false],
  ['""', ""],
  ["NaN", NaN],
  ["0n", 0n],
]) {
  test(`the run of a test rejects with ${label}`, { expectFailure: /x/ }, () => {
    throw {
      get code() {
        throw value;
      },
    };
  });
}
