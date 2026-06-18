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

      let done = false;
      function attemptWorker() {
        try {
          const w = new Worker(workerPath);
          w.terminate();
          return true;
        } catch (e) {
          // Out of stack; retry in a shallower frame.
          if (e instanceof RangeError) return false;
          return true;
        }
      }

      function dive() {
        try {
          dive();
        } catch {}
        if (!done) done = attemptWorker();
      }
      dive();

      // With a healthy stack, constructing a Worker must succeed again.
      const w = new Worker(workerPath);
      w.onmessage = () => {
        console.log("WORKER_OK");
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
  expect(exitCode).toBe(0);
});
