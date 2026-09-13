process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const asyncLocalStorage = new AsyncLocalStorage();
const workerStore = { test: "worker_threads" };
const registrationStore = { test: "listener-registration" };

function assertWorkerContext(event) {
  if (asyncLocalStorage.getStore() !== workerStore) {
    console.error(`FAIL: worker ${event} event lost context`);
    process.exit(1);
  }
}

if (isMainThread) {
  let worker;
  asyncLocalStorage.run(workerStore, () => {
    worker = new Worker(__filename, { workerData: "message" });
  });

  asyncLocalStorage.run(registrationStore, () => {
    worker.on("message", () => {
      assertWorkerContext("message");
      worker.terminate();
    });

    worker.on("error", error => {
      console.error(`FAIL: message worker emitted error: ${error.message}`);
      process.exit(1);
    });

    worker.on("exit", () => {
      assertWorkerContext("exit");

      let errorWorker;
      asyncLocalStorage.run(workerStore, () => {
        errorWorker = new Worker(__filename, { workerData: "error" });
      });

      let sawError = false;
      asyncLocalStorage.run(registrationStore, () => {
        errorWorker.on("error", error => {
          assertWorkerContext("error");
          if (error.message !== "worker error") {
            console.error(`FAIL: unexpected worker error: ${error.message}`);
            process.exit(1);
          }
          sawError = true;
        });

        errorWorker.on("exit", () => {
          assertWorkerContext("error exit");
          if (!sawError) {
            console.error("FAIL: error worker exited without emitting error");
            process.exit(1);
          }
          process.exit(0);
        });
      });
    });

    worker.postMessage("test");
  });
} else {
  if (workerData === "error") {
    throw new Error("worker error");
  } else {
    parentPort.on("message", () => {
      parentPort.postMessage("response");
    });
  }
}
