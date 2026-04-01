import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Worker async onmessage throw does not SIGABRT", async () => {
  using dir = tempDir("issue-28753", {
    "worker.ts": `
      declare var self: Worker;
      self.onmessage = async (event: MessageEvent) => {
        throw new Error("test error from async handler");
      };
    `,
    "main.ts": `
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      worker.addEventListener("open", () => { worker.postMessage("go"); });
      worker.addEventListener("error", (e) => {
        console.log("error event received");
        setTimeout(() => process.exit(0), 500);
      });
      setTimeout(() => {
        console.log("timeout - no error event");
        process.exit(1);
      }, 5000);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("error event received");
  expect(exitCode).toBe(0);
});

test("Worker async onmessage rejection does not SIGABRT", async () => {
  using dir = tempDir("issue-28753-reject", {
    "worker.ts": `
      declare var self: Worker;
      self.onmessage = async (event: MessageEvent) => {
        await Promise.reject(new Error("rejected promise in worker"));
      };
    `,
    "main.ts": `
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      worker.addEventListener("open", () => { worker.postMessage("go"); });
      worker.addEventListener("error", (e) => {
        console.log("error event received");
        setTimeout(() => process.exit(0), 500);
      });
      setTimeout(() => {
        console.log("timeout - no error event");
        process.exit(1);
      }, 5000);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("error event received");
  expect(exitCode).toBe(0);
});
