import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("Worker async onmessage throw does not SIGABRT", async () => {
  using dir = tempDir("issue-28753", {
    "worker.ts": `
      declare var self: Worker;
      self.onmessage = async (event: MessageEvent) => {
        throw new Error("test error from async handler");
      };
    `,
    "main.ts": `
      setTimeout(() => { process.exit(1); }, 5000);
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      worker.addEventListener("open", () => { worker.postMessage("go"); });
      worker.addEventListener("error", (e) => {
        console.log("error event received");
      });
      worker.addEventListener("close", () => {
        console.log("close event received");
        setTimeout(() => process.exit(0), 500);
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

test.concurrent("Worker async onmessage rejection does not SIGABRT", async () => {
  using dir = tempDir("issue-28753-reject", {
    "worker.ts": `
      declare var self: Worker;
      self.onmessage = async (event: MessageEvent) => {
        await Promise.reject(new Error("rejected promise in worker"));
      };
    `,
    "main.ts": `
      setTimeout(() => { process.exit(1); }, 5000);
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      worker.addEventListener("open", () => { worker.postMessage("go"); });
      worker.addEventListener("error", (e) => {
        console.log("error event received");
      });
      worker.addEventListener("close", () => {
        console.log("close event received");
        setTimeout(() => process.exit(0), 500);
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
