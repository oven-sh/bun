// Run with --retry=1. "kid" fails after the first attempt of its parent has
// ended with the parent's own error. The second attempt must fail for "kid".
const { test } = require("node:test");

let attempt = 0;
test("flaky-parent", async t => {
  t.test("kid", () => {
    throw new Error("kid" + " error");
  });
  if (++attempt === 1) throw new Error("own" + " error");
});
