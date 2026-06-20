import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import wt, { Worker } from "worker_threads";

// https://github.com/oven-sh/bun/issues/32532
describe("isInternalThread", () => {
  test("is exported as false on the module object", () => {
    expect(wt).toHaveProperty("isInternalThread");
    expect(wt.isInternalThread).toBe(false);
  });

  test("named import resolves to false", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "import { isInternalThread } from 'node:worker_threads'; console.log(isInternalThread);"],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "false", stderr: "", exitCode: 0 });
  });

  test("require exposes isInternalThread as false", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        "const wt = require('node:worker_threads'); console.log(wt.isInternalThread, typeof wt.isInternalThread);",
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "false boolean", stderr: "", exitCode: 0 });
  });

  test("is false inside a user worker", async () => {
    const worker = new Worker(
      `const { parentPort, isInternalThread } = require("node:worker_threads"); parentPort.postMessage(isInternalThread);`,
      { eval: true },
    );
    try {
      const result = await new Promise<boolean>((resolve, reject) => {
        worker.once("message", value => resolve(value as boolean));
        worker.once("error", reject);
        worker.once("exit", code => reject(new Error(`worker exited before posting a message (code ${code})`)));
      });
      expect(result).toBe(false);
    } finally {
      await worker.terminate();
    }
  });
});
