//#FILE: test-async-hooks-worker-asyncfn-terminate-3.js
//#SHA1: bd68d52f5ecd5cb22738f78ee855706ed424cbf0
//-----------------
"use strict";

const { Worker } = require("worker_threads");

// Like test-async-hooks-worker-promise.js but with an additional statement
// after the `process.exit()` call, that shouldn't really make a difference
// but apparently does.

test("Worker with async function and process.exit()", done => {
  const w = new Worker(
    `
  const { createHook } = require('async_hooks');

  setImmediate(async () => {
    createHook({ init() {} }).enable();
    await 0;
    process.exit();
    process._rawDebug('THIS SHOULD NEVER BE REACHED');
  });
  `,
    { eval: true },
  );

  w.on("exit", () => {
    expect(true).toBe(true); // Ensure the exit event is called
    done();
  });
});

//<#END_FILE: test-async-hooks-worker-asyncfn-terminate-3.js
