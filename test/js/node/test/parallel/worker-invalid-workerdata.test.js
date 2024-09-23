//#FILE: test-worker-invalid-workerdata.js
//#SHA1: 2e1989d95e34d3603c30290e012335261767ae90
//-----------------
"use strict";

const { Worker } = require("worker_threads");

// This tests verifies that failing to serialize workerData does not keep
// the process alive.
// Refs: https://github.com/nodejs/node/issues/22736

test("Worker creation with unserializable workerData throws DataCloneError", () => {
  expect(() => {
    new Worker("./worker.js", {
      workerData: { fn: () => {} },
    });
  }).toThrow(
    expect.objectContaining({
      name: "DataCloneError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-worker-invalid-workerdata.js
