// bun:test keeps its own timer behind a test that has a `timeout` option. That
// timer ends a hook that hangs, 5000 ms after the test's own timeout: here at
// 5050 ms. node:test starts its timer after the beforeEach hooks, so it never
// starts for the first test. Node v26.3.0 has no such timer: `node --test`
// waits for the hook and does not end this file.
const { test, beforeEach } = require("node:test");

let calls = 0;
beforeEach(() => {
  if (calls++ === 0) return new Promise(() => {});
});

test("a test behind a hook that hangs", { timeout: 50 }, () => {});

test("the next test", () => {});
