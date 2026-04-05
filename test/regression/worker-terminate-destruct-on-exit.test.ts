import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// With BUN_DESTRUCT_VM_ON_EXIT=1, process.exit() from inside a JS callback runs
// VirtualMachine.deinit() on the main thread while worker threads may still be
// dispatching their close event (WebWorker__dispatchExit -> postTaskTo(parent)),
// tripping the "enqueueTaskConcurrent: VM has terminated" assertion.
test("process.exit from JS with BUN_DESTRUCT_VM_ON_EXIT=1 while worker is terminating", async () => {
  using dir = tempDir("worker-destruct-on-exit", {
    "worker.ts": `
      self.postMessage("fired");
      setInterval(() => {}, 100000);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const w = new Worker("./worker.ts");
      w.onmessage = () => {
        w.terminate();
        Bun.gc(true);
        console.log("ok");
        process.exit(0);
      };
    `,
    ],
    env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
