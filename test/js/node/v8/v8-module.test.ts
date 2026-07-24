import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { getHeapStatistics } from "v8";

describe("v8.getHeapStatistics", () => {
  test("returns all expected fields as non-negative numbers", () => {
    const stats = getHeapStatistics();
    expect(Object.keys(stats).sort()).toEqual(
      [
        "total_heap_size",
        "total_heap_size_executable",
        "total_physical_size",
        "total_available_size",
        "used_heap_size",
        "heap_size_limit",
        "malloced_memory",
        "peak_malloced_memory",
        "does_zap_garbage",
        "number_of_native_contexts",
        "number_of_detached_contexts",
        "total_global_handles_size",
        "used_global_handles_size",
        "external_memory",
      ].sort(),
    );
    for (const [key, value] of Object.entries(stats)) {
      expect(value, key).toBeNumber();
      expect(value, key).toBeGreaterThanOrEqual(0);
    }
    expect(stats.number_of_native_contexts).toBeGreaterThanOrEqual(1);
  });

  // https://github.com/oven-sh/bun/issues/19254
  // Previously this delegated to jsc.heapStats(), which walks every live cell in
  // the heap on every call. That made each call O(heap size), and since each call
  // also allocated (mimalloc JSON, type-count objects), repeated calls got slower
  // and slower while RSS climbed without bound.
  test("does not leak memory or slow down when called repeatedly", async () => {
    const script = /* js */ `
      const { getHeapStatistics } = require("v8");

      // Warmup: let the JIT settle and any one-time allocations happen.
      for (let i = 0; i < 100; i++) getHeapStatistics();
      Bun.gc(true);
      const rssBefore = process.memoryUsage.rss();

      let t = performance.now();
      for (let i = 0; i < 100; i++) getHeapStatistics();
      const early = performance.now() - t;

      for (let i = 0; i < 1500; i++) getHeapStatistics();

      t = performance.now();
      for (let i = 0; i < 100; i++) getHeapStatistics();
      const late = performance.now() - t;

      Bun.gc(true);
      const rssAfter = process.memoryUsage.rss();

      process.stdout.write(JSON.stringify({
        rssDeltaMB: (rssAfter - rssBefore) / 1024 / 1024,
        early,
        late,
        ratio: late / early,
      }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const result = JSON.parse(stdout) as { rssDeltaMB: number; early: number; late: number; ratio: number };
    expect(exitCode).toBe(0);

    // Before the fix, 1800 calls grew RSS by ~30 MB and the last 100 calls took
    // >10x as long as the first 100. With the fix both stay flat.
    expect(result.rssDeltaMB, `RSS grew by ${result.rssDeltaMB.toFixed(2)} MB after 1800 calls`).toBeLessThan(15);
    expect(
      result.ratio,
      `late batch took ${result.ratio.toFixed(2)}x as long as early batch (${result.early.toFixed(2)}ms -> ${result.late.toFixed(2)}ms)`,
    ).toBeLessThan(3);
  }, 60_000);
});
