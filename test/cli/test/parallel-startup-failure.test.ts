// Kept separate from parallel.test.ts: that file has several tests that
// routinely exceed the 5s default timeout under ASAN debug (each test
// spawns a coordinator + multiple workers), and file-level pass/fail is
// what the surrounding tooling checks. This test must be evaluated in
// isolation from those unrelated timing-sensitive cases.

import { expect, test } from "bun:test";
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
