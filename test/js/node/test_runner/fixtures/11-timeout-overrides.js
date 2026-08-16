// node-test.test.ts runs this with `--timeout 100`: an explicit timeout
// (Infinity or finite) must override the runner's per-test default.
const { test } = require("node:test");

test("an Infinity timeout overrides the runner default", { timeout: Infinity }, async () => {
  await new Promise(resolve => setTimeout(resolve, 300));
});

test("a finite timeout larger than the runner default is honored", { timeout: 3000 }, async () => {
  await new Promise(resolve => setTimeout(resolve, 300));
});
