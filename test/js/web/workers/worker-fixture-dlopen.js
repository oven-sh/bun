(globalThis.addEventListener || require("node:worker_threads").parentPort.on)("message", () => {
  const postMessage = globalThis.postMessage || require("node:worker_threads").parentPort.postMessage;
  let error = null;
  try {
    process.dlopen({ exports: {} }, "./does-not-exist.node");
  } catch (e) {
    error = e.message;
  }
  postMessage({
    execArgv: process.execArgv,
    error,
  });
});
