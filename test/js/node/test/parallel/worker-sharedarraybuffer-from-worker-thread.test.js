//#FILE: test-worker-sharedarraybuffer-from-worker-thread.js
//#SHA1: a33c9c03494dc79f7dd926382125f034d8ae4bbc
//-----------------
// Flags: --debug-arraybuffer-allocations
"use strict";

// Regression test for https://github.com/nodejs/node/issues/28777
// Make sure that SharedArrayBuffers and transferred ArrayBuffers created in
// Worker threads are accessible after the creating thread ended.

const { Worker } = require("worker_threads");

["ArrayBuffer", "SharedArrayBuffer"].forEach(ctor => {
  test(`${ctor} from worker thread`, async () => {
    const w = new Worker(
      `
    const { parentPort } = require('worker_threads');
    const arrayBuffer = new ${ctor}(4);
    parentPort.postMessage(
      arrayBuffer,
      '${ctor}' === 'SharedArrayBuffer' ? [] : [arrayBuffer]);
    `,
      { eval: true },
    );

    let arrayBuffer;
    await new Promise(resolve => {
      w.once("message", message => {
        arrayBuffer = message;
        resolve();
      });
    });

    await new Promise(resolve => {
      w.once("exit", () => {
        expect(arrayBuffer.constructor.name).toBe(ctor);
        const uint8array = new Uint8Array(arrayBuffer);
        uint8array[0] = 42;
        expect(uint8array).toEqual(new Uint8Array([42, 0, 0, 0]));
        resolve();
      });
    });
  });
});

//<#END_FILE: test-worker-sharedarraybuffer-from-worker-thread.js
