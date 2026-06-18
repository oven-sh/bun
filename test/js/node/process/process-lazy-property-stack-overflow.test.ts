import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The Worker constructor queues the process 'worker' event via Process::queueNextTick, which
// reifies process.nextTick from C++ (JSObject::get). If that first use happens while the stack is
// nearly exhausted, the lazy PropertyCallback initializer clears the stack-overflow exception and
// returns undefined, leaving the property reified as undefined and m_nextTickFunction unset, so
// every later internal nextTick user (Worker construction, emitWarning, ...) kept failing with
// "Failed to call nextTick". queueNextTick now retries the initialization once the stack is
// healthy again and repairs the JS-visible slot.
test("first use of process.nextTick during stack exhaustion does not break Worker construction", async () => {
  using dir = tempDir("nexttick-stack-exhaustion", {
    "worker.js": `postMessage("ready");`,
    "main.js": `
      process.on("uncaughtException", () => {});
      const workerPath = new URL("./worker.js", import.meta.url).href;

      // constructNextTickFn reports its cleared exception via reportUncaughtExceptionAtEventLoop,
      // which itself re-enters JS to invoke the uncaughtException listener above. Leave a handful
      // of frames between the stack limit and the first Worker attempt so that re-entry does not
      // trip the is_handling_uncaught_exception guard and exit(7), while remaining close enough
      // that the nextTick initializer's module load still overflows.
      const MIN_UNWOUND_FRAMES = 30;

      let depth = 0, maxDepth = 0, done = false;
      function attemptWorker() {
        try {
          const w = new Worker(workerPath);
          w.terminate();
          return true;
        } catch (e) {
          if (e instanceof RangeError) return false;
          return true;
        }
      }
      function dive() {
        depth++;
        try { dive(); } catch { maxDepth = depth; }
        if (!done && maxDepth - depth >= MIN_UNWOUND_FRAMES) done = attemptWorker();
        depth--;
      }
      dive();

      // With a healthy stack, constructing a Worker must succeed again: queueNextTick
      // re-runs constructNextTickFn, populating m_nextTickFunction and putDirect-ing
      // the function over the stale undefined slot.
      const before = typeof process.nextTick;
      const w = new Worker(workerPath);
      w.onmessage = () => {
        console.log("WORKER_OK before=" + before + " after=" + typeof process.nextTick);
        w.terminate();
        process.exit(0);
      };
      w.onerror = e => {
        console.error("WORKER_ERROR", e.message);
        process.exit(1);
      };
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(stdout).toContain("WORKER_OK");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});
