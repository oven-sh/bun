const { parentPort, workerData } = require("node:worker_threads");
const counter = require("./counter.cjs");
for (let i = 0; i < workerData; i++) counter.bump();
parentPort.postMessage(workerData + ":" + counter.n);
