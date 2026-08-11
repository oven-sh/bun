import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isDebug } from "harness";
import { join } from "path";

// worker_thread_check.ts runs RUN_COUNT rounds of CONCURRENCY Workers, terminating each as it comes
// online. On a debug build a worker_threads Worker takes ~1.7s just to come online (~30ms on release),
// so every round costs ~2s regardless of its size and the full 5 x 10 takes ~30s per case, well past
// the 5s default timeout. Debug builds run one round of a few workers (~3s), which still takes each
// teardown path with several workers terminating at once; release builds, which is all CI runs (ASAN
// lanes included), keep the full count.
const RUN_COUNT = isDebug ? 1 : 5;
const CONCURRENCY = isDebug ? 3 : 10;

describe("Worker destruction", () => {
  const method = ["Bun.connect", "Bun.listen", "fetch"];
  describe.each(method)("bun when %s is used in a Worker that is terminating", method => {
    test.concurrent("exits cleanly", async () => {
      const result = await bunRun([join(import.meta.dir, "worker_thread_check.ts"), method], {
        RUN_COUNT: String(RUN_COUNT),
        CONCURRENCY: String(CONCURRENCY),
      });
      expect(result).toSpawn();
      // One line per completed round, so a misread count cannot turn this into a no-op run.
      expect(result.stdout.split("\n").map(line => line.replace(/ RSS \d+ MB$/, ""))).toEqual(
        Array(RUN_COUNT).fill(`Spawned ${CONCURRENCY} workers`),
      );
    });
  });

  // The worker owns a child process whose stdin pipe has a large write in flight that can never
  // complete (the child never reads). Terminating the worker must close that pipe through its owner
  // rather than wait for the write; otherwise the worker thread never finishes and terminate() hangs.
  test.concurrent("terminate() a Worker with a child process and a pending stdin write", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("worker_threads");
        const w = new Worker(\`
          const { parentPort } = require("worker_threads");
          const p = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
          p.stdin.write(Buffer.alloc(4 << 20));
          p.stdin.flush();
          parentPort.postMessage(p.pid);
        \`, { eval: true });
        w.on("error", e => { console.error(e); process.exit(2); });
        w.on("message", async pid => {
          const code = await w.terminate();
          try { process.kill(pid); } catch {}
          console.log("terminated " + code);
          process.exit(0);
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("terminated 1");
    expect(exitCode).toBe(0);
  });
});
