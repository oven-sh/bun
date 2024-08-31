//#FILE: test-worker-relative-path.js
//#SHA1: 2d69899e96eee7500da11857679bf9f2ec18c259
//-----------------
"use strict";
const path = require("path");
const { Worker, isMainThread, parentPort } = require("worker_threads");

if (isMainThread) {
  test("Worker can be started with a relative path", done => {
    const w = new Worker(`./${path.relative(".", __filename)}`);
    w.on("message", message => {
      expect(message).toBe("Hello, world!");
      done();
    });
  });
} else {
  parentPort.postMessage("Hello, world!");
}

//<#END_FILE: test-worker-relative-path.js
