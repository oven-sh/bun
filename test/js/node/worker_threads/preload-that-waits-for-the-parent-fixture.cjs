// A preload of a worker. It holds the worker's thread until the parent has stored 1 in workerData.gate, so that what
// the parent posted by then waits on the worker's ports before the entry point runs.
const { workerData } = require("node:worker_threads");
Atomics.wait(workerData.gate, 0, 0);
