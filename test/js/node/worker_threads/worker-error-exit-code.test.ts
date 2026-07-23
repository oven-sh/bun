import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Spawned: isBunTest short-circuits VirtualMachine::unhandled_rejection so the
// in-process path is not the one users observe.
async function run(workerSrc: string, expected: { err: string | null; code: number }) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Worker } = require("node:worker_threads");
       const w = new Worker(${JSON.stringify(workerSrc)}, { eval: true });
       let err = null;
       w.on("error", e => { err = e?.name + ": " + e?.message; });
       w.on("exit", code => { console.log(JSON.stringify({ err, code })); });
       w.postMessage("go");`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
    stdout: JSON.stringify(expected),
    stderr: "",
    exitCode: 0,
  });
}

describe.concurrent("exit code when a worker dies from an error", () => {
  test("unhandled promise rejection exits 1", async () => {
    await run(
      `require("node:worker_threads").parentPort.on("message", () => { Promise.reject(new Error("task-reject")); });`,
      { err: "Error: task-reject", code: 1 },
    );
  });

  test("synchronous throw exits 1", async () => {
    await run(`require("node:worker_threads").parentPort.on("message", () => { throw new Error("task-throw"); });`, {
      err: "Error: task-throw",
      code: 1,
    });
  });

  test("unhandled rejection runs the worker's process.on('exit') with code 1", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Worker } = require("node:worker_threads");
         const w = new Worker(
           'process.on("exit", c => require("node:worker_threads").parentPort.postMessage(c));' +
           'require("node:worker_threads").parentPort.on("message", () => { Promise.reject(new Error("r")); });',
           { eval: true },
         );
         let workerExitArg = null;
         w.on("error", () => {});
         w.on("message", c => { workerExitArg = c; });
         w.on("exit", code => { console.log(JSON.stringify({ workerExitArg, code })); });
         w.postMessage("go");`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ workerExitArg: 1, code: 1 }),
      stderr: "",
      exitCode: 0,
    });
  });

  test("process.on('unhandledRejection') handler suppresses the nonzero exit", async () => {
    await run(
      `const { parentPort } = require("node:worker_threads");
       process.on("unhandledRejection", () => parentPort.close());
       parentPort.once("message", () => { Promise.reject(new Error("handled")); });`,
      { err: null, code: 0 },
    );
  });
});
