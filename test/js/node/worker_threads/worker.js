import { parentPort, workerData } from "worker_threads";

parentPort.on("message", e => {
  let sharedBufferView = new Int32Array(e.sharedBuffer);
  workerData.postMessage("done!");
  Atomics.add(sharedBufferView, 0, 1);
  Atomics.notify(sharedBufferView, 0, Infinity);
});
