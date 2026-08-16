// A before hook that never settles blocks the test's subtest chain, and
// cancelling the subtest queued behind it cannot unblock it. The test's own
// timeout must still end both tests with node:test's timeout error instead of
// leaving them to bun:test's (much later) watchdog. node-test.test.ts asserts
// the error text and the counts.
const { test } = require("node:test");

const never = () => new Promise(() => {});

// node v26.3.0 fails this one the same way: the subtest is unfinished, so the
// parent waits for it and times out.
test("a subtest stuck behind a hanging before hook", { timeout: 100 }, t => {
  t.before(never);
  t.test("stuck", () => {});
});

// With nothing depending on the hook, node does not wait for it at all and
// passes; bun always waits for a before hook created on a running test so its
// failure is reported, and a hook that never settles therefore times out.
test("a hanging before hook and nothing else", { timeout: 100 }, t => {
  t.before(never);
});
