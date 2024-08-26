//#FILE: test-async-hooks-worker-asyncfn-terminate-2.js
//#SHA1: 2329c972e1256f3aadc37e92f0ff1219d8519328
//-----------------
"use strict";

const { Worker } = require("worker_threads");

// Like test-async-hooks-worker-promise.js but with the `await` and `createHook`
// lines switched, because that resulted in different assertion failures
// (one a Node.js assertion and one a V8 DCHECK) and it seems prudent to
// cover both of those failures.

test("Worker with async function and createHook", () => {
  const w = new Worker(
    `
  const { createHook } = require('async_hooks');

  setImmediate(async () => {
    await 0;
    createHook({ init() {} }).enable();
    process.exit();
  });
  `,
    { eval: true },
  );

  w.postMessage({});

  return new Promise(resolve => {
    w.on("exit", () => {
      expect(true).toBe(true); // Equivalent to common.mustCall()
      resolve();
    });
  });
});

//<#END_FILE: test-async-hooks-worker-asyncfn-terminate-2.js
