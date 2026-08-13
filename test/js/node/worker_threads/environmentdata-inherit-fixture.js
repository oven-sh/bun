const { Worker, getEnvironmentData, setEnvironmentData, workerData, isMainThread } = require("worker_threads");

if (isMainThread) {
  // this value should be passed all the way down even through worker threads that don't call setEnvironmentData
  setEnvironmentData("inherited", "foo");
  new Worker(__filename, { workerData: { depth: 0 } });
} else {
  console.log(getEnvironmentData("inherited"));
  const { depth } = workerData;
  // Two levels prove the property (the value reaches a worker whose parent
  // never called setEnvironmentData); each level is a full sequential JSC
  // VM boot, so deeper chains only add debug-build time.
  if (depth + 1 < 2) {
    new Worker(__filename, { workerData: { depth: depth + 1 } });
  }
}
