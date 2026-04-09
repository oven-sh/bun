import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/29077
// `worker.terminate()` must resolve its promise even when called immediately
// after construction. Prior to the fix, notifyNeedTermination unref'd the
// parent poll right away, so the parent event loop exited before the worker
// thread could dispatch its "close" event back to the parent, leaving the
// promise pending forever.

test("worker.terminate() .then() runs when called right after construction", async () => {
  using dir = tempDir("issue-29077", {
    "worker.mjs": `console.log("worker started");`,
    "main.mjs": `
      import { Worker } from "node:worker_threads";
      import * as path from "node:path";
      import { fileURLToPath } from "node:url";

      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const worker = new Worker(path.join(__dirname, "worker.mjs"));

      worker.terminate().then(code => {
        console.log("terminated:" + code);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("terminated:0");
  expect(exitCode).toBe(0);
});

test("worker.terminate() .then() runs when worker has a long-running task", async () => {
  using dir = tempDir("issue-29077-busy", {
    "worker.mjs": `setInterval(() => {}, 1000);`,
    "main.mjs": `
      import { Worker } from "node:worker_threads";
      import * as path from "node:path";
      import { fileURLToPath } from "node:url";

      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const worker = new Worker(path.join(__dirname, "worker.mjs"));

      worker.terminate().then(code => {
        console.log("terminated:" + code);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("terminated:0");
  expect(exitCode).toBe(0);
});

test("multiple worker.terminate() calls each resolve", async () => {
  using dir = tempDir("issue-29077-multi", {
    "worker.mjs": `console.log("worker started");`,
    "main.mjs": `
      import { Worker } from "node:worker_threads";
      import * as path from "node:path";
      import { fileURLToPath } from "node:url";

      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const worker = new Worker(path.join(__dirname, "worker.mjs"));

      const p1 = worker.terminate();
      const p2 = worker.terminate();

      let resolved = 0;
      p1.then(code => { resolved++; console.log("p1:" + code); });
      p2.then(code => { resolved++; console.log("p2:" + code); });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("p1:0");
  expect(stdout).toContain("p2:0");
  expect(exitCode).toBe(0);
});
