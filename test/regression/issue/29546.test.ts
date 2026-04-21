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
// `loadEntryPoint` now routes the TLA wait through
// `EventLoop.waitForPromiseOrLoopExit`, which breaks when the event loop
// has nothing left to make progress — matching Node.js (unsettled
// top-level await exits cleanly rather than waiting on unref'd handles).
// `waitForPromise` itself is unchanged — its callers (Expect.toThrow,
// bundler, REPL, …) still rely on the "returns with promise resolved"
// contract.

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
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const elapsed = performance.now() - started;

  // Order matters: a hang regression shows up as elapsed >= 30_000 (and,
  // in the worst case, a SIGTERM exit code from the test timeout). Assert
  // elapsed first so the diff surfaces the actual failure signal rather
  // than the exit-code side effect.
  expect(stdout).toBe("");
  expect(elapsed).toBeLessThan(30_000);
  expect(exitCode).toBe(0);
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
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

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
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const elapsed = performance.now() - started;

  // See test 1 for assertion ordering rationale.
  expect(stdout).toBe("before\n");
  expect(elapsed).toBeLessThan(30_000);
  expect(exitCode).toBe(0);
});

test("unhandled rejection mid-TLA does not abandon an in-flight wait", async () => {
  // The first cut of this fix used `isEventLoopAlive()` as the exit
  // predicate. That short-circuits on `unhandled_error_counter != 0` — so a
  // side-path unhandled rejection (common: a forgotten `.catch()` on a void
  // Promise in default .bun mode) would cause the TLA wait to bail while
  // the real work (here, a `setTimeout`) was still pending. The continuation
  // after `await` would never run. This test pins that behavior: the
  // rejection is still reported on stderr, but the await resolves normally
  // and the code after it executes.
  const source = `
    const t0 = Date.now();
    Promise.reject(new Error("side rejection"));
    await new Promise(r => setTimeout(r, 200));
    process.stdout.write("elapsed=" + (Date.now() - t0 >= 180 ? "ok" : "early") + "\\n");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  // stdout is what matters: the continuation after `await` ran, the timer
  // actually waited ~200ms, and we didn't bail early. (The exit code is 1
  // because bun's default `.bun` unhandled-rejection mode sets it — not our
  // concern here; we just need to prove the wait wasn't abandoned.)
  expect(stdout).toBe("elapsed=ok\n");
  expect(exitCode).toBe(1);
});

test("unhandledRejection handler that resolves the TLA runs to completion", async () => {
  // The default `.bun` unhandled-rejection path calls
  // `Bun__handleUnhandledRejection` and then returns WITHOUT draining
  // microtasks (unlike `.none` / `.warn` / `.strict` which all `defer
  // drainMicrotasks`). If a registered handler resolves the awaited promise,
  // the continuation is queued as a JSC microtask that hasn't run yet when
  // `autoTick` returns. `hasAnyHandleWork()` can't see JSC microtasks, so
  // without a microtask drain between `autoTick` and the liveness check the
  // loop would exit prematurely and the continuation would be silently
  // dropped. This test pins the drain.
  const source = `
    let resolveIt;
    const later = new Promise(r => resolveIt = r);
    process.on("unhandledRejection", () => resolveIt("handled"));
    Promise.reject(new Error("trigger"));
    const r = await later;
    process.stdout.write("got=" + r + "\\n");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("got=handled\n");
  expect(exitCode).toBe(0);
});
