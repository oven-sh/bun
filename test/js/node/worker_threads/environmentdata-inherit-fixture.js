const { Worker, getEnvironmentData, setEnvironmentData, workerData, isMainThread } = require("worker_threads");

if (isMainThread) {
  // this value should be passed all the way down even through worker threads that don't call setEnvironmentData
  setEnvironmentData("inherited", "foo");
  new Worker(__filename, { workerData: { depth: 0 } });
} else {
  console.log(getEnvironmentData("inherited"));
  const { depth } = workerData;
  if (depth + 1 < 5) {
    new Worker(__filename, { workerData: { depth: depth + 1 } });
  }
}
