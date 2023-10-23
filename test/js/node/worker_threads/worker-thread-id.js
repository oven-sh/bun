const wt = require("worker_threads");

wt.parentPort.on("message", message => {
  expect(message.workerId).toBe(wt.threadId);
});
