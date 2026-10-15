// A `plan` option with an invalid count, on a subtest. Node v26.3.0 starts a
// subtest inside t.test() and validates the count there, before the `try` of
// Test.run(). The promise that t.test() returns rejects with the error, the
// subtest is cancelled, and the test that declared it fails. The options of
// the subtest do not change that. A suite inside a test starts its tests
// itself: the suite fails, and the promise that it() returns resolves. This
// file fails in the same way under `node --test` on the node v26.3.0 binary
// and under bun.
const assert = require("node:assert");
const { test, describe, it } = require("node:test");

const bodies = [];

for (const options of [
  { plan: 1.5 },
  { plan: "x", todo: true },
  { plan: -1, skip: true },
  { plan: true, expectFailure: true },
]) {
  test(`a test fails when it awaits a subtest with ${JSON.stringify(options)}`, async t => {
    await t.test("the subtest", options, () => {
      bodies.push(options);
    });
  });
}

let observed;
test("a test can observe the rejection", async t => {
  const subtest = t.test("the subtest", { plan: "x" }, () => {
    bodies.push("observed");
  });
  observed = await subtest.then(
    () => "resolved",
    err => `rejected: ${err.code}`,
  );
  // Node hangs when a test keeps the rejection from its own body, so this test
  // lets it through.
  await subtest;
});

let observedInSuite;
test("a test fails through a suite whose test has an invalid plan", async () => {
  let declared;
  await describe("the suite", () => {
    declared = it("the test", { plan: "x" }, () => {
      bodies.push("in a suite");
    });
  });
  observedInSuite = await declared.then(
    () => "resolved",
    err => `rejected: ${err.code}`,
  );
});

test("no subtest ran, t.test() rejected and it() resolved", () => {
  assert.deepStrictEqual(bodies, []);
  assert.strictEqual(observed, "rejected: ERR_INVALID_ARG_TYPE");
  assert.strictEqual(observedInSuite, "resolved");
});
