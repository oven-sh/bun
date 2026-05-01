(globalThis.addEventListener || require("node:worker_threads").parentPort.on)("message", () => {
  const postMessage = globalThis.postMessage || require("node:worker_threads").parentPort.postMessage;
  postMessage({
    argv: process.argv,
    execArgv: process.execArgv,
  });
});
