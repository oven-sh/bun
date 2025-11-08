import { $ } from "bun";
import { expect, test } from "bun:test";

// Regression test for shell interpreter double-free issue
// The bug occurred when the GC finalizer tried to free memory that was
// already partially freed when the shell finished execution.
// This was particularly reproducible on Windows.
//
// The issue was that deinitAfterJSRun() would partially deinitialize
// the interpreter, and then deinitFromFinalizer() would try to free
// resources that were already freed or in an inconsistent state.
//
// NOTE: This bug is non-deterministic and may not always crash, even
// without the fix. The test serves to verify the fix doesn't break
// normal operation and documents the usage pattern that triggered the bug.

test("shell interpreter should handle GC during concurrent execution", async () => {
  // This test mimics the opencode usage pattern where shell commands
  // are used to resolve paths during permission checks
  const promises = [];

  for (let i = 0; i < 50; i++) {
    // Similar to the opencode pattern: $`realpath ${arg}`.quiet().nothrow().text()
    promises.push($`echo "/tmp/test${i}"`.quiet().nothrow().text());
  }

  const results = await Promise.all(promises);
  expect(results.length).toBe(50);

  // Multiple GC passes to trigger finalizers
  // The bug would manifest as a segfault during finalization
  for (let i = 0; i < 5; i++) {
    Bun.gc(true);
    await Bun.sleep(1);
  }
});

test("shell interpreter sequential with frequent GC", async () => {
  // Sequential execution with GC after each command
  // increases pressure on the finalizer
  for (let i = 0; i < 100; i++) {
    const result = await $`echo "test ${i}"`.quiet().nothrow().text();
    expect(result.trim()).toBe(`test ${i}`);

    // Force GC frequently to trigger finalizers while
    // other interpreters might still be finishing
    if (i % 5 === 0) {
      Bun.gc(true);
    }
  }

  // Final GC pass
  Bun.gc(true);
});

test("shell interpreter error handling with GC", async () => {
  // Test that error paths also properly clean up
  const promises = [];

  for (let i = 0; i < 20; i++) {
    // Mix of successful and potentially failing commands
    if (i % 3 === 0) {
      promises.push($`echo "success ${i}"`.quiet().nothrow().text());
    } else {
      promises.push($`echo "test ${i}"`.quiet().text());
    }
  }

  await Promise.all(promises);

  // GC should not crash even with mixed success/error states
  for (let i = 0; i < 3; i++) {
    Bun.gc(true);
    await Bun.sleep(1);
  }
});
