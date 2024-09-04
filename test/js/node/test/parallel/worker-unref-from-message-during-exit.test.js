//#FILE: test-worker-unref-from-message-during-exit.js
//#SHA1: 8555ad4d197dfc269beffcf6b2a3940df8a41659
//-----------------
"use strict";
const { Worker } = require("worker_threads");

// This used to crash because the `.unref()` was unexpected while the Worker
// was exiting.

test("Worker unref from message during exit", async () => {
  const w = new Worker(
    `
require('worker_threads').parentPort.postMessage({});
`,
    { eval: true },
  );

  const messagePromise = new Promise(resolve => {
    w.on("message", () => {
      w.unref();
      resolve();
    });
  });

  // Wait a bit so that the 'message' event is emitted while the Worker exits.
  await Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);

  await expect(messagePromise).resolves.toBeUndefined();
});

//<#END_FILE: test-worker-unref-from-message-during-exit.js
