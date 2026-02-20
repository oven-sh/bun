import { expect, test } from "bun:test";

// Regression test for https://github.com/oven-sh/bun/issues/19097
// setImmediate callbacks whose JS objects get GC'd after clearImmediate
// would crash with a use-after-finalize panic when the queued immediate
// task tried to downgrade the already-finalized JSRef.
test("clearImmediate followed by GC does not crash", () => {
  // Schedule many immediates and immediately clear them.
  // This puts the immediate tasks in the event loop queue with
  // has_cleared_timer=true. After downgrading to weak refs via cancel(),
  // GC can finalize the JS objects, putting the JSRef into the .finalized
  // state. When the queued tasks run and try to clean up, they must not
  // assert on the finalized state.
  for (let i = 0; i < 1000; i++) {
    const id = setImmediate(() => {});
    clearImmediate(id);
  }

  // Force garbage collection to finalize the cleared immediate objects.
  Bun.gc(true);

  // Let the event loop drain the queued immediate tasks.
  return new Promise<void>(resolve => {
    setImmediate(() => {
      // If we get here without crashing, the bug is fixed.
      resolve();
    });
  });
});

test("unref'd setImmediate with GC pressure does not crash", async () => {
  // Schedule many unref'd immediates with GC pressure.
  // Unref'd immediates can hit the early-exit path in runImmediateTask
  // when the event loop has no other work. If GC finalizes the JS object
  // between unref and the task running, the JSRef will be in .finalized state.
  const promises: Promise<void>[] = [];

  for (let batch = 0; batch < 10; batch++) {
    for (let i = 0; i < 100; i++) {
      const id = setImmediate(() => {});
      // @ts-ignore - unref exists on Immediate
      id.unref();
    }
    Bun.gc(false);

    // Keep the event loop alive with a resolved promise to allow
    // immediate tasks to drain.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  // If we got here without a crash, the fix works.
  expect(true).toBe(true);
});
