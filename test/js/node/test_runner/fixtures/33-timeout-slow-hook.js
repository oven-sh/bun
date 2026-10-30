// The `timeout` option is for the body of the test. The afterEach hook runs
// after it and is not part of it, so this test passes under `node --test`.
// The hook ends at about 5100 ms: after bun:test's built-in 5000 ms, and
// before the 8000 ms that bun:test's own timer gives this test.
const { test, afterEach } = require("node:test");

afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 5100));
});

test("a test with a slow afterEach hook", { timeout: 3000 }, () => {});
