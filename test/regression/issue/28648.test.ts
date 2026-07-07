// https://github.com/oven-sh/bun/issues/28648
// https://github.com/oven-sh/bun/issues/24069
//
// A nested uncaught exception inside a worker (while the first is still being
// reported to the parent) used to abort the whole process with
// `panic: Uncaught exception while handling uncaught exception` because the
// re-entry guard in `VirtualMachine::uncaught_exception` assumed `process_exit`
// never returns, which is only true on the main thread. On a worker it returns
// after arming termination, so the guard must return instead of panicking.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.concurrent("nested uncaught exceptions in a worker don't abort the process", () => {
  async function run(workerBody: string) {
    const script = /* js */ `
      const { Worker } = require("node:worker_threads");
      new Worker(${JSON.stringify(workerBody)}, { eval: true })
        .on("error", () => console.log("worker-error"))
        .on("exit", c => console.log("worker-exit:" + c));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  // The parent Worker must receive `error` then `exit:1` (Node's behaviour),
  // and the process must not crash.
  const expected = {
    stdout: "worker-error\nworker-exit:1\n",
    stderr: expect.any(String),
    exitCode: 0,
    signalCode: null,
  };

  test("queueMicrotask throws while a setTimeout throw is being handled", async () => {
    expect(await run(`setTimeout(() => { queueMicrotask(() => { throw 1 }); throw 2 }, 0)`)).toEqual(expected);
  });

  test("two throwing queueMicrotask callbacks", async () => {
    expect(await run(`queueMicrotask(() => { throw 1 }); queueMicrotask(() => { throw 2 })`)).toEqual(expected);
  });

  test("worker beforeExit handler throws", async () => {
    expect(await run(`process.on("beforeExit", () => { throw 99 })`)).toEqual(expected);
  });

  test("worker uncaughtException handler throws", async () => {
    expect(
      await run(`process.on("uncaughtException", () => { throw new Error("nested") }); throw new Error("oopsie")`),
    ).toEqual(expected);
  });
});
