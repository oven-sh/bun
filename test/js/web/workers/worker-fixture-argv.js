const parentPort = require("node:worker_threads").parentPort;
const target = globalThis.addEventListener ? globalThis : parentPort;
target.addEventListener("message", () => {
  const reply = { argv: process.argv, execArgv: process.execArgv };
  if (globalThis.postMessage) globalThis.postMessage(reply);
  else parentPort.postMessage(reply);
});
