import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/29546
//
// `AbortSignal.timeout(N)` schedules an unref'd timer in Bun's own timer
// heap. When awaited at the top level — with no ref'd handles keeping the
// loop alive — the event loop had two bugs:
//
//   POSIX:   `autoTick()` took the `tickWithoutIdle()` branch (zero-timeout
//            poll) and then `drainTimers()`. The timer eventually fired, but
//            only after a tight busy loop (~100% CPU for the full wait).
//
//   Windows: `tickWithoutIdle` -> `us_loop_pump` -> `uv_run(NOWAIT)`. That
//            call skips its loop body when `uv__loop_alive()` is false (no
//            ref'd handles), so the uv timer that would have drained Bun's
//            heap never fired. The process hung forever.
//
// `waitForPromise` now breaks when the event loop has nothing left to make
// progress — no active handles, no tasks, no concurrent refs, no immediates
// — matching Node.js (unsettled top-level await exits cleanly rather than
// waiting on unref'd handles).

function stripAsanWarning(stderr: string): string {
  return stderr
    .split("\n")
    .filter(l => !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
}

test("AbortSignal.timeout awaited at top-level does not hang or spin", async () => {
  // The timeout is deliberately long (60s). Before the fix, POSIX would
  // busy-loop burning CPU for the full duration and Windows would hang
  // forever. With the fix, the process exits cleanly well under 60s
  // because the unref'd timer doesn't keep the loop alive.
  const source = `
    async function run(signal) {
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve("run aborted"));
      });
    }

    const r = await run(AbortSignal.timeout(60_000));
    console.log(r);
  `;

  const started = performance.now();
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const elapsed = performance.now() - started;

  expect(stripAsanWarning(stderr)).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
  expect(elapsed).toBeLessThan(30_000);
});

test("AbortSignal.timeout fires when something else keeps the loop alive", async () => {
  // Regression guard for the fix above — an unref'd AbortSignalTimeout must
  // still fire when a ref'd handle keeps the loop open, so the abort
  // listener runs and resolves the awaited promise as expected.
  const source = `
    async function run(signal) {
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve("run aborted"));
      });
    }

    const keepAlive = setTimeout(() => {}, 60_000);
    const r = await run(AbortSignal.timeout(100));
    console.log(r);
    clearTimeout(keepAlive);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stripAsanWarning(stderr)).toBe("");
  expect(stdout).toBe("run aborted\n");
  expect(exitCode).toBe(0);
});

test("top-level await on a never-resolving promise exits cleanly", async () => {
  // Same event-loop fix — a pending TLA with no ref'd handles must not spin
  // (POSIX) or hang (Windows). Before the fix, this script hung forever on
  // Windows and burned CPU in a tight loop on POSIX.
  const started = performance.now();
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('before'); await new Promise(() => {}); console.log('after');"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const elapsed = performance.now() - started;

  expect(stripAsanWarning(stderr)).toBe("");
  expect(stdout).toBe("before\n");
  expect(exitCode).toBe(0);
  expect(elapsed).toBeLessThan(30_000);
});
