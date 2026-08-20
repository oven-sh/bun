import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// https://github.com/oven-sh/bun/issues/28756
// AbortSignal.timeout() + util.aborted(): once the listener aborted() added is
// gone nothing observes the signal any more, and the signal and its timer have
// to become garbage. The bug kept every such signal alive until the timer
// fired (here: never).
//
// The child churns batches of signals after a warmup batch and reports
//   - how many AbortSignal wrappers outlive a full GC: 0 when fixed, every
//     signal when something keeps the signal observed or referenced,
//   - RSS growth since the warmup batch, which also covers the original shape
//     of the bug, where the wrapper died but the native signal and timer did not.
//
// RSS of the fixed build still moves by a few MB of JIT code and allocator
// slack that do not scale with the signal count, so the release build churns
// enough signals for a leak to stand clear of that floor. Measured on linux
// x64, fixed build vs. leak simulated by keeping every signal alive:
//   release,    80 x 500 signals:  2-4 MB vs. 23-34 MB (0.6-0.9 KB per signal)
//   debug+ASAN,  4 x 250 signals:  0-3 MB vs.   0-3 MB (hidden in the slack)
// Slow builds churn few signals to keep the file fast, so there only the
// wrapper count tells the two apart and the RSS bound is a coarse backstop.
const slow = isASAN || isDebug;
const batchSize = slow ? 250 : 500;
const batches = slow ? 4 : 80;
const signals = batchSize * batches;
const maxRssGrowthMB = 12;

test("AbortSignal.timeout + util.aborted does not leak memory", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
      const { aborted } = require("util");
      const { heapStats } = require("bun:jsc");
      const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
      const liveSignals = () => heapStats().objectTypeCounts.AbortSignal ?? 0;

      function churn() {
        for (let i = 0; i < ${batchSize}; i++) {
          const listener = () => {};
          const signal = AbortSignal.timeout(1_000_000_000);
          signal.addEventListener("abort", listener);
          aborted(signal, {});
          signal.removeEventListener("abort", listener);
        }
      }

      // A churned signal dies in two collections: the first collects the {}
      // passed to aborted(), whose FinalizationRegistry callback removes the
      // listener aborted() registered (callbacks run as a task, hence the event
      // loop turn), the second collects the now unobserved signal and its timer.
      async function settle() {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
        Bun.gc(true);
      }

      churn();
      await settle();
      const baselineRss = rss();
      const baselineSignals = liveSignals();

      const rssGrowthPerBatch = [];
      for (let i = 0; i < ${batches}; i++) {
        churn();
        await settle();
        rssGrowthPerBatch.push(rss() - baselineRss);
      }

      console.log(JSON.stringify({
        leakedSignals: liveSignals() - baselineSignals,
        rssGrowth: rssGrowthPerBatch.at(-1),
        rssGrowthPerBatch,
      }));
      `,
    ],
    env: {
      ...bunEnv,
      // ASAN parks freed allocations in its quarantine (default 256 MB) instead
      // of reusing them, so RSS grows by everything the child allocates whether
      // or not it leaks (measured: the fixed build grew more than the leaking
      // one). Disable it for the measuring process; non-ASAN builds ignore it.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");

  const { leakedSignals, rssGrowth, rssGrowthPerBatch } = JSON.parse(stdout);
  expect(rssGrowthPerBatch).toHaveLength(batches);

  // With the leak every signal survives. Conservative stack scanning can keep
  // a couple of them alive on a fixed build, never a whole batch.
  expect(leakedSignals, `${leakedSignals} of ${signals} AbortSignal wrappers survived GC`).toBeLessThan(batchSize);

  const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + " MB";
  const every = Math.ceil(batches / 8);
  const trend = rssGrowthPerBatch.flatMap((bytes: number, i: number) =>
    (i + 1) % every === 0 ? [`${i + 1}: ${toMB(bytes)}`] : [],
  );
  expect(
    rssGrowth / 1024 / 1024,
    `RSS grew ${toMB(rssGrowth)} over ${signals} signals (after batch ${trend.join(", ")})`,
  ).toBeLessThan(maxRssGrowthMB);

  expect(exitCode).toBe(0);
});
