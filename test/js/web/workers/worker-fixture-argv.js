// For Node workers, parentPort receives messages (not globalThis/self).
// For Web Workers, globalThis.addEventListener receives messages.
const wt = require("node:worker_threads");
const parentPort = wt.parentPort;

if (parentPort) {
  // Node worker_threads
  parentPort.on("message", () => {
    parentPort.postMessage({
      argv: process.argv,
      execArgv: process.execArgv,
    });
  });
} else {
  // Web Worker
  globalThis.addEventListener("message", () => {
    globalThis.postMessage({
      argv: process.argv,
      execArgv: process.execArgv,
    });
  });
}
