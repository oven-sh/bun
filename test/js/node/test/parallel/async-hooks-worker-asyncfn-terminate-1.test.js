//#FILE: test-async-hooks-worker-asyncfn-terminate-1.js
//#SHA1: 556f29e8c45107ff3448d713145f6f4e070e8073
//-----------------
"use strict";

const { Worker } = require("worker_threads");

test("Worker with async function and async_hooks terminates correctly", () => {
  const w = new Worker(
    `
  const { createHook } = require('async_hooks');

  setImmediate(async () => {
    createHook({ init() {} }).enable();
    await 0;
    process.exit();
  });
  `,
    { eval: true },
  );

  return new Promise(resolve => {
    w.on("exit", () => {
      expect(true).toBe(true); // Ensures the 'exit' event was called
      resolve();
    });
  });
});

//<#END_FILE: test-async-hooks-worker-asyncfn-terminate-1.js
