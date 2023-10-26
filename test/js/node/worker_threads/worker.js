import { parentPort, workerData } from "worker_threads";

parentPort?.on("message", m => {
  let sharedBufferView = new Int32Array(m.sharedBuffer);
  if (workerData instanceof MessagePort) {
    workerData.postMessage("done!");
  }
  Atomics.add(sharedBufferView, 0, 1);
  Atomics.notify(sharedBufferView, 0, Infinity);
});
