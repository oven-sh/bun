//#FILE: test-worker-dns-terminate.js
//#SHA1: 08606489fda1e39fd269b7e31f571080f8ceba91
//-----------------
"use strict";

const { Worker } = require("worker_threads");

test("Worker DNS terminate should not crash during a DNS request", () => {
  const w = new Worker(
    `
const dns = require('dns');
dns.lookup('nonexistent.org', () => {});
require('worker_threads').parentPort.postMessage('0');
`,
    { eval: true },
  );

  return new Promise(resolve => {
    const messageHandler = jest.fn(() => {
      // This should not crash the worker during a DNS request.
      w.terminate().then(() => {
        expect(messageHandler).toHaveBeenCalledTimes(1);
        resolve();
      });
    });

    w.on("message", messageHandler);
  });
});

//<#END_FILE: test-worker-dns-terminate.js
