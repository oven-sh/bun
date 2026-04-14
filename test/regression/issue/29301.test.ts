// https://github.com/oven-sh/bun/issues/29301
// Regression: listener add/remove churn on a long-lived target must keep RSS
// bounded. AbortSignal goes through the same EventTarget listener path, so
// exercising EventTarget directly covers both.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

test("addEventListener/removeEventListener on a shared target doesn't leak", async () => {
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

  // Before the fix, growth was ~42MB for 500k add/remove pairs on top of
  // a ~32MB baseline. After the fix RSS stays essentially flat (~15MB
  // short-lived working-set growth). Anything under the ceiling means
  // we aren't on the unbounded path. ASAN adds per-allocation red-zones
  // + shadow memory, so give that lane more headroom while still being
  // well below the unbounded baseline (the regression would grow
  // proportionally to ITER regardless of build mode).
  const ceilingMB = isASAN ? 75 : 25;
  expect(growthMB).toBeLessThan(ceilingMB);
  expect(exitCode).toBe(0);
});
