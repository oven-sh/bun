import { Worker, isMainThread, workerData, parentPort } from "worker_threads";

if (isMainThread) {
  for (let i = 0; i < 1000; i++) {
    const w = new Worker("/Users/dave/code/bun/test/js/web/worker-demo.mjs", { workerData: i });
  }
  setTimeout(() => {
    console.log(13421);
  }, 1554);
} else {
  setTimeout(() => {
    parentPort.postMessage("initial message");
    console.log(workerData.toString().padStart(4, "0"), "in worker");
  }, 1000);
}
