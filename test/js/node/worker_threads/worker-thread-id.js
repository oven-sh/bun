const wt = require("worker_threads");

wt.parentPort.on("message", message => {
  if (message.workerId !== wt.threadId) {
    throw new Error("threadId is not consistent");
  }
});
