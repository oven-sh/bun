//#FILE: test-worker-cjs-workerdata.js
//#SHA1: 8e5d70084de66c757d227df54612de48d1048ad3
//-----------------
"use strict";
const fixtures = require("../common/fixtures");
const { Worker } = require("worker_threads");

const workerData = "Hello from main thread";

test("Worker with CJS module and workerData", done => {
  const worker = new Worker(fixtures.path("worker-data.cjs"), {
    workerData,
  });

  worker.on("message", message => {
    expect(message).toBe(workerData);
    done();
  });
});

//<#END_FILE: test-worker-cjs-workerdata.js
