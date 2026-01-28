import { expect, test } from "bun:test";
import { Worker } from "worker_threads";

test("Worker implements Symbol.asyncDispose", async () => {
  const worker = new Worker(
    `
    const { parentPort } = require("worker_threads");
    parentPort?.postMessage("ready");
  `,
    { eval: true },
  );

  // Wait for the worker to be ready
  await new Promise(resolve => {
    worker.on("message", msg => {
      if (msg === "ready") {
        resolve(msg);
      }
    });
  });

  // Test that Symbol.asyncDispose exists and is a function
  expect(typeof worker[Symbol.asyncDispose]).toBe("function");

  // Test that calling Symbol.asyncDispose terminates the worker
  const disposeResult = await worker[Symbol.asyncDispose]();
  expect(disposeResult).toBeUndefined();
});

test("Worker can be used with await using", async () => {
  let workerTerminated = false;

  {
    await using worker = new Worker(
      `
      const { parentPort } = require("worker_threads");
      parentPort?.postMessage("hello from worker");
    `,
      { eval: true },
    );

    // Listen for worker exit to confirm termination
    worker.on("exit", () => {
      workerTerminated = true;
    });

    // Wait for the worker message to ensure it's running
    await new Promise(resolve => {
      worker.on("message", resolve);
    });

    // Worker should automatically terminate when leaving this block via Symbol.asyncDispose
  }

  // Give a moment for the exit event to be emitted
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(workerTerminated).toBe(true);
});
