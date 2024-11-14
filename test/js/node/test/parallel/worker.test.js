//#FILE: test-worker.js
//#SHA1: 830c4e2ce132228fe7d49fd760271deed934db23
//-----------------
"use strict";

const { Worker, isMainThread, parentPort } = require("worker_threads");

const kTestString = "Hello, world!";

if (isMainThread) {
  test("Worker thread communication", done => {
    const w = new Worker(__filename);
    w.on("message", message => {
      expect(message).toBe(kTestString);
      done();
    });
  });
} else {
  setImmediate(() => {
    process.nextTick(() => {
      parentPort.postMessage(kTestString);
    });
  });
}

//<#END_FILE: test-worker.js
