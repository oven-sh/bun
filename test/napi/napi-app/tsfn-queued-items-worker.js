const { workerData, parentPort } = require("node:worker_threads");
const { writeSync } = require("node:fs");
const nativeTests = require("./build/Debug/napitests.node");

// Queue three items, then go away with them still queued: they must reach the
// addon's call_js with this worker's live env, and the JS callback must not run
// (script is refused in a worker that is exiting). Written with writeSync so
// that, if it does run, the line lands in stdout before the worker is gone.
// Except for "microtask": the first item runs the JS callback, which is what exits the worker.
nativeTests.queue_threadsafe_function_items(
  () => {
    writeSync(1, "worker: js callback ran\n");
    queueMicrotask(() => process.exit(0));
  },
  3,
  /* print_finalize */ true,
);

if (workerData.how === "exit") {
  process.exit(0);
} else if (workerData.how === "terminate") {
  // Stay on the JS stack so nothing is dispatched before the parent's
  // terminate() lands.
  parentPort.postMessage("queued");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {}
  writeSync(1, "worker: was not terminated\n");
}
