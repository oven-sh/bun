import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/29043
//
// Worker error event must honor preventDefault(): when the worker's own
// `error` event listener cancels the event, the error must not propagate to
// the parent Worker and the worker must not be terminated with exit code 1.
// Per the HTML spec's "runtime script errors" algorithm for WorkerGlobalScope,
// the ErrorEvent dispatched on the worker's global scope must be cancelable,
// and `preventDefault()` (or an `onerror` attribute returning `true`) must
// suppress the default propagation.

async function runWorker(workerCode: string, parentFlags: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      ...parentFlags,
      "-e",
      `
        import { Worker } from 'node:worker_threads';
        const worker = new Worker(${JSON.stringify(workerCode)}, { eval: true });
        const errors = [];
        worker.on('error', (err) => { errors.push(err && err.message); });
        const workerExitCode = await new Promise((resolve) => { worker.on('exit', resolve); });
        console.log('exit:' + workerExitCode);
        if (errors.length !== 0) {
          console.log('PARENT_ERROR_COUNT:' + errors.length);
          process.exit(2);
        }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function expectCleanWorkerExit({ stdout }: { stdout: string; exitCode: number | null }) {
  // The worker's own exit code is printed to stdout as `exit:N`. We assert
  // against THAT, not the outer bun process's exit code — the outer process
  // can race on shutdown in release builds (tracked separately; see
  // `PARENT_ERROR_COUNT` gate for the condition we actually care about).
  //
  // We don't assert on stderr: the ASAN debug build emits a JSC-signal-
  // handler warning and release builds can hit a preexisting worker-teardown
  // race that produces parent-side panics unrelated to the worker's error
  // handling. The `exit:0` + `PARENT_ERROR` gates above are what actually
  // measure this PR's behavior.
  expect(stdout).toContain("exit:0");
  expect(stdout).not.toContain("PARENT_ERROR");
}

test("Worker error event preventDefault() stops propagation and keeps worker running (async throw)", async () => {
  // Microtask throw — exercises the runtime `onUnhandledRejection` path.
  //
  // This test deliberately does NOT call `process.exit(0)` — the nested
  // `setImmediate` provides a natural drain point, and natural drainage is
  // required to observe the `uncaughtException` path's `prev_exit_code`
  // restore (VirtualMachine.zig). An explicit `process.exit(0)` would
  // overwrite `exit_handler.exit_code` before the exit event fires, making
  // the `exit:0` assertion tautological for this code path.
  const result = await runWorker(`
    globalThis.addEventListener('error', (e) => {
      console.log('handled:' + (e.error && e.error.message));
      e.preventDefault();
    });

    queueMicrotask(() => {
      throw new Error('hmm');
    });

    setImmediate(() => {
      setImmediate(() => {
        console.log('alive');
      });
    });
  `);

  expect(result.stdout).toContain("handled:hmm");
  expect(result.stdout).toContain("alive");
  expectCleanWorkerExit(result);
});

test("Worker error event preventDefault() stops propagation and keeps worker running (top-level throw)", async () => {
  // Top-level throw — flows through the rejected-promise branch in `spin()`.
  const result = await runWorker(`
    globalThis.addEventListener('error', (e) => {
      console.log('handled:' + (e.error && e.error.message));
      e.preventDefault();
    });

    setImmediate(() => {
      console.log('alive');
      process.exit(0);
    });

    throw new Error('entry');
  `);

  expect(result.stdout).toContain("handled:entry");
  expect(result.stdout).toContain("alive");
  expectCleanWorkerExit(result);
});

test("Worker error event preventDefault() does not leak prevented state across dispatches", async () => {
  // Two sequential cancelled errors. Each dispatch must see the worker start
  // from a clean state: `e.defaultPrevented === false` at entry. A regression
  // in the `error_event_prevented = false` reset at `onUnhandledRejection`'s
  // entry (web_worker.zig) would leave a stale `true` from the first error
  // visible in downstream guards, but would NOT be observable via
  // `e.defaultPrevented` here — that's a separate flag on the Event object.
  //
  // What this test actually guards against: a double-dispatch of a single
  // error (which would show dispatch:2 for the same message), and ensures
  // both errors make it to the listener and are cancelled cleanly.
  const result = await runWorker(`
    let dispatchCount = 0;
    globalThis.addEventListener('error', (e) => {
      dispatchCount++;
      console.log('dispatch:' + dispatchCount + ':' + (e.error && e.error.message) + ':prev=' + e.defaultPrevented);
      e.preventDefault();
    });

    queueMicrotask(() => { throw new Error('first'); });
    queueMicrotask(() => { throw new Error('second'); });

    setImmediate(() => {
      console.log('alive total:' + dispatchCount);
      process.exit(0);
    });
  `);

  // Each error was dispatched exactly once, with a fresh (not-prevented)
  // event object, and cancelled — so the worker keeps running.
  expect(result.stdout).toContain("dispatch:1:first:prev=false");
  expect(result.stdout).toContain("dispatch:2:second:prev=false");
  expect(result.stdout).toContain("alive total:2");
  expectCleanWorkerExit(result);
});

test("Worker error event preventDefault() keeps worker alive and exits cleanly even if listener itself throws", async () => {
  // When the `error` listener both calls `e.preventDefault()` and throws a
  // secondary exception, WebCore routes the listener's throw synchronously
  // through `reportException` -> `Bun__reportUnhandledError` -> re-entrant
  // `uncaughtException`, which bumps `unhandled_error_counter` AND sets
  // `exit_code = 1`.
  //
  // Two things must be rolled back in `onUnhandledRejection`'s prevented path:
  //   1. Counter — restored via `counter_snapshot - 1` (undoes the caller's
  //      `+= 1` plus any re-entrant increments). Without this the event loop
  //      would see a non-zero counter and exit prematurely.
  //   2. exit_code — restored via `exit_code_snapshot`. On the `.bun`
  //      unhandledRejection path there is no outer `uncaughtException` frame
  //      to roll this back, so we must do it here. Without this the worker
  //      exits with code 1 despite `preventDefault()`.
  //
  // CRITICAL: this test does NOT call `process.exit(0)` — that would mask
  // the exit-code bug by explicitly setting the exit code to 0 before the
  // event loop drains. Natural drainage is required to observe the bug.
  const result = await runWorker(`
    globalThis.addEventListener('error', (e) => {
      console.log('dispatched:' + (e.error && e.error.message));
      e.preventDefault();
      throw new Error('listener threw');
    });

    Promise.reject(new Error('original'));

    // Schedule a macrotask so the worker has work to do AFTER the listener
    // throws, proving the event loop stayed alive. Do NOT exit explicitly
    // — let the event loop drain naturally so we observe the exit code the
    // runtime produces.
    setImmediate(() => {
      console.log('alive');
    });
  `);

  expect(result.stdout).toContain("dispatched:original");
  expect(result.stdout).toContain("alive");
  // Same clean-exit gate as tests 1-3. The listener's secondary throw is
  // absorbed by `onUnhandledRejection`'s re-entry-safe handling and must
  // NOT escalate to a parent error (verified via the `PARENT_ERROR` gate
  // in `expectCleanWorkerExit`).
  expectCleanWorkerExit(result);
});

test("Worker error_event_prevented does not leak across uncaughtException calls under inherited --unhandled-rejections=strict", async () => {
  // The worker inherits the parent's `--unhandled-rejections=strict` mode via
  // `transform_options` copy (see `web_worker.zig start()`). Sequence:
  //
  //   (1) `queueMicrotask` throw → `Bun__reportUnhandledError` → direct call to
  //       `VirtualMachine.uncaughtException()`. Listener calls preventDefault
  //       → `error_event_prevented = true` is set for this dispatch.
  //
  //   (2) The worker then installs `process.on('uncaughtException')` and
  //       `process.on('unhandledRejection')` handlers, then triggers a second
  //       error via `Promise.reject`. This goes through `unhandledRejection`
  //       → `.strict` case → `uncaughtException(is_rejection=true)` where
  //       `Bun__handleUncaughtException` now returns > 0 (the uncaught handler
  //       fires), so the `if (!handled)` block is skipped — meaning
  //       `onUnhandledRejection`'s own entry-reset never runs.
  //
  //   (3) Control returns to `.strict`. Its guard at
  //       `takeWorkerErrorEventPrevented()` then reads the flag. Without the
  //       entry-reset in `uncaughtException`, it would read the *stale* `true`
  //       from step (1) and wrongly skip `Bun__handleUnhandledRejection`,
  //       silently swallowing the `process.on('unhandledRejection')` dispatch
  //       for error (2) even though error (2) was never presented to the
  //       globalThis listener.
  //
  //   This test asserts both handlers fire: `uncaught:true` (uncaughtException
  //   handler ran) AND `unhandled:true` (unhandledRejection handler ran).
  const result = await runWorker(
    `
    globalThis.addEventListener('error', (e) => {
      console.log('dispatched:' + (e.error && e.error.message));
      e.preventDefault();
    });
    queueMicrotask(() => { throw new Error('first'); });
    setImmediate(() => {
      setImmediate(() => {
        let uncaughtSeen = false;
        let unhandledSeen = false;
        process.on('uncaughtException', () => { uncaughtSeen = true; });
        process.on('unhandledRejection', () => { unhandledSeen = true; });
        Promise.reject(new Error('second'));
        setImmediate(() => {
          setImmediate(() => {
            console.log('uncaught:' + uncaughtSeen);
            console.log('unhandled:' + unhandledSeen);
          });
        });
      });
    });
  `,
    ["--unhandled-rejections=strict"],
  );

  expect(result.stdout).toContain("dispatched:first");
  expect(result.stdout).toContain("uncaught:true");
  expect(result.stdout).toContain("unhandled:true");
  expectCleanWorkerExit(result);
});
