const { test } = require("node:test");

// The subtest inherits expectFailure, so its throw is the expected outcome and
// it passes — which leaves the parent passing when it was expected to fail.
// Verified against node v26.3.0: 1 fail, "test was expected to fail but passed".
test("expectFailure is inherited by subtests", { expectFailure: true }, async t => {
  await t.test("child inherits", () => {
    throw new Error("child boom");
  });
});
