// Loaded both as a Web Worker and as a node:worker_threads Worker; parentPort
// receives the parent's messages in both (in a node worker only parentPort
// does, as in node).
const { parentPort } = require("node:worker_threads");
parentPort.on("message", () => {
  parentPort.postMessage({
    argv: process.argv,
    execArgv: process.execArgv,
  });
});
