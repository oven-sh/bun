import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("worker receives messages during top-level await", async () => {
  using dir = tempDir("issue-21101", {
    "main.js": `
      import { Worker } from "node:worker_threads";

      const worker = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });

      worker.on("message", (msg) => {
        console.log(msg);
        if (msg === "done") {
          clearInterval(interval);
          worker.terminate();
          process.exit(0);
        }
      });

      let count = 0;
      const interval = setInterval(() => {
        worker.postMessage("ping");
        count++;
        if (count >= 5) {
          clearInterval(interval);
          // If we sent 5 messages and never got "done", the bug is present.
          setTimeout(() => process.exit(1), 2000);
        }
      }, 500);
    `,
    "worker.js": `
      import { parentPort } from "node:worker_threads";

      let received = 0;
      parentPort.on("message", (msg) => {
        received++;
        if (received === 3) {
          parentPort.postMessage("done");
        }
      });

      // Top-level await that never resolves — messages should still
      // be delivered while this is pending.
      await new Promise(() => {});
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

  // The worker received at least 3 messages during TLA and sent "done"
  expect(stdout.trim()).toBe("done");
  expect(exitCode).toBe(0);
});

test("worker receives messages during finite top-level await", async () => {
  using dir = tempDir("issue-21101-finite", {
    "main.js": `
      import { Worker } from "node:worker_threads";

      const worker = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });

      let count = 0;
      const interval = setInterval(() => {
        worker.postMessage("hello");
        count++;
        if (count >= 10) clearInterval(interval);
      }, 100);

      worker.on("exit", () => {
        process.exit(0);
      });
    `,
    "worker.js": `
      import { parentPort } from "node:worker_threads";

      const received = [];
      parentPort.on("message", (msg) => {
        received.push(msg);
      });

      // TLA that resolves after 2s — messages sent during
      // the await should be delivered in real time, not queued.
      await new Promise((resolve) => setTimeout(resolve, 2000));

      console.log("count:" + received.length);
      process.exit(0);
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

  // The worker should have received messages DURING the await
  const countLine = stdout
    .trim()
    .split("\n")
    .find((l: string) => l.startsWith("count:"));
  expect(countLine).toBeDefined();
  const count = parseInt(countLine!.split(":")[1]);
  expect(count).toBeGreaterThanOrEqual(1);
  expect(exitCode).toBe(0);
});
