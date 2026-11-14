// node-test.test.ts runs this with `--retry 1`. bun:test runs the first test a
// second time. The subtest of its first run is still running then. The second
// run waits for that subtest, and the subtest's own timeout ends it. That cancel
// belongs to the first run, which has failed already.
const { test } = require("node:test");

let runs = 0;
const secondRun = Promise.withResolvers();

test("fails in its first run", async t => {
  if (runs++ === 0) {
    t.test("subtest of the first run", { timeout: 100, expectFailure: true }, () => new Promise(() => {}));
    throw new Error("first run");
  }
  t.after(() => secondRun.resolve());
});

// bun:test can start this test before the second run has ended. This test stays
// open until that run has its result, so that a wrong result fails a test.
test("next", async () => {
  await secondRun.promise;
  await new Promise(resolve => setImmediate(resolve));
});
