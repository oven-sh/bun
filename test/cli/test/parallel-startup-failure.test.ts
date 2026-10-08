// Kept separate from parallel.test.ts: that file has several tests that
// routinely exceed the 5s default timeout under ASAN debug (each test
// spawns a coordinator + multiple workers), and file-level pass/fail is
// what the surrounding tooling checks. This test must be evaluated in
// isolation from those unrelated timing-sensitive cases.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// The BUN_TEST_WORKER_EXIT_BEFORE_READY hook is compiled only into
// debug/ASAN builds so a stray env var can't disable --parallel in release.
const hasHook = isDebug || isASAN;

function makeDir(prefix: string) {
  return tempDir(prefix, {
    "a.test.js": `import {test,expect} from "bun:test"; test("a",()=>expect(1).toBe(1));`,
    "b.test.js": `import {test,expect} from "bun:test"; test("b",()=>expect(1).toBe(1));`,
  });
}

async function runParallel(dir: string, mode: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2"],
    env: { ...bunEnv, BUN_TEST_WORKER_EXIT_BEFORE_READY: mode },
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });
  // Generous race window: under ASAN each worker exec+init can take
  // several seconds, and up to 4 spawn before the cap halts the run.
  // The bug this guards against is an *infinite* respawn loop, so the
  // exact bound isn't important — only that the run terminates.
  const result = await Promise.race([
    Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]),
    Bun.sleep(45_000).then(() => "TIMEOUT" as const),
  ]);
  if (result === "TIMEOUT") proc.kill("SIGKILL");
  expect(result).not.toBe("TIMEOUT");
  return result as [string, string, number];
}

test.skipIf(!hasHook)(
  "--parallel terminates when a worker exits before sending .ready",
  async () => {
    // A worker that spawns OK but dies during init (before the IPC handshake)
    // has `inflight == None`, so the mid-file crash handling in reap_worker
    // never applied and the coordinator would respawn the slot forever with
    // no output (issue #40782). The run must terminate with a non-zero exit
    // after a bounded number of attempts.
    using dir = makeDir("parallel-pre-ready-exit");
    const [, stderr, exitCode] = await runParallel(String(dir), "1");
    // Assert only on coordinator-generated output: try_reap gates on ipc.done
    // but not err.done, so the worker's own stderr line can race the reap and
    // be dropped before it's captured. The coordinator prints "exited during
    // startup" synchronously inside reap_worker, once per pre-ready reap — a
    // reliable spawn counter.
    expect(stderr).toContain("exited during startup");
    // Both queued files were accounted for (marked failed, not silently dropped).
    expect(stderr).toContain("a.test.js");
    expect(stderr).toContain("b.test.js");
    // Respawns are capped per slot at MAX_STARTUP_FAILURES=2; with K=2 the
    // worst case is 4 spawns. Slot 0 alone guarantees >=2: its first reap has
    // startup_failures=1 < 2 and undispatched files remain (no worker reaches
    // .ready, so no range is ever consumed), so it respawns once before
    // hitting the cap. Slot 1 may additionally spawn if maybe_scale_up ticks
    // in the window between slot 0's process exit and its reap.
    const spawns = (stderr.match(/exited during startup/g) ?? []).length;
    expect(spawns).toBeGreaterThanOrEqual(2);
    expect(spawns).toBeLessThanOrEqual(4);
    expect(exitCode).not.toBe(0);
  },
  60_000,
);

test.skipIf(!hasHook)(
  "--parallel aborts the whole run when a worker crashes before sending .ready",
  async () => {
    // A fatal signal during init is a Bun bug just like one mid-file: the
    // coordinator must print the crash banner, sweep the queued files, and
    // end the run instead of retrying the slot.
    using dir = makeDir("parallel-pre-ready-crash");
    const [, stderr, exitCode] = await runParallel(String(dir), "abort");
    expect(stderr).toContain("crashed with");
    expect(stderr).toContain("during startup");
    // Queued files are swept, not silently dropped, and not retried.
    expect(stderr).toContain("aborted: worker panicked during startup");
    expect(stderr).toContain("a.test.js");
    expect(stderr).toContain("b.test.js");
    expect(stderr).not.toContain("retrying");
    expect(exitCode).not.toBe(0);
  },
  60_000,
);

