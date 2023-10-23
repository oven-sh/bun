const wt = require("worker_threads");

wt.parentPort.on("message", () => {
  wt.workerData.postMessage({ threadId: wt.threadId });
});
