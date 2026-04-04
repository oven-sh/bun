import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/12616
test("Worker#terminate interrupts infinite loops", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { Worker } = require("node:worker_threads");
      const worker = new Worker("for(;;){}", { eval: true });
      const timer = setInterval(() => {}, 10_000);
      setTimeout(async () => {
        await worker.terminate();
        clearInterval(timer);
        console.log("terminated");
      }, 500);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("terminated");
  expect(exitCode).toBe(0);
}, 10_000);
