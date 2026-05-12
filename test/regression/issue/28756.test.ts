import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/28756
// AbortSignal.timeout() + util.aborted() causes unbounded memory growth
// because the extra ref() taken in timeout() is never released when all
// listeners are removed before the timer fires.
test("AbortSignal.timeout + util.aborted does not leak memory", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { aborted } = require("util");

      // 10 batches * 8000 = 80k signals.
      // Without fix: leaks ~0.8 KB/signal => ~60 MB growth.
      // With fix: stays flat.
      // Completes in <2s on release, ~120s on ASAN.
      const iterations = 10;
      const batchSize = 8000;

      // Warm up so baseline memory is established.
      for (let i = 0; i < 200; i++) {
        const sig = AbortSignal.timeout(1_000_000_000);
        sig.addEventListener("abort", () => {});
        aborted(sig, {});
      }
      await new Promise(r => setTimeout(r, 0));
      Bun.gc(true);
      await new Promise(r => setTimeout(r, 50));
      Bun.gc(true);
      const baselineRSS = process.memoryUsage().rss;

      for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < batchSize; i++) {
          function lis() {}
          const sig = AbortSignal.timeout(1_000_000_000);
          sig.addEventListener("abort", lis);
          aborted(sig, {});
          sig.removeEventListener("abort", lis);
        }
        await new Promise(r => setTimeout(r, 0));
        Bun.gc(true);
      }

      await new Promise(r => setTimeout(r, 100));
      Bun.gc(true);
      await new Promise(r => setTimeout(r, 100));
      Bun.gc(true);

      const finalRSS = process.memoryUsage().rss;
      const growth = finalRSS - baselineRSS;
      const growthMB = (growth / 1024 / 1024).toFixed(1);
      console.log(JSON.stringify({ baselineMB: (baselineRSS/1024/1024).toFixed(1), finalMB: (finalRSS/1024/1024).toFixed(1), growthMB }));
      // Without the fix, 80k signals leak ~60 MB.  With the fix, <50 MB.
      process.exit(growth < 50 * 1024 * 1024 ? 0 : 1);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    expect().fail(`Memory grew too much. stdout: ${stdout} stderr: ${stderr}`);
  }
  expect(exitCode).toBe(0);
}, 300_000);
