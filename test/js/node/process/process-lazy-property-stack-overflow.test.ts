import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Lazy PropertyCallback initializers on the process object (nextTick, mainModule,
// channel, stdin/stdout/stderr, ...) call into JavaScript during reification. If
// that JS call throws (e.g. RangeError from stack exhaustion), JSC's
// setUpStaticFunctionSlot would still putDirect the bogus result and report the
// slot as found with the exception still pending, triggering
// EXCEPTION_ASSERT(!scope.exception() || !hasSlot) in JSValue::get. The
// initializers now clear the exception and return undefined, so the property
// read does not throw and the slot is reified as undefined instead of the
// Exception cell.
test("accessing lazy process properties near stack limit does not crash", async () => {
  const src = `
    function recurse() {
      try { recurse(); } catch {}
      try { process.nextTick; } catch {}
      try { process.mainModule; } catch {}
    }
    recurse();
    // process.nextTick may have been reified as undefined if its initializer
    // threw near the stack limit; use Bun.write directly for output.
    Bun.write(Bun.stdout, "type=" + typeof process.nextTick + "\\n");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toMatch(/^type=(undefined|function)\n$/);
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// The Worker constructor queues the process 'worker' event via Process::queueNextTick, which
// reifies process.nextTick from C++ (JSObject::get). If that first use happens while the stack is
// nearly exhausted, the initialization used to leave a pending stack overflow exception behind
// (asserting in debug builds) and cache a bogus nextTick function, permanently breaking every
// later Worker construction with "Failed to call nextTick". queueNextTick now retries the
// initialization once the stack is healthy again.
test("first use of process.nextTick during stack exhaustion does not break Worker construction", async () => {
  using dir = tempDir("nexttick-stack-exhaustion", {
    "worker.js": `postMessage("ready");`,
    "main.js": `
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

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("WORKER_OK");
  expect(exitCode).toBe(0);
});
