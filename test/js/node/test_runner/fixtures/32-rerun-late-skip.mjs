import { test } from "node:test";

// The global outlives each --rerun-each run. Only this file is evaluated again.
const run = (globalThis.__lateSkipRuns = (globalThis.__lateSkipRuns ?? 0) + 1);

test("the same test in each run", async t => {
  if (run % 2 === 1) {
    // An odd run: an uncaught error ends the test at once. Its body stays pending and calls t.skip() in the next run.
    queueMicrotask(() => {
      throw new Error("ends run " + run);
    });
    await new Promise(resolve => (globalThis.__resumeLateSkip = resolve));
    t.skip("late");
    return;
  }
  // An even run: resume the body of the run before it while this test is active. This test passes.
  globalThis.__resumeLateSkip();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
});
