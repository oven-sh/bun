//#FILE: test-worker-ref-onexit.js
//#SHA1: b34eb5ff18bd889eb47cd37e696410f428b0b11b
//-----------------
"use strict";
const { Worker } = require("worker_threads");

// Check that worker.unref() makes the 'exit' event not be emitted, if it is
// the only thing we would otherwise be waiting for.

test("worker.unref() prevents exit event emission", done => {
  // Use `setInterval()` to make sure the worker is alive until the end of the
  // event loop turn.
  const w = new Worker("setInterval(() => {}, 100);", { eval: true });
  w.unref();

  const exitHandler = jest.fn();
  w.on("exit", exitHandler);

  // We need to use a timeout here to allow the event loop to complete
  // and ensure the exit event is not called
  setTimeout(() => {
    expect(exitHandler).not.toHaveBeenCalled();
    done();
  }, 500);
});

//<#END_FILE: test-worker-ref-onexit.js
