import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/40268
// happy-dom's GlobalRegistrator replaces globalThis.MessagePort with its own
// EventTarget subclass before node:worker_threads loads; `new Worker()` then
// threw "port.on is not a function".
test("new Worker works after globalThis.MessagePort is replaced", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `globalThis.MessagePort = class MessagePort extends EventTarget {};
      const { Worker } = require("node:worker_threads");
      const worker = new Worker("require('node:worker_threads').parentPort.postMessage('hi')", { eval: true });
      worker.on("message", message => {
        console.log(message);
        worker.terminate();
      });`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("hi\n");
  expect(exitCode).toBe(0);
});
