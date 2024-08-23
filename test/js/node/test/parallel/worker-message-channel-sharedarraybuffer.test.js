//#FILE: test-worker-message-channel-sharedarraybuffer.js
//#SHA1: 567096de16f1ea1b7a50e53cbdbd47b531af0e2a
//-----------------
// Flags: --expose-gc
"use strict";

const { Worker } = require("worker_threads");

test("SharedArrayBuffer can be shared between main thread and worker", async () => {
  const sharedArrayBuffer = new SharedArrayBuffer(12);
  const local = Buffer.from(sharedArrayBuffer);

  const w = new Worker(
    `
    const { parentPort } = require('worker_threads');
    parentPort.on('message', ({ sharedArrayBuffer }) => {
      const local = Buffer.from(sharedArrayBuffer);
      local.write('world!', 6);
      parentPort.postMessage('written!');
    });
  `,
    { eval: true },
  );

  const messagePromise = new Promise(resolve => {
    w.on("message", resolve);
  });

  w.postMessage({ sharedArrayBuffer });
  // This would be a race condition if the memory regions were overlapping
  local.write("Hello ");

  await messagePromise;

  expect(local.toString()).toBe("Hello world!");

  global.gc();
  await w.terminate();
});

//<#END_FILE: test-worker-message-channel-sharedarraybuffer.js
