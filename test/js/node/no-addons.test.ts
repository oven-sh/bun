import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunExe, bunEnv as env } from "harness";

test("--no-addons stays in effect inside a Worker with an empty execArgv", async () => {
  const script = `
    const { Worker } = require("node:worker_threads");
    const source = \`
      const { parentPort } = require("node:worker_threads");
      try {
        process.dlopen();
        parentPort.postMessage("no-error");
      } catch (e) {
        parentPort.postMessage(e.code);
      }
    \`;
    const worker = new Worker(source, { eval: true, execArgv: [] });
    worker.on("message", msg => {
      console.log(msg);
      worker.terminate();
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-addons", "-e", script],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("ERR_DLOPEN_DISABLED");
  expect(exitCode).toBe(0);
});

test("--no-addons throws an error on process.dlopen", () => {
  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "--no-addons", "-p", "process.dlopen()"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const err = stderr.toString();
  const out = stdout.toString();
  expect(exitCode).toBe(1);
  expect(out).toBeEmpty();
  expect(err).toContain("\nerror: Cannot load native addon because loading addons is disabled.");
});
