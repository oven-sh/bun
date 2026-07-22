// Run with `--timeout 100`: Node has no default per-test timeout, so bodies and
// before/after hooks with none set must outlive bun:test's default, and an
// explicit timeout must fail with Node's message (no done-callback hint).
const { test, before, after } = require("node:test");

before(async () => {
  await new Promise(resolve => setTimeout(resolve, 250));
  console.log("BEFORE_RAN");
});

after(async () => {
  await new Promise(resolve => setTimeout(resolve, 250));
  console.log("AFTER_RAN");
});

test("no explicit timeout outlives the runner default", async () => {
  await new Promise(resolve => setTimeout(resolve, 250));
});

test("explicit timeout still fails with Node's message", { timeout: 50 }, async () => {
  await new Promise(resolve => setTimeout(resolve, 250));
});
