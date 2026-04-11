import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// ASAN debug builds print a one-line warning to stderr on startup.
// Strip it so the tests still assert on a clean stderr.
const stripAsanNotice = (s: string) => s.replace(/^WARNING: ASAN interferes .*\n/m, "");

// https://github.com/oven-sh/bun/issues/29173
//
// `worker.terminate()` never resolved when the worker thread was blocked in
// `Atomics.wait` — e.g. tinypool's atomicsWaitLoop — because JSC's sync wait
// loop checks `!vm.hasTerminationRequest()` on wakeup, and that flag was
// never set from the parent thread. The child was stuck parked on
// `vm.syncWaiter()->condition()` with no way out.
//
// Fix: when the parent requests termination, set `hasTerminationRequest` on
// the child VM from the parent thread and signal the syncWaiter's condition,
// so the wait loop observes the flag on wakeup and returns
// `WaitSyncResult::Terminated`.
test("worker.terminate() unblocks a worker parked in Atomics.wait", { timeout: 30_000 }, async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { Worker } = require("worker_threads");
        const workerSource =
          'const { parentPort } = require("worker_threads");' +
          'parentPort.postMessage("ready");' +
          'parentPort.on("message", (msg) => {' +
          '  const arr = new Int32Array(msg.sab);' +
          // Blocks the worker thread in a kernel futex. Without the fix,
          // worker.terminate() from the parent never unparks this.
          '  Atomics.wait(arr, 0, 0);' +
          '});';
        const blob = new Blob([workerSource], { type: "application/javascript" });
        const w = new Worker(URL.createObjectURL(blob));
        await new Promise((r) => w.once("message", r));
        const sab = new SharedArrayBuffer(4);
        w.postMessage({ sab });
        // Let the worker thread actually enter Atomics.wait before we try to
        // unblock it — avoids racing termination against a not-yet-parked
        // worker, which would work even without the fix.
        await new Promise((r) => setTimeout(r, 50));
        const code = await w.terminate();
        console.log("terminated with code", code);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stripAsanNotice(stderr)).toBe("");
  expect(stdout).toBe("terminated with code 0\n");
  expect(exitCode).toBe(0);
});

// Same shape as the issue's original reproduction: multiple workers all
// blocked in Atomics.wait at once (tinypool spawns one worker per CPU).
// Catches races in the parent → child termination signalling that a
// single-worker test can miss. Kept small (N=2) so the debug-ASAN build
// fits in the default per-test timeout; the fix is exercised regardless.
test("worker.terminate() unblocks multiple workers parked in Atomics.wait", { timeout: 30_000 }, async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { Worker } = require("worker_threads");
        const workerSource =
          'const { parentPort } = require("worker_threads");' +
          'parentPort.postMessage("ready");' +
          'parentPort.on("message", (msg) => {' +
          '  const arr = new Int32Array(msg.sab);' +
          '  Atomics.wait(arr, 0, 0);' +
          '});';
        const blob = new Blob([workerSource], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        const N = 2;
        const workers = [];
        for (let i = 0; i < N; i++) {
          const w = new Worker(url);
          await new Promise((r) => w.once("message", r));
          const sab = new SharedArrayBuffer(4);
          w.postMessage({ sab });
          workers.push(w);
        }
        await new Promise((r) => setTimeout(r, 100));
        const codes = await Promise.all(workers.map((w) => w.terminate()));
        console.log("terminated", codes.length, "workers");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stripAsanNotice(stderr)).toBe("");
  expect(stdout).toBe("terminated 2 workers\n");
  expect(exitCode).toBe(0);
});
