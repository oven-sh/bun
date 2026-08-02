const parentPort = require("node:worker_threads").parentPort;
const target = typeof globalThis.addEventListener === "function" ? globalThis : parentPort;
target.addEventListener("message", () => {
  const reply = { argv: process.argv, execArgv: process.execArgv };
  if (typeof globalThis.postMessage === "function") globalThis.postMessage(reply);
  else parentPort.postMessage(reply);
});
