import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
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
  // getHeapStatistics() used to delegate to jsc.heapStats(), which walks every
  // live cell via objectTypeCounts()/globalObjectCount() and allocates per-
  // class-name Identifier strings on each call. With retained objects on the
  // heap each call cost tens of ms, and because each call allocated, RSS climbed
  // without bound when polled.
  test("stays cheap and does not grow RSS when called repeatedly", async () => {
    const script = /* js */ `
      const { getHeapStatistics } = require("node:v8");

      for (let i = 0; i < 50; i++) getHeapStatistics();
      Bun.gc(true);
      const rssBefore = process.memoryUsage.rss();

      // 30s cap keeps the fail-before (debug+ASAN, heap walk) case from timing
      // out: the RSS delta is already conclusive by the time the cap trips.
      const deadline = performance.now() + 30_000;
      let i = 0;
      for (; i < 2000; i++) {
        getHeapStatistics();
        if ((i & 63) === 0 && performance.now() > deadline) break;
      }

      Bun.gc(true);
      const rssAfter = process.memoryUsage.rss();

      process.stdout.write(JSON.stringify({
        calls: i,
        rssDeltaMB: (rssAfter - rssBefore) / 1024 / 1024,
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
    const { calls, rssDeltaMB } = JSON.parse(stdout) as { calls: number; rssDeltaMB: number };
    expect(exitCode).toBe(0);

    // Before the fix, 2000 calls grew RSS by >30 MB (each call built a fresh
    // objectTypeCounts JS object with ~150 own properties). After, the
    // 6-element result array is the only allocation.
    const rssLimit = isASAN || isDebug ? 20 : 10;
    expect(rssDeltaMB, `RSS grew by ${rssDeltaMB.toFixed(2)} MB over ${calls} calls`).toBeLessThan(rssLimit);
    expect(calls, `only ${calls}/2000 calls completed within 30s`).toBe(2000);
  }, 60_000);
});
