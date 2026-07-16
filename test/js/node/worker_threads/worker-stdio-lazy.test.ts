import { expect, test } from "bun:test";
import { once } from "node:events";
import { Worker } from "node:worker_threads";

// Regression: the stdio rebind used to run eagerly in every worker's preload,
// cold-loading node:stream + Console and reifying the process static table on
// every spawn even when the worker never touched stdio.
test("worker process.stdio and console are installed as lazy accessors", async () => {
  const worker = new Worker(
    `
    const { parentPort } = require("worker_threads");
    const d = (obj, k) => {
      const desc = Object.getOwnPropertyDescriptor(obj, k);
      return desc ? (desc.get ? "accessor" : "value") : "none";
    };
    const before = {
      stdout: d(process, "stdout"),
      stderr: d(process, "stderr"),
      stdin: d(process, "stdin"),
      console: d(globalThis, "console"),
    };
    // first read materializes the stream; second read must be the same object
    const s1 = process.stdout;
    const s2 = process.stdout;
    parentPort.postMessage({
      before,
      afterStdout: d(process, "stdout"),
      sameInstance: s1 === s2,
      isWritable: typeof s1.write === "function",
    });
    `,
    { eval: true },
  );
  const [msg] = await once(worker, "message");
  expect(msg).toEqual({
    before: { stdout: "accessor", stderr: "accessor", stdin: "accessor", console: "accessor" },
    afterStdout: "value",
    sameInstance: true,
    isWritable: true,
  });
  await worker.terminate();
});

// node:console is `export default globalThis.console`; evaluating it after the
// lazy getter is installed would cache a plain Console instance that lacks
// .Console/.write, so the preload primes the module registry first.
test("require('node:console') in a worker still exposes Console and write", async () => {
  const worker = new Worker(
    `
    const { parentPort } = require("worker_threads");
    const c = require("node:console");
    parentPort.postMessage({
      hasConsoleCtor: typeof c.Console === "function",
      hasWrite: typeof c.write === "function",
      hasAsyncIterator: typeof c[Symbol.asyncIterator] === "function",
    });
    `,
    { eval: true },
  );
  const [msg] = await once(worker, "message");
  expect(msg).toEqual({ hasConsoleCtor: true, hasWrite: true, hasAsyncIterator: true });
  await worker.terminate();
});
