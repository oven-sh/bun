const wt = require("worker_threads");

wt.parentPort.on("message", e => {
  let sharedBufferView = new Int32Array(e.sharedBuffer);
  wt.workerData.postMessage("done!");
  Atomics.add(sharedBufferView, 0, 1);
  Atomics.notify(sharedBufferView, 0, Infinity);
});
