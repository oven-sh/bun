import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// Regression coverage for a Windows-only panic: integer overflow in
// uv.Loop.active_handles during process teardown when a large number of
// child processes are cleaned up at exit. Historically intermittent with
// ~300+ children. The Windows active_handles counter now saturates like
// the POSIX `active` counter does, so the teardown path cannot underflow.
//
// On POSIX this path was never affected (subActive already saturates), so
// this test also passes there; it is kept enabled everywhere as a general
// stress check of the many-subprocess teardown path.
test("tearing down hundreds of spawned subprocesses at exit does not overflow the loop active-handle counter", async () => {
  const N = 350;
  const fixture = /* js */ `
    const cmd = process.platform === "win32"
      ? [process.env.comspec || "cmd.exe", "/c", "exit", "0"]
      : ["/bin/sh", "-c", "exit 0"];

    const N = ${N};
    const procs = [];
    for (let i = 0; i < N; i++) {
      procs.push(
        Bun.spawn({
          cmd,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
    }

    // Drain output and wait for every child so that all pipe readers and
    // process handles are active by the time we reach teardown.
    await Promise.all(
      procs.map(async (p) => {
        await p.stdout.text();
        await p.stderr.text();
        await p.exited;
      }),
    );

    console.log("spawned=" + procs.length);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    console.error(stderr);
  }
  expect(stdout.trim()).toBe(`spawned=${N}`);
  // A panic during process teardown (after the script body has run) would
  // surface as a non-zero exit code.
  expect(exitCode).toBe(0);
}, 120_000);

// https://github.com/oven-sh/bun/issues/28175
//
// The first Bun.spawnSync in a VM lazily creates a private libuv loop that is
// freed through us_loop_free when the VM is destroyed, which for a Worker is
// mid-process. libuv only removes a loop from its global uv__loops[] registry
// when uv_loop_close() succeeds; us_loop_free used to free the loop even when
// uv_loop_close() returned UV_EBUSY, leaving a dangling registry pointer that
// uv__wake_all_loops() dereferences on the next Windows suspend/resume.
//
// The debug build keeps libuv's internal assert()s live, so a teardown that
// frees a still-registered loop aborts the child process below. The stdio
// shapes are the ones that leave the most handles in CLOSING state on the
// spawn-sync loop at teardown (extra-fd pipe, timeout timer, stdin writer).
test.skipIf(!isWindows)(
  "the per-worker spawnSync libuv loop is fully drained and closed at worker teardown",
  async () => {
    using dir = tempDir("spawnsync-uvloop-teardown", {
      "worker.mjs": /* js */ `
        import { parentPort } from "node:worker_threads";
        const exe = process.execPath;
        // An extra "pipe" stdio entry lands a uv_pipe_t on the spawn-sync loop
        // that nothing reads; finalizeStreams only uv_close()s it, so its close
        // callback is still pending when the worker tears down.
        Bun.spawnSync({ cmd: [exe, "-e", "1"], stdio: ["ignore", "pipe", "pipe", "pipe"] });
        // A stdin write the child never drains plus a timeout, so the timeout
        // timer (whose callback calls uv_stop on the loop) and the writer are
        // both live late into the teardown.
        Bun.spawnSync({
          cmd: [exe, "-e", "Bun.sleepSync(60_000)"],
          timeout: 25,
          stdin: Buffer.alloc(1 << 20, 66),
          stdout: "pipe",
          stderr: "pipe",
        });
        parentPort.postMessage("done");
      `,
      "main.mjs": /* js */ `
        import { Worker } from "node:worker_threads";
        for (let i = 0; i < 6; i++) {
          const worker = new Worker(new URL("./worker.mjs", import.meta.url));
          await new Promise((resolve, reject) => {
            worker.on("message", resolve);
            worker.on("error", reject);
          });
          await worker.terminate();
        }
        console.log("OK");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.error(stderr);
    }
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  },
  120_000,
);
