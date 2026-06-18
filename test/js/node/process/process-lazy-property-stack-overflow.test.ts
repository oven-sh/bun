import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The Worker constructor queues the process 'worker' event via Process::queueNextTick, which
// reifies process.nextTick from C++ (JSObject::get). If that first use happens while the stack
// is nearly exhausted, the lazy PropertyCallback initializer clears the stack-overflow exception
// and returns undefined, leaving the property reified as undefined and m_nextTickFunction unset,
// so every later internal nextTick user (Worker construction, emitWarning, ...) kept failing with
// "Failed to call nextTick". queueNextTick now retries the initialization once the stack is
// healthy again and repairs the JS-visible slot.
test("first use of process.nextTick during stack exhaustion does not break Worker construction", async () => {
  using dir = tempDir("nexttick-stack-exhaustion", {
    "worker.js": `postMessage("ready");`,
    "main.js": `
      process.on("uncaughtException", () => {});
      const workerPath = new URL("./worker.js", import.meta.url).href;
      const MIN_UNWOUND_FRAMES = parseInt(process.argv[2]);

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

  // constructNextTickFn reports its cleared exception via reportUncaughtExceptionAtEventLoop,
  // which itself re-enters JS to invoke the uncaughtException listener. Too close to the stack
  // limit and that re-entry trips the is_handling_uncaught_exception guard and exits 7; too far
  // and the initializer succeeds without exercising the retry path. The exact frame count for
  // each threshold varies with build profile, platform and stack size, so probe upward until
  // the child survives.
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | number | null = null;
  for (let unwound = 20; unwound <= 400; unwound += 20) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js", String(unwound)],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    signalCode = proc.signalCode;
    if (exitCode === 0 && stdout.includes("WORKER_OK")) break;
    // Exit code 7 (or non-zero with the RangeError on stderr) means the child died inside
    // reportUncaughtExceptionAtEventLoop before reaching the healthy-stack Worker; give it
    // more headroom and try again.
    if (exitCode === 0) break;
  }

  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(stdout).toContain("WORKER_OK");
  expect(signalCode).toBeNull();
  expect(exitCode).toBe(0);
});
