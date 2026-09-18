// Hooks that never settle block a test's subtest chain, and cancelling the
// subtests involved cannot unblock them. The test's own timeout must still end
// every test here with node:test's timeout error instead of leaving it to
// bun:test's (much later) watchdog. node-test.test.ts asserts the error text,
// the counts, and that run() counts the timeouts as cancelled like node does.
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

// The subtest's result is already in (it passed), so it is not cancelled; only
// its after hook is outstanding. node abandons the hook and cancels the
// subtest; bun waits for it up to the parent's timeout.
test("a later subtest stuck in its own after hook", { timeout: 100 }, async t => {
  await t.test("first", () => {});
  t.test("stuck in after", st => {
    st.after(never);
  });
});
