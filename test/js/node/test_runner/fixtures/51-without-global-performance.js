// Node v26.3.0 exits 0 for this file, and for each top-level test of it alone.
// A program can remove the global `performance`, and the runner must not need it.
const { test } = require("node:test");

delete globalThis.performance;

test("a test with a timeout", { timeout: 1000 }, () => {});

test("a subtest with a timeout", async t => {
  await t.test("with a timeout", { timeout: 1000 }, () => {});
});

// The test waits for the subtest, and its timeout ends that wait.
test("a test with a timeout calls t.skip() and throws while its subtest never settles", { timeout: 20 }, t => {
  t.test("skips and never settles", t2 => {
    t2.skip();
    return new Promise(() => {});
  });
  t.skip();
  throw new Error("own");
});

// Node fails the subtest with the error of the hook, and both tests expect that error.
test("a before hook of a test fails, so its subtest never runs", { expectFailure: /hook/ }, async t => {
  t.before(() => {
    throw new Error("hook");
  });
  await t.test("never runs", () => {});
});
