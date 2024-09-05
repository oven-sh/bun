//#FILE: test-worker-cleanexit-with-js.js
//#SHA1: f47fd2ea6e4a0adf79207268baf613eb071e493a
//-----------------
"use strict";

// Harden the thread interactions on the exit path.
// Ensure workers are able to bail out safe at
// arbitrary execution points. By running a lot of
// JS code in a tight loop, the expectation
// is that those will be at various control flow points
// preferably in the JS land.

const { Worker } = require("worker_threads");

test("Workers can bail out safely at arbitrary execution points", done => {
  const code =
    "setInterval(() => {" +
    "require('v8').deserialize(require('v8').serialize({ foo: 'bar' }));" +
    "require('vm').runInThisContext('x = \"foo\";');" +
    "eval('const y = \"vm\";');}, 10);";

  for (let i = 0; i < 9; i++) {
    new Worker(code, { eval: true });
  }

  const lastWorker = new Worker(code, { eval: true });
  lastWorker.on("online", () => {
    expect(true).toBe(true); // Ensure the worker came online
    process.exit(0);
    done();
  });
});

//<#END_FILE: test-worker-cleanexit-with-js.js
