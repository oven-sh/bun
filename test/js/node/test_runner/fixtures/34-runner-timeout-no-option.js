// node-test.test.ts runs this with `--timeout 100`. A test without a `timeout`
// option gets the timeout of the runner, as under `node --test-timeout=100`.
const { test } = require("node:test");

test("a test without a timeout option", async () => {
  await new Promise(resolve => setTimeout(resolve, 400));
});
