//#FILE: test-worker-message-port-wasm-module.js
//#SHA1: 9054704d555ed7efe67d4bd04cc404b4f229a2ad
//-----------------
"use strict";
const fixtures = require("../common/fixtures");
const { Worker } = require("worker_threads");

const wasmModule = new WebAssembly.Module(fixtures.readSync("simple.wasm"));

test("Worker can receive and execute WebAssembly module", done => {
  const worker = new Worker(
    `
  const { parentPort } = require('worker_threads');
  parentPort.once('message', ({ wasmModule }) => {
    const instance = new WebAssembly.Instance(wasmModule);
    parentPort.postMessage(instance.exports.add(10, 20));
  });
  `,
    { eval: true },
  );

  worker.once("message", num => {
    expect(num).toBe(30);
    done();
  });

  worker.postMessage({ wasmModule });
});

//<#END_FILE: test-worker-message-port-wasm-module.js
