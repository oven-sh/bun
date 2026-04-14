// https://github.com/oven-sh/bun/issues/29301
// Regression: listener add/remove churn on a long-lived target must keep RSS
// bounded. AbortSignal goes through the same EventTarget listener path, so
// exercising EventTarget directly covers both.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// Skipped on any sanitizer/debug build: ASAN (or the debug profile,
// which also enables ASAN) slows the loop ~50x, which gives JSC enough
// wall-clock time to run a GC under its existing heap-growth heuristics
// and masks the regression signal this PR's `reportExtraMemory` nudge
// addresses. Observed empirically: instrumented builds produce
// near-identical RSS growth fixed vs unfixed. Release builds, where the
// loop finishes in ~1s before JSC naturally collects, are where the
// ~3x gap (~42MB unfixed vs ~15MB fixed) shows up.
test.skipIf(isDebug || isASAN)("addEventListener/removeEventListener on a shared target doesn't leak", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--smol",
      "-e",
      `
      const target = new EventTarget();
      const ITER = 500_000;
      const before = process.memoryUsage().rss;
      for (let i = 0; i < ITER; i++) {
        const fn = () => {};
        target.addEventListener('abort', fn);
        target.removeEventListener('abort', fn);
      }
      const after = process.memoryUsage().rss;
      console.log(JSON.stringify({ before, after }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  // Drain stderr alongside stdout. ASAN builds emit `WARNING: ASAN
  // interferes with JSC signal handlers...` and leak reports there; if
  // we don't read it the ~64KB pipe buffer fills and the subprocess
  // deadlocks on its next write.
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Guard before JSON.parse so a subprocess crash surfaces stderr +
  // exit code in the failure instead of an opaque SyntaxError on "".
  const trimmed = stdout.trim();
  if (trimmed === "") {
    throw new Error(`subprocess produced no stdout (exitCode=${exitCode})\n--- stderr ---\n${stderr}`);
  }

  const { before, after } = JSON.parse(trimmed);
  const growthMB = (after - before) / 1024 / 1024;

  // Without fix: ~42MB. With fix: ~15MB. 25MB is well clear of the
  // working-set noise while still inside the regression range.
  expect(growthMB).toBeLessThan(25);
  expect(exitCode).toBe(0);
});
