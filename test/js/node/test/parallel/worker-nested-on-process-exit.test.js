//#FILE: test-worker-nested-on-process-exit.js
//#SHA1: a76202f79766e7ca3f39552cc00b4f31e8f38a56
//-----------------
"use strict";
const { Worker, workerData } = require("worker_threads");

// Test that 'exit' events for nested Workers are not received when a Worker
// terminates itself through process.exit().

if (workerData === null) {
  test("nested worker exit events", () => {
    const nestedWorkerExitCounter = new Int32Array(new SharedArrayBuffer(4));
    const w = new Worker(__filename, { workerData: nestedWorkerExitCounter });

    return new Promise(resolve => {
      w.on("exit", () => {
        expect(nestedWorkerExitCounter[0]).toBe(0);
        resolve();
      });
    });
  });
} else {
  const nestedWorker = new Worker("setInterval(() => {}, 100)", { eval: true });
  // The counter should never be increased here.
  nestedWorker.on("exit", () => workerData[0]++);
  nestedWorker.on("online", () => process.exit());
}

//<#END_FILE: test-worker-nested-on-process-exit.js
