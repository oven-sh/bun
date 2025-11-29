import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { Worker } from "node:worker_threads";

test("globalThis.onmessage should not prevent process exit", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", 'console.log("hello world"); globalThis.onmessage = () => {}'],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toBe("hello world\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("globalThis.onmessage can be set to a function", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      globalThis.onmessage = () => {
        console.log("message handler set");
      };
      console.log(typeof globalThis.onmessage);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toBe("function\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("globalThis.onmessage can be set to null", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      globalThis.onmessage = () => {};
      globalThis.onmessage = null;
      console.log(globalThis.onmessage);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toBe("null\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("Workers with onmessage should still work properly", async () => {
  using dir = tempDir("worker-onmessage-test", {
    "worker.js": `
      const { parentPort } = require("node:worker_threads");
      parentPort.onmessage = (event) => {
        parentPort.postMessage({ received: event.data });
      };
    `,
  });

  const worker = new Worker(String(dir) + "/worker.js");
  const { promise, resolve } = Promise.withResolvers();

  worker.on("message", (msg) => {
    resolve(msg);
  });

  worker.postMessage("hello");

  const result = await promise;
  expect(result).toEqual({ received: "hello" });

  await worker.terminate();
});
