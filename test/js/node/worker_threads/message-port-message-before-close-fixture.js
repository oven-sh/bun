"use strict";
// Regression fixture for a data race in MessagePortChannel / MessagePortChannelRegistry.
// A Worker thread posts many messages to a transferred port and then closes it, while the main
// thread concurrently drains the port's pending-message queue. Before the fix both threads
// mutated the same Vector<MessageWithMessagePorts> without any synchronization, leading to
// heap corruption (ASAN unknown-crash / SEGV).
//
// This is a more aggressive variant of Node's
// test/parallel/test-worker-message-port-message-before-close.js that reproduces the race
// reliably under ASAN while staying fast enough for debug builds.

const assert = require("assert");
const { once } = require("events");
const { Worker, MessageChannel } = require("worker_threads");

const PER_ITERATION = 50;

async function main() {
  const worker = new Worker(
    `
    const { parentPort } = require('worker_threads');
    parentPort.on('message', ({ port }) => {
      for (let j = 0; j < ${PER_ITERATION}; j++) port.postMessage('m' + j);
      port.postMessage('last');
      port.close();
    });
  `,
    { eval: true },
  );

  for (let i = 0; i < 500; i++) {
    const { port1, port2 } = new MessageChannel();
    worker.postMessage({ port: port2 }, [port2]);

    let seen = 0;
    while (true) {
      const [msg] = await once(port1, "message");
      if (msg === "last") break;
      assert.strictEqual(msg, "m" + seen, `iteration ${i}: expected m${seen}, got ${msg}`);
      seen++;
    }
    assert.strictEqual(seen, PER_ITERATION, `iteration ${i}: expected ${PER_ITERATION} messages, got ${seen}`);
  }

  await worker.terminate();
  console.log("ok");
}

main();
