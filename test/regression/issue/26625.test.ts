import { $ } from "bun";
import { expect, test } from "bun:test";

// Regression test for https://github.com/oven-sh/bun/issues/26625
// This test verifies that the shell interpreter doesn't crash during GC
// finalization due to double-free of resources.

test("shell interpreter does not crash during GC finalization", async () => {
  // Execute many concurrent shell commands to increase GC pressure
  // and trigger the double-free vulnerability if present
  const iterations = 100;
  const promises: Promise<string>[] = [];

  for (let i = 0; i < iterations; i++) {
    promises.push($`echo "test ${i}"`.text());
  }

  // Wait for all shell commands to complete
  const results = await Promise.all(promises);

  // Verify all commands completed successfully
  expect(results.length).toBe(iterations);
  for (let i = 0; i < iterations; i++) {
    expect(results[i].trim()).toBe(`test ${i}`);
  }

  // Force GC to run multiple times to trigger finalization of interpreters
  for (let i = 0; i < 10; i++) {
    Bun.gc(true);
    // Small delay to allow GC to process
    await Bun.sleep(10);
  }

  // If we get here without crashing, the fix is working
  expect(true).toBe(true);
});

test("shell interpreter handles rapid creation and GC correctly", async () => {
  // Create and immediately discard shell promises to stress GC
  for (let batch = 0; batch < 5; batch++) {
    const promises: Promise<string>[] = [];

    for (let i = 0; i < 50; i++) {
      promises.push($`echo "batch ${batch} item ${i}"`.text());
    }

    await Promise.all(promises);

    // Force GC after each batch
    Bun.gc(true);
  }

  // Final GC passes
  for (let i = 0; i < 5; i++) {
    Bun.gc(true);
    await Bun.sleep(5);
  }

  expect(true).toBe(true);
});
