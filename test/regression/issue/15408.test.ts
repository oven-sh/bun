import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/15408
// parentPort.on("message") never fires when the worker module uses top-level await.
test("parentPort.on('message') works with top-level await in worker", async () => {
  using dir = tempDir("issue-15408", {
    "main.js": `
      import { Worker } from "node:worker_threads";
      const worker = new Worker("./worker.js", {});
      worker.postMessage("hello");
      worker.on("message", (msg) => {
        console.log(msg);
        worker.terminate();
      });
    `,
    "worker.js": `
      import { parentPort } from "node:worker_threads";

      parentPort.on("message", (msg) => {
        parentPort.postMessage("received message");
      });

      // Top-level await - the worker should still receive messages
      // while this TLA is pending.
      while (true) {
        await new Promise((r) => setImmediate(r));
      }
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

  expect(stdout.trim()).toBe("received message");
  expect(exitCode).toBe(0);
});
