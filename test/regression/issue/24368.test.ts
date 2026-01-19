import { $ } from "bun";
import { expect, test } from "bun:test";

// Test for https://github.com/oven-sh/bun/issues/24368
// Segmentation fault during GC finalization of ShellInterpreter objects.
// The crash occurred when GC tried to finalize shell interpreter objects
// after their finish() method had already cleaned up resources.

test("shell interpreter GC finalization does not crash", async () => {
  // Run multiple shell commands to create many ShellInterpreter objects
  let results: Promise<any>[] = [];
  for (let i = 0; i < 100; i++) {
    results.push($`echo hello ${i}`.quiet());
  }
  await Promise.all(results);

  // Clear references so ShellInterpreter objects can be collected
  results = [];

  // Force GC to trigger finalizers
  Bun.gc(true);

  // Run more commands to ensure the process is stable after GC
  for (let i = 0; i < 10; i++) {
    const result = await $`echo world ${i}`.quiet();
    expect(result.exitCode).toBe(0);
  }

  // Another GC pass
  Bun.gc(true);

  // Should reach here without crashing
  expect(true).toBe(true);
});

test("concurrent shell commands with GC stress", async () => {
  // This test stresses the GC by creating many shell interpreter objects
  // and forcing GC at various points

  for (let round = 0; round < 5; round++) {
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push($`echo round ${round} cmd ${i}`.quiet());
    }

    // Force GC while commands might still be running
    if (round % 2 === 0) {
      Bun.gc(false); // non-blocking GC
    }

    await Promise.all(promises);

    // Force full GC after each round
    Bun.gc(true);
  }

  // Final verification
  const result = await $`echo done`.quiet();
  expect(result.exitCode).toBe(0);
  expect(result.text()).toContain("done");
});