// A worker turns its event loop while it has no file: between two files, after its last one until
// the coordinator tells it to exit, and while it exits. No test owns an error that fires there.
describe("--parallel: an error that no test owns", () => {
  const test1 = (body: string) =>
    `import {test,expect} from "bun:test"; test("t", () => { ${body} expect(1).toBe(1); });`;
  const good = test1("");
  // With --no-isolate nothing cancels the timer when its file ends. The test is synchronous and
  // sleeps past the deadline, so the file ends with the callback overdue and no loop turn left in
  // which it could run while the file is still active.
  const late = test1(
    `setTimeout(() => { Promise.reject(new Error("LATE")); throw new Error("LATE"); }, 0); Bun.sleepSync(20);`,
  );
  // setImmediate callbacks run once more after the last test, while the file is still active.
  const afterLastTest = test1(`setImmediate(() => { throw new Error("LATE"); });`);
  // --no-isolate keeps a node:test file's listeners until the worker exits. On ASAN builds, short
  // sends on the IPC fd leave the worker's reports queued, so they arrive only if the worker
  // drains its channel after the listeners ran.
  const exitListeners = `import {test} from "node:test";
    import {socketFaultInjection as fault} from "bun:internal-for-testing";
    for (let i = 0; i < 2; i++)
      process.on("exit", () => {
        if (fault.available()) fault.set({ syscall: "send", action: "short", bytes: 2, repeat: -1, fd: 3 });
        throw new Error("LATE");
      });
    test("t", () => {});`;
  // The isolation swap closes the socket once its file is no longer active.
  const closeHandler = `import {test,expect} from "bun:test";
    test("t", async () => {
      const socket = { data() {}, open() {}, close() {} };
      const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket });
      const close = () => { throw new Error("LATE"); };
      await Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: { ...socket, close } });
      expect(listener.port).toBeGreaterThan(0);
    });`;

  async function run(flag: string, a: string, b: string) {
    using dir = tempDir("parallel-unowned-error", { "a.test.js": a, "b.test.js": b });
    await using proc = Bun.spawn({
      // Huge scale-up delay: one worker runs both files, a.test.js first.
      cmd: [bunExe(), "test", "--parallel=2", "--parallel-delay=1000000", flag],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return {
      printed: stderr.match(/^error: LATE$/gm)?.length ?? 0,
      banners: stderr.match(/^# Unhandled error between tests$/gm)?.length ?? 0,
      summary: stderr.match(/^ *\d+ (pass|fail|errors?)$/gm)?.map(line => line.trim()),
      exitCode,
    };
  }
  const counted = (errors: number) => ({
    printed: errors,
    banners: errors,
    summary: ["2 pass", "0 fail", errors === 1 ? "1 error" : `${errors} errors`],
    exitCode: 1,
  });

  test.each([
    { when: "between two files", flag: "--no-isolate", files: [late, good], errors: 2 },
    { when: "after the last file", flag: "--no-isolate", files: [good, late], errors: 2 },
    // This one was counted before too. The worker now reports it the same way as the others.
    { when: "after a file's last test", flag: "--isolate", files: [afterLastTest, good], errors: 1 },
  ])("is counted $when ($flag)", async ({ flag, files: [a, b], errors }) => {
    expect(await run(flag, a, b)).toEqual(counted(errors));
  });

  // The timeout: node:test and bun:internal-for-testing take seconds to load on a debug build.
  test("is counted in exit listeners (--no-isolate)", async () => {
    expect(await run("--no-isolate", exitListeners, good)).toEqual(counted(2));
  }, 60_000);

  // The swap also raises errors in files whose code throws nothing (a socket it closes mid-request),
  // so an error that fires there stays as it was: printed, not counted.
  test("is not counted in the isolation swap (--isolate)", async () => {
    expect(await run("--isolate", closeHandler, good)).toEqual({
      printed: 1,
      banners: 0,
      summary: ["2 pass", "0 fail"],
      exitCode: 0,
    });
  });
});
