process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { Worker, isMainThread, parentPort } = require("worker_threads");

const asyncLocalStorage = new AsyncLocalStorage();

if (isMainThread) {
  asyncLocalStorage.run({ test: "worker_threads" }, () => {
    const worker = new Worker(__filename);

    worker.on("message", msg => {
      if (asyncLocalStorage.getStore()?.test !== "worker_threads") {
        console.error("FAIL: worker message event lost context");
        process.exit(1);
      }
      worker.terminate();
    });

    worker.on("exit", () => {
      if (asyncLocalStorage.getStore()?.test !== "worker_threads") {
        console.error("FAIL: worker exit event lost context");
        process.exit(1);
      }
      process.exit(0);
    });

    worker.postMessage("test");
  });
} else {
  parentPort.on("message", msg => {
    parentPort.postMessage("response");
  });
}
