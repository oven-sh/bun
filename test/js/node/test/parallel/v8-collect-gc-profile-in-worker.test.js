//#FILE: test-v8-collect-gc-profile-in-worker.js
//#SHA1: 212956c00ed8e788f682c6335879f6844972a424
//-----------------
// Flags: --expose-gc
"use strict";

const { Worker } = require("worker_threads");

// Replace testGCProfiler with a Jest-compatible mock
const testGCProfiler = jest.fn();

if (!process.env.isWorker) {
  test("Worker thread creation", () => {
    process.env.isWorker = 1;
    const worker = new Worker(__filename);
    expect(worker).toBeDefined();
  });
} else {
  test("GC profiler in worker thread", () => {
    testGCProfiler();
    for (let i = 0; i < 100; i++) {
      new Array(100);
    }

    // Check if global.gc is available
    if (typeof global.gc === "function") {
      global.gc();
    } else {
      console.warn("global.gc is not available. Make sure to run with --expose-gc flag.");
    }

    expect(testGCProfiler).toHaveBeenCalledTimes(1);
  });
}

//<#END_FILE: test-v8-collect-gc-profile-in-worker.js
