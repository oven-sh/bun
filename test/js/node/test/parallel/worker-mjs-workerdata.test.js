//#FILE: test-worker-mjs-workerdata.js
//#SHA1: c4df37cd769b399dd8245d29bed7f385f1adb472
//-----------------
"use strict";

const fixtures = require("../common/fixtures");
const { Worker } = require("worker_threads");

const workerData = "Hello from main thread";

test("Worker with workerData in MJS", done => {
  const worker = new Worker(fixtures.path("worker-data.mjs"), {
    workerData,
  });

  worker.on("message", message => {
    expect(message).toBe(workerData);
    done();
  });
});

//<#END_FILE: test-worker-mjs-workerdata.js
