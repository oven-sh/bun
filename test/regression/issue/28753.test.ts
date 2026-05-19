import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression for https://github.com/oven-sh/bun/issues/28753 — an async
// `onmessage` handler that throws (or returns a rejected promise) from a
// Worker used to SIGABRT (or segfault in release) during VM teardown because
// `onUnhandledRejection` called `shutdown()` while still inside the JS
// entryScope. The fix defers teardown to `spin()`'s tail via
// `setRequestedTerminate()` + `eventLoop().wakeup()`.
//
// The test asserts both events fire and the child exits cleanly. It does NOT
// call `process.exit()` in the event handlers — doing that races the worker
// thread's teardown and causes an unrelated segfault on the child process exit
// path. Letting the main thread go idle naturally after `close` (no pending
// timers, no refs) gives the worker thread time to finish its teardown before
// the process exits, which is what we want to verify.
test.concurrent.each([
  ["throw", `throw new Error("test error from async handler");`],
  ["rejection", `await Promise.reject(new Error("rejected promise in worker"));`],
])("Worker async onmessage %s does not SIGABRT", async (label, workerBody) => {
  using dir = tempDir(`issue-28753-${label}`, {
    "worker.ts": `
      declare var self: Worker;
      self.onmessage = async (event: MessageEvent) => {
        ${workerBody}
      };
    `,
    "main.ts": `
      // Watchdog: if close never arrives (regression in the dispatch path
      // itself), exit 1 so the outer test fails cleanly rather than hanging.
      // Cleared in the close handler so the process can exit naturally.
      const watchdog = setTimeout(() => { process.exit(1); }, 10_000);
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      worker.addEventListener("open", () => { worker.postMessage("go"); });
      worker.addEventListener("error", () => { console.log("error event received"); });
      worker.addEventListener("close", () => {
        clearTimeout(watchdog);
        console.log("close event received");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("error event received");
  expect(stdout).toContain("close event received");
  expect(exitCode).toBe(0);
});
