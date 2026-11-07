// Python has started in the main program. Workers that never touch it are ended as ever, and so is what the main program runs in JS.
import { runInThisContext } from "node:vm";
import { isMainThread, parentPort, workerData } from "node:worker_threads";

const kinds: Record<string, () => void> = {
  "computes": () => {
    for (;;);
  },
  "is idle": () => void setInterval(() => {}, 1000),
  "is in Atomics.wait()": () => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0),
  "runs into one timeout after the other": () => {
    for (;;) {
      try {
        runInThisContext("for (;;);", { timeout: 1 });
      } catch {}
    }
  },
};

if (isMainThread) {
  const { sum } = require("python:builtins");
  const { Worker } = require("node:worker_threads");
  for (let round = 0; round < 3; ++round) {
    await Promise.all(
      Object.keys(kinds).map(async (kind, index) => {
        const worker = new Worker(import.meta.filename, { workerData: kind });
        const closed = new Promise(resolve => worker.once("exit", resolve));
        await new Promise(resolve => worker.once("message", resolve));
        // Not a wait for anything: so that it comes at one time and another.
        await new Promise(resolve => setTimeout(resolve, (round + index) % 4));
        worker.terminate();
        await closed;
      }),
    );
    let code;
    try {
      runInThisContext("for (;;);", { timeout: 2 });
    } catch (error: any) {
      code = error.code;
    }
    if (code !== "ERR_SCRIPT_EXECUTION_TIMEOUT" || sum([1, 2, 3]) !== 6) throw new Error(`${code}`);
  }
  console.log("survived");
} else {
  parentPort!.postMessage("at work");
  kinds[workerData]();
}
