// Kept separate from parallel.test.ts: that file has several tests that
// routinely exceed the 5s default timeout under ASAN debug (each test
// spawns a coordinator + multiple workers), and file-level pass/fail is
// what the surrounding tooling checks. This test must be evaluated in
// isolation from those unrelated timing-sensitive cases.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--parallel terminates when a worker exits before sending .ready", async () => {
  // A worker that spawns OK but dies during init (before the IPC handshake)
  // has `inflight == null`, so the per-file retry cap in reapWorker never
  // applied and the coordinator would respawn the slot forever. The run must
  // terminate with a non-zero exit after a bounded number of attempts.
  //
  // Real triggers (startup segfault, failed fd-3 adopt) aren't reproducible
  // from a test, so runAsWorker honours BUN_TEST_WORKER_EXIT_BEFORE_READY.
  using dir = tempDir("parallel-pre-ready-crash", {
    "a.test.js": `import {test,expect} from "bun:test"; test("a",()=>expect(1).toBe(1));`,
    "b.test.js": `import {test,expect} from "bun:test"; test("b",()=>expect(1).toBe(1));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--parallel=2"],
    env: { ...bunEnv, BUN_TEST_WORKER_EXIT_BEFORE_READY: "1" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  // Generous race window: under ASAN each worker exec+init can take
  // several seconds, and up to 4 spawn before the cap halts the run.
  // The bug this guards against is an *infinite* respawn loop, so the
  // exact bound isn't important — only that the run terminates.
  const result = await Promise.race([
    Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]),
    Bun.sleep(45000).then(() => "TIMEOUT" as const),
  ]);
  if (result === "TIMEOUT") proc.kill("SIGKILL");
  expect(result).not.toBe("TIMEOUT");
  const [, stderr, exitCode] = result as [string, string, number];
  // Assert only on coordinator-generated output: tryReap gates on ipc.done
  // but not err.done, so the worker's own stderr line can race the reap and
  // be dropped by w.err.deinit() before it's captured. The coordinator
  // prints "exited during startup" synchronously inside reapWorker, once
  // per pre-ready reap — a reliable spawn counter.
  expect(stderr).toContain("exited during startup");
  // Both queued files were accounted for (marked failed, not silently dropped).
  expect(stderr).toContain("a.test.js");
  expect(stderr).toContain("b.test.js");
  // Respawns are capped per slot at max_startup_failures=2; with K=2 the
  // worst case is 4 spawns. Slot 0 alone guarantees ≥2: its first reap has
  // startup_failures=1 < 2 and has_work=true (no worker reaches .ready, so
  // no range is ever consumed), so it respawns once before hitting the cap.
  // Slot 1 may additionally spawn if maybeScaleUp ticks in the window
  // between slot 0's onProcessExit (`!alive → continue`) and its reap.
  const spawns = (stderr.match(/exited during startup/g) ?? []).length;
  expect(spawns).toBeGreaterThanOrEqual(2);
  expect(spawns).toBeLessThanOrEqual(4);
  expect(exitCode).not.toBe(0);
}, 60_000);
