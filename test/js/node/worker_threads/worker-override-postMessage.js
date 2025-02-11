import { isMainThread, parentPort } from "worker_threads";

if (parentPort === null) throw new Error("worker_threads.parentPort is null");

if (isMainThread) throw new Error("worker_threads.isMainThread is wrong");

Object.assign(global, {
  postMessage: message => {
    parentPort.postMessage(message);
  },
});

parentPort.on("message", m => {
  postMessage("Hello from worker!");
});
