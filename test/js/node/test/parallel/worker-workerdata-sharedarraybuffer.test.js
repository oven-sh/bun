//#FILE: test-worker-workerdata-sharedarraybuffer.js
//#SHA1: 2737167494699dbfe6986e4b879ecdeafd31a8a8
//-----------------
// Flags: --expose-gc
"use strict";

const { Worker } = require("worker_threads");

test("SharedArrayBuffer can be passed via workerData and modified", async () => {
  const sharedArrayBuffer = new SharedArrayBuffer(12);
  const local = Buffer.from(sharedArrayBuffer);

  const w = new Worker(
    `
    const { parentPort, workerData } = require('worker_threads');
    const local = Buffer.from(workerData.sharedArrayBuffer);

    parentPort.on('message', () => {
      local.write('world!', 6);
      parentPort.postMessage('written!');
    });
  `,
    {
      eval: true,
      workerData: { sharedArrayBuffer },
    },
  );

  const messagePromise = new Promise(resolve => {
    w.on("message", resolve);
  });

  w.postMessage({});
  // This would be a race condition if the memory regions were overlapping
  local.write("Hello ");

  await messagePromise;

  expect(local.toString()).toBe("Hello world!");

  global.gc();
  await w.terminate();
});

//<#END_FILE: test-worker-workerdata-sharedarraybuffer.js
