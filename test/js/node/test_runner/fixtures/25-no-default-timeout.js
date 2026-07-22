// node-test.test.ts runs this with `--timeout 200`: Node's test runner has no
// per-test timeout by default, so an async body that outlives bun:test's
// runner default must still pass, and a short explicit timeout must still be
// the one that fails (with Node's message, not bun:test's done-callback hint).
const { test, describe } = require("node:test");

test("no explicit timeout outlives the runner default", async () => {
  await new Promise(resolve => setTimeout(resolve, 400));
});

describe("suite with no explicit timeout", () => {
  test("also outlives the runner default", async () => {
    await new Promise(resolve => setTimeout(resolve, 400));
  });
});

test("explicit timeout still fails with Node's message", { timeout: 50 }, async () => {
  await new Promise(resolve => setTimeout(resolve, 400));
});
