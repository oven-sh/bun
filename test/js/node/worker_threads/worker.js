import { isMainThread, parentPort, workerData } from "worker_threads";

if (parentPort === null) throw new Error("worker_threads.parentPort is null");

if (isMainThread) throw new Error("worker_threads.isMainThread is wrong");

parentPort.on("message", m => {
  let sharedBufferView = new Int32Array(m.sharedBuffer);
  if (workerData instanceof MessagePort) {
    workerData.postMessage("done!");
  }
  Atomics.add(sharedBufferView, 0, 1);
  Atomics.notify(sharedBufferView, 0, Infinity);
});
