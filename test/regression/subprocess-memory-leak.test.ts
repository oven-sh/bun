/**
 * Memory leak measurement test for {@link Bun.spawn} and subprocess lifecycle
 *
 * This test specifically targets potential memory leaks in Subprocess.zig:
 * 1. Subprocess object not being properly freed after process exit
 * 2. PipeReader/StaticPipeWriter not being properly cleaned up
 * 3. Process object reference counting issues
 */
import { heapStats } from "bun:jsc";
import { isASAN, isCI } from "harness";

const MB = 1024 * 1024;
const DEBUG_LOGS = false;
const log = (...args: any[]) => DEBUG_LOGS && console.log(...args);

function getMemoryStats() {
  Bun.gc(true);
  Bun.gc(true);
  return {
    rss: process.memoryUsage.rss(),
    heapUsed: process.memoryUsage().heapUsed,
    heapStats: heapStats(),
  };
}

describe.todoIf(isASAN && isCI)("Subprocess memory leaks", () => {
  describe("spawn with pipes", () => {
    test("should not leak when spawning with stdin buffer", async () => {
      const inputData = Buffer.alloc(1024, "x");

      // Warmup
      for (let i = 0; i < 10; i++) {
        const proc = Bun.spawn({
          cmd: ["cat"],
          stdout: "pipe",
          stderr: "ignore",
          stdin: inputData,
        });
        await proc.exited;
        await proc.stdout.text();
      }

      const before = getMemoryStats();

      // Run the test - uses StaticPipeWriter for stdin
      for (let i = 0; i < 100; i++) {
        const proc = Bun.spawn({
          cmd: ["cat"],
          stdout: "pipe",
          stderr: "ignore",
          stdin: inputData,
        });
        await proc.exited;
        await proc.stdout.text();

        if (i % 25 === 0) {
          Bun.gc(true);
          log(`Iteration ${i}: RSS ${Math.round(process.memoryUsage.rss() / MB)}MB`);
        }
      }

      const after = getMemoryStats();
      const rssDelta = after.rss - before.rss;
      const pct = rssDelta / before.rss;

      log(`RSS delta: ${Math.round(rssDelta / MB)}MB (${Math.round(pct * 100)}%)`);

      // Should not grow more than 80%
      expect(pct).toBeLessThan(0.8);
    }, 30_000);

    test("should not leak when reading stdout pipe", async () => {
      // Warmup
      for (let i = 0; i < 10; i++) {
        const proc = Bun.spawn({
          cmd: ["echo", "hello world"],
          stdout: "pipe",
          stderr: "ignore",
          stdin: "ignore",
        });
        await proc.exited;
        await proc.stdout.text();
      }

      const before = getMemoryStats();

      // Run the test - uses PipeReader for stdout
      for (let i = 0; i < 100; i++) {
        const proc = Bun.spawn({
          cmd: ["echo", "hello world"],
          stdout: "pipe",
          stderr: "ignore",
          stdin: "ignore",
        });
        await proc.exited;
        await proc.stdout.text();

        if (i % 25 === 0) {
          Bun.gc(true);
          log(`Iteration ${i}: RSS ${Math.round(process.memoryUsage.rss() / MB)}MB`);
        }
      }

      const after = getMemoryStats();
      const rssDelta = after.rss - before.rss;
      const pct = rssDelta / before.rss;

      log(`RSS delta: ${Math.round(rssDelta / MB)}MB (${Math.round(pct * 100)}%)`);

      // Should not grow more than 80%
      expect(pct).toBeLessThan(0.8);
    }, 30_000);
  });

  describe("heap object counts", () => {
    test("should not leak Subprocess objects", async () => {
      Bun.gc(true);
      const initialStats = heapStats();
      const initialSubprocessCount = initialStats.objectTypeCounts.Subprocess ?? 0;

      // Run many spawn operations
      for (let i = 0; i < 50; i++) {
        const proc = Bun.spawn({
          cmd: ["echo", "test"],
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
        });
        await proc.exited;
      }

      Bun.gc(true);
      Bun.gc(true);

      const finalStats = heapStats();
      const finalSubprocessCount = finalStats.objectTypeCounts.Subprocess ?? 0;

      log(`Subprocess count: initial=${initialSubprocessCount}, final=${finalSubprocessCount}`);

      // We allow some objects to remain (e.g., in flight), but not many
      expect(finalSubprocessCount - initialSubprocessCount).toBeLessThan(5);
    }, 30_000);
  });
});
