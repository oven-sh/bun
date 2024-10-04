//#FILE: test-worker-relative-path-double-dot.js
//#SHA1: 2b605c02bfb9cfc2d42533a6a184dfdbd5a6e5b7
//-----------------
"use strict";
const path = require("path");
const { Worker, isMainThread, parentPort } = require("worker_threads");

if (isMainThread) {
  test("Worker with relative path using double dot", done => {
    const cwdName = path.relative("../", ".");
    const relativePath = path.relative(".", __filename);
    const w = new Worker(path.join("..", cwdName, relativePath));

    w.on("message", message => {
      expect(message).toBe("Hello, world!");
      done();
    });
  });
} else {
  parentPort.postMessage("Hello, world!");
}

//<#END_FILE: test-worker-relative-path-double-dot.js
