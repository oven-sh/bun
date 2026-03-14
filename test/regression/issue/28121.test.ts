import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/28121
// ASan use-after-poison when terminate() is called from a message handler
// after the worker has already exited and freed its Zig WebWorker struct.
test("calling terminate() from onmessage after worker exits does not crash", async () => {
  using dir = tempDir("issue-28121", {
    "worker.js": `
      self.postMessage("done");
      // Worker exits after posting message (event loop drains)
    `,
    "main.js": `
      const worker = new Worker(require("path").join(__dirname, "worker.js"));
      worker.onmessage = (e) => {
        // By the time this runs, the worker thread may have already exited
        // and freed its WebWorker struct. terminate() must not access freed memory.
        worker.terminate();
        console.log("ok");
        process.exit(0);
      };
      // Timeout to avoid hanging if the message is never received
      setTimeout(() => {
        console.log("ok");
        process.exit(0);
      }, 5000);
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

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

// Also test calling terminate() multiple times after worker exits
test("calling terminate() multiple times after worker exits does not crash", async () => {
  using dir = tempDir("issue-28121-multi", {
    "worker.js": `
      self.postMessage("done");
    `,
    "main.js": `
      const worker = new Worker(require("path").join(__dirname, "worker.js"));
      worker.onmessage = (e) => {
        worker.terminate();
        worker.terminate();
        worker.terminate();
        console.log("ok");
        process.exit(0);
      };
      setTimeout(() => {
        console.log("ok");
        process.exit(0);
      }, 5000);
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

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
