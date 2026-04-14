// https://github.com/oven-sh/bun/issues/29301
//
// Workloads that repeatedly add and remove 'abort' listeners on a
// long-lived AbortSignal (e.g. ydb-js-sdk, which composes each request's
// signal via `AbortSignal.any([userSignal, ...])` and attaches a
// per-request 'abort' listener) grew RSS without bound because the
// native memory cost of each JSEventListener / RegisteredEventListener
// allocation wasn't reported to JSC, so GC didn't kick in proportional
// to listener churn.
//
// This test runs a tight add/remove loop on an EventTarget (the same
// path AbortSignal takes) and asserts RSS doesn't grow unbounded across
// many hundreds of thousands of listener churns.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const { before, after } = JSON.parse(stdout.trim());
  const growthMB = (after - before) / 1024 / 1024;

  // Before the fix, growth was ~42MB for 500k add/remove pairs on top of
  // a ~32MB baseline. After the fix RSS stays essentially flat (~15MB
  // short-lived working-set growth, which is fine). Keep a generous
  // ceiling: anything under 25MB means we aren't on the unbounded path.
  expect(growthMB).toBeLessThan(25);
});
