//#FILE: test-worker-message-port-transfer-terminate.js
//#SHA1: ca776ac07835f8e6306ba671531b8e5a73e25f27
//-----------------
"use strict";

const { Worker, MessageChannel } = require("worker_threads");

// Check the interaction of calling .terminate() while transferring
// MessagePort objects; in particular, that it does not crash the process.

test("Worker termination while transferring MessagePort objects", done => {
  let completedIterations = 0;

  for (let i = 0; i < 10; ++i) {
    const w = new Worker("require('worker_threads').parentPort.on('message', () => {})", { eval: true });

    setImmediate(() => {
      const port = new MessageChannel().port1;
      w.postMessage({ port }, [port]);
      w.terminate().then(() => {
        completedIterations++;
        if (completedIterations === 10) {
          done();
        }
      });
    });
  }
});

//<#END_FILE: test-worker-message-port-transfer-terminate.js
