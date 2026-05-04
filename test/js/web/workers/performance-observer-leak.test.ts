import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Performance <-> PerformanceObserver RefPtr cycle: Performance holds
// RefPtr<PerformanceObserver> in its registered-observer list, and each
// PerformanceObserver holds RefPtr<Performance>. When a Worker terminates
// without the observer calling .disconnect(), the cycle keeps both objects
// (and everything Performance owns, including the user-timing buffer) alive
// past the global's destruction.
test("PerformanceObserver without disconnect() does not leak Performance when Worker terminates", async () => {
  using dir = tempDir("perf-observer-leak", {
    "worker.js": `
      const observer = new PerformanceObserver(() => {});
      // Observe a type that won't match the mark below so no delivery task is
      // posted (that task captures its own Ref<Performance> and would confound
      // the measurement). The observer is still registered with Performance,
      // creating the Performance <-> PerformanceObserver ref cycle.
      observer.observe({ entryTypes: ["measure"] });
      // Store a ~4 MB mark in Performance's user-timing buffer so the cycle's
      // retained memory is visible in RSS. It is released only when the
      // Performance object itself is freed.
      performance.mark("m", { detail: new Uint8Array(4 * 1024 * 1024).fill(1) });
      postMessage("ready");
      // Intentionally never call observer.disconnect().
    `,
    "main.js": `
      const workerPath = new URL("./worker.js", import.meta.url).href;

      async function runOne() {
        const w = new Worker(workerPath);
        await new Promise((resolve, reject) => {
          w.onmessage = resolve;
          w.onerror = reject;
        });
        await w.terminate();
      }

      async function runBatch(n) {
        for (let i = 0; i < n; i++) await runOne();
        Bun.gc(true);
        Bun.gc(true);
      }

      // Warm up: establish allocator / JIT high-water mark.
      await runBatch(8);
      const rssBefore = process.memoryUsage.rss();

      // Measured batch: if each worker leaks ~4 MB via the Performance <->
      // PerformanceObserver cycle, 20 iterations leak ~80 MB over baseline.
      await runBatch(20);
      const rssAfter = process.memoryUsage.rss();

      const deltaMB = (rssAfter - rssBefore) / 1024 / 1024;
      // Without fix: ~110+ MB (baseline ~30 MB + 20 * 4 MB leaked).
      // With fix: ~30 MB (just baseline worker/VM churn).
      if (deltaMB > 65) {
        console.error("FAIL: RSS grew by " + deltaMB.toFixed(1) + " MB over 20 worker terminations");
        process.exit(1);
      }
      console.log("PASS: RSS delta " + deltaMB.toFixed(1) + " MB");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("PASS");
  expect(exitCode).toBe(0);
}, 120_000);
