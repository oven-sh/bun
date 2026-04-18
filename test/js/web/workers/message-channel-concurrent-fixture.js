// Stress the MessagePortChannelRegistry from many threads concurrently.
// hammer() creates/posts-to/transfers/closes many MessageChannels in a tight
// loop with no yields, so the registry's HashMap is being rehashed and mutated
// from several threads at once. Prior to the registry being lock-protected this
// corrupted the HashMap and crashed.
//
// Exported for the test (main thread runs it directly); when loaded as a Worker
// it runs hammer() and posts the count back.

import { isMainThread, parentPort, receiveMessageOnPort } from "worker_threads";

export const ITERATIONS = 400;
export const CHANNELS_PER_ITERATION = 8;
export const EXPECTED_PER_HAMMER = ITERATIONS * CHANNELS_PER_ITERATION * 2;

export function hammer() {
  let received = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const ports = [];
    for (let j = 0; j < CHANNELS_PER_ITERATION; j++) {
      const { port1, port2 } = new MessageChannel();
      const inner = new MessageChannel();
      // Transfer a port (hits disentangle/entangle in the registry) and post twice.
      port1.postMessage(inner.port1, [inner.port1]);
      // Post a truthy payload — receiveMessageOnPort's wrapper currently treats
      // falsy message values as "no message", which would short-circuit the loop.
      port1.postMessage({ j });
      // Synchronous registry access from this thread.
      let msg;
      while ((msg = receiveMessageOnPort(port2))) {
        received++;
        // Explicitly close the transferred port so it isn't left for GC during teardown.
        if (msg.message instanceof MessagePort) msg.message.close();
      }
      ports.push(port1, port2, inner.port2);
    }
    for (const p of ports) p.close();
  }
  return received;
}

if (!isMainThread) {
  parentPort.postMessage(hammer());
  parentPort.close();
}
