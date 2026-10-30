// node-test.test.ts runs this with `--retry 1`. bun:test runs the first test a
// second time. The subtest of its first run is still running then, and its own
// timeout ends it during the second run or during the next test. That cancel
// belongs to the first run, which has failed already.
const { test } = require("node:test");

let runs = 0;

test("fails in its first run", async t => {
  if (runs++ === 0) {
    t.test("subtest of the first run", { timeout: 100, expectFailure: true }, () => new Promise(() => {}));
    throw new Error("first run");
  }
});

test("next", async () => {
  await new Promise(resolve => setTimeout(resolve, 400));
});
