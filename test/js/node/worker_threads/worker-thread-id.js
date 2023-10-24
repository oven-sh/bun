const { parentPort } = require("worker_threads");

parentPort.on("message", message => {
  if (message.workerId !== wt.threadId) {
    throw new Error("threadId is not consistent");
  }
});
