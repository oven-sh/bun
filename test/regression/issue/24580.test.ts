import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/24580
// Segfault in notifyNeedTermination due to use-after-free when
// terminate() is called after worker has already exited.

test("calling terminate() from a message handler after worker posts and exits does not crash", async () => {
  using dir = tempDir("worker-uaf", {
    "worker.js": `
      postMessage("hello");
      postMessage("world");
      process.exit(0);
    `,
    "main.js": `
      const worker = new Worker(require("path").join(__dirname, "worker.js"));

      worker.onmessage = (e) => {
        // This may race with the worker's exit and call terminate()
        // on a freed WebWorker struct, triggering the original crash.
        worker.terminate();
      };

      worker.addEventListener("close", (e) => {
        console.log("close", e.code);
        process.exit(0);
      });

      setTimeout(() => {
        console.log("timeout");
        process.exit(1);
      }, 5000);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("close");
  expect(exitCode).toBe(0);
});

test("calling terminate() multiple times does not crash", async () => {
  using dir = tempDir("worker-multi-term", {
    "worker.js": `
      postMessage("ready");
      setTimeout(() => {}, 1000);
    `,
    "main.js": `
      const worker = new Worker(require("path").join(__dirname, "worker.js"));

      worker.onmessage = () => {
        // Call terminate() multiple times - should be idempotent
        worker.terminate();
        worker.terminate();
        worker.terminate();
      };

      worker.addEventListener("close", (e) => {
        console.log("close", e.code);
        process.exit(0);
      });

      setTimeout(() => {
        console.log("timeout");
        process.exit(1);
      }, 5000);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("close");
  expect(exitCode).toBe(0);
});
