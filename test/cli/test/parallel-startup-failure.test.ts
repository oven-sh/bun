// Kept separate from parallel.test.ts: that file has several tests that
// routinely exceed the 5s default timeout under ASAN debug (each test
// spawns a coordinator + multiple workers), and file-level pass/fail is
// what the surrounding tooling checks. This test must be evaluated in
// isolation from those unrelated timing-sensitive cases.
//
// It covers the worker exits that no test file takes the blame for: before
// the worker is ready, and between files or after its last one.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import path from "path";

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
    // The crash is counted by itself, so the run also fails when the sweep
    // finds no queued file to fail. One error for each worker that crashed.
    expect(stderr).toMatch(/^ [12] errors?$/m);
    expect(exitCode).not.toBe(0);
  },
  60_000,
);

// A worker that ends with no file in flight (between files, or while it shuts
// down after its last one) has already reported its tests. How it ended still
// counts: a healthy worker exits 0, and one that was killed or exited non-zero
// can take its coverage, its snapshot writes and the failure recap with it. No
// file takes the blame, so the run fails.
//
// `--no-isolate` keeps a node:test file's process.on("exit") listeners until
// the worker exits, so `body` runs after the worker's last file was reported.
async function runWithExitListener(body: string, { imports = "", launcher = [] as string[] } = {}) {
  using dir = tempDir("parallel-exit-outside-file", {
    "a.test.js": `import { test } from "node:test"; ${imports}
      process.on("exit", () => { ${body} });
      test("a", () => {});`,
    "b.test.js": `import { test } from "bun:test"; test("b", () => {});`,
  });
  await using proc = Bun.spawn({
    cmd: [...launcher, bunExe(), "test", "--parallel=2", "--no-isolate"],
    env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0", BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("PARALLEL");
  return { stderr, exitCode };
}
// Each case runs a coordinator and two workers.
const workerExitTimeout = isASAN || isDebug ? 60_000 : 20_000;

test.concurrent.each(["process.exit(7);", "process.exitCode = 7;"])(
  "--parallel: a worker that exits non-zero after its last file fails the run (%s)",
  async body => {
    const { stderr, exitCode } = await runWithExitListener(body);
    expect(stderr).toContain("error: test worker 1 exited outside a test file (exit code 7)\n");
    expect(stderr).toContain("\n 2 pass\n 0 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  },
  workerExitTimeout,
);

// A crash signal is reported the same way and does not abort the run: once a
// worker is past its last file nothing is queued, so an abort would only take
// down the sibling that still runs b.test.js.
test.concurrent.skipIf(isWindows).each(["SIGKILL", "SIGTERM", "SIGABRT"])(
  "--parallel: a worker killed by %s after its last file fails the run without aborting it",
  async signal => {
    const { stderr, exitCode } = await runWithExitListener(`process.kill(process.pid, "${signal}");`, {
      // SIGABRT dumps core, and CI flags every new core file.
      launcher: ["/bin/sh", "-c", `ulimit -c 0 && exec "$@"`, "--"],
    });
    expect(stderr).toContain(`error: test worker 1 exited outside a test file (${signal})\n`);
    expect(stderr).not.toContain("Aborting");
    expect(stderr).toContain("\n 2 pass\n 0 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  },
  workerExitTimeout,
);

test.concurrent(
  "--parallel --no-isolate: an exit listener that leaves the exit code alone keeps the run green",
  async () => {
    const { stderr, exitCode } = await runWithExitListener("");
    expect(stderr).not.toContain("worker");
    expect(stderr).toContain("\n 2 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  },
  workerExitTimeout,
);

// fd 3 is the IPC channel. The coordinator kills a worker whose stream stops
// decoding, and it names that cause whether the kill landed or the worker had
// already exited on its own.
test.concurrent(
  "--parallel: garbage on fd 3 after a worker's last file fails the run and names the cause",
  async () => {
    const { stderr, exitCode } = await runWithExitListener(`writeSync(3, Buffer.alloc(32, 0xff));`, {
      imports: `import { writeSync } from "node:fs";`,
    });
    expect(stderr).toContain(
      "error: test worker 1 killed outside a test file (corrupt IPC frame, something wrote to fd 3)\n",
    );
    expect(stderr).not.toContain("worker crashed");
    expect(stderr).toContain("\n 2 pass\n 0 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  },
  workerExitTimeout,
);

// The worker writes a.test.js's snapshot file when it shuts down, before it
// sends its coverage. The file is a FIFO here: the write blocks once the pipe
// is full, and the first bytes carry the worker's pid. A kill at that point is
// what an OOM kill during the coverage report looks like to the coordinator:
// every test passed, and the worker's coverage never arrives. With it go the
// table and the coverageThreshold check, so the exit status is the only sign.
test.concurrent.skipIf(isWindows)(
  "--parallel --coverage: a worker killed while it shuts down fails the run",
  async () => {
    using dir = tempDir("parallel-killed-in-shutdown", {
      "bunfig.toml": `[test]\ncoverageThreshold = 0.9\ncoverageSkipTestFiles = true\n`,
      "lib.js": `export function used() { return 1; }\nexport function unused() { return 2; }\n`,
      "a.test.js": `import { test, expect } from "bun:test"; import { used } from "./lib.js";
        test("a", () => {
          expect(used()).toBe(1);
          expect("pid=" + process.pid).toMatchSnapshot();
          expect(Buffer.alloc(1024 * 1024, "x").toString()).toMatchSnapshot();
        });`,
      "b.test.js": `import { test } from "bun:test"; test("b", () => {});`,
      "__snapshots__": {},
    });
    const fifo = path.join(String(dir), "__snapshots__", "a.test.js.snap");
    mkfifo(fifo);
    await using reader = Bun.spawn({
      cmd: ["head", "-c", "512", fifo],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", "--coverage"],
      // CI=false: a worker only writes a new snapshot outside CI.
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0", CI: "false" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const pid = Number((await reader.stdout.text()).match(/pid=(\d+)/)?.[1]);
    expect(pid).toBeGreaterThan(0);
    process.kill(pid, "SIGKILL");
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("PARALLEL");
    expect(stderr).toContain("error: test worker 1 exited outside a test file (SIGKILL)\n");
    expect(stderr).toContain("\n 2 pass\n 0 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  },
  workerExitTimeout,
);

// When bun inherits SIG_IGN for SIGCHLD the kernel reaps the workers itself
// and every wait fails with ECHILD. An exit status that is unknown is not a
// failure, or every run would be red there. bash passes the ignored signal on
// to the program it execs; dash does not.
test.concurrent.skipIf(!isLinux || Bun.which("bash") == null)(
  "--parallel: a healthy run stays green when the worker exit statuses are unknown (SIGCHLD ignored)",
  async () => {
    using dir = makeDir("parallel-sigchld-ignored");
    await using proc = Bun.spawn({
      cmd: ["bash", "-c", `trap "" CHLD; exec "$0" "$@"`, bunExe(), "test", "--parallel=2"],
      env: {
        ...bunEnv,
        BUN_TEST_PARALLEL_SCALE_MS: "0",
        // LeakSanitizer cannot run while SIGCHLD is ignored: its own waitpid() fails.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("PARALLEL");
    expect(stderr).not.toContain("outside a test file");
    expect(stderr).toContain("\n 2 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  },
  workerExitTimeout,
);
