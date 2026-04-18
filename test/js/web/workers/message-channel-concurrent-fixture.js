// Stress the MessagePortChannelRegistry from many threads concurrently.
// Each worker (and the main thread) creates/posts-to/transfers/closes many
// MessageChannels in a tight loop with no yields, so the registry's HashMap is
// being rehashed and mutated from several threads at once. Prior to the registry
// being lock-protected this corrupted the HashMap and crashed.

import { Worker, isMainThread, parentPort, receiveMessageOnPort } from "worker_threads";

const WORKERS = 6;
const ITERATIONS = 400;
const CHANNELS_PER_ITERATION = 8;
const EXPECTED_PER_HAMMER = ITERATIONS * CHANNELS_PER_ITERATION * 2;

function hammer() {
  let received = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const ports = [];
    for (let j = 0; j < CHANNELS_PER_ITERATION; j++) {
      const { port1, port2 } = new MessageChannel();
      const inner = new MessageChannel();
      // Transfer a port (hits disentangle/entangle in the registry) and post twice.
      port1.postMessage(inner.port1, [inner.port1]);
      port1.postMessage(j);
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

if (isMainThread) {
  // Watchdog so deadlock regressions fail fast instead of hanging the outer test.
  const watchdog = setTimeout(() => {
    console.error("FAIL: timed out waiting for workers");
    process.exit(1);
  }, 30_000);
  watchdog.unref();

  let exited = 0;
  let reported = 0;
  let total = 0;

  for (let w = 0; w < WORKERS; w++) {
    const worker = new Worker(import.meta.path);
    worker.on("message", n => {
      if (n !== EXPECTED_PER_HAMMER) {
        console.error("FAIL: worker received", n, "messages, expected", EXPECTED_PER_HAMMER);
        process.exit(1);
      }
      reported++;
      total += n;
      maybeFinish();
    });
    worker.on("error", err => {
      console.error("worker error:", err);
      process.exit(1);
    });
    worker.on("exit", code => {
      if (code !== 0) {
        console.error("worker exited with code", code);
        process.exit(1);
      }
      exited++;
      maybeFinish();
    });
  }

  const mainTotal = hammer();
  if (mainTotal !== EXPECTED_PER_HAMMER) {
    console.error("FAIL: main thread received", mainTotal, "messages, expected", EXPECTED_PER_HAMMER);
    process.exit(1);
  }
  total += mainTotal;

  function maybeFinish() {
    if (exited === WORKERS && reported === WORKERS) finish();
  }

  function finish() {
    clearTimeout(watchdog);
    if (total !== EXPECTED_PER_HAMMER * (WORKERS + 1)) {
      console.error("FAIL: unexpected total", total);
      process.exit(1);
    }
    console.log("PASS", total);
    // Workers have all exited; let the main loop drain naturally rather than
    // racing process.exit() against any in-flight cross-thread tasks.
  }
} else {
  parentPort.postMessage(hammer());
  parentPort.close();
}
