import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/12614
test("worker.terminate() promise keeps event loop alive", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { Worker } = require('node:worker_threads');
      const worker = new Worker('setInterval(() => {}, 50)', { eval: true });
      setTimeout(async () => {
        const code = await worker.terminate();
        console.log('terminated:' + code);
      }, 100).unref();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("terminated:");
  expect(exitCode).toBe(0);
});
