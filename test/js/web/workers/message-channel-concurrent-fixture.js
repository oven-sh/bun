// Stress the MessagePortChannelRegistry from many threads concurrently.
// Each worker (and the main thread) creates/posts-to/closes many MessageChannels
// in a tight loop with no yields, so the registry's HashMap is being rehashed and
// mutated from several threads at once. Prior to the registry being lock-protected
// this corrupted the HashMap and crashed.

import { Worker, isMainThread, parentPort, receiveMessageOnPort } from "worker_threads";

const WORKERS = 6;
const ITERATIONS = 400;
const CHANNELS_PER_ITERATION = 8;

function hammer() {
  let received = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const channels = [];
    for (let j = 0; j < CHANNELS_PER_ITERATION; j++) {
      const { port1, port2 } = new MessageChannel();
      const inner = new MessageChannel();
      // Transfer a port (hits disentangle/entangle in the registry) and post twice.
      port1.postMessage(j, [inner.port1]);
      port1.postMessage(j);
      // Synchronous registry access from this thread.
      while (receiveMessageOnPort(port2)) received++;
      channels.push(port1, port2, inner.port2);
    }
    for (const p of channels) p.close();
  }
  return received;
}

if (isMainThread) {
  let done = 0;
  let total = 0;
  const workers = [];

  for (let w = 0; w < WORKERS; w++) {
    const worker = new Worker(import.meta.path);
    worker.on("message", n => {
      total += n;
      if (++done === WORKERS + 1) finish();
    });
    worker.on("error", err => {
      console.error("worker error:", err);
      process.exit(1);
    });
    workers.push(worker);
  }

  total += hammer();
  if (++done === WORKERS + 1) finish();

  function finish() {
    if (total === 0) {
      console.error("FAIL: no messages received");
      process.exit(1);
    }
    console.log("PASS", total);
    for (const w of workers) w.terminate();
    process.exit(0);
  }
} else {
  parentPort.postMessage(hammer());
}
