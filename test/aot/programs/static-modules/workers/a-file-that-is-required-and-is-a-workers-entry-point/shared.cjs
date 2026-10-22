const { isMainThread, parentPort } = require("node:worker_threads");
globalThis.runs = (globalThis.runs || 0) + 1;
let calls = 0;
exports.describe = () => "run " + globalThis.runs + ", call " + ++calls;
if (!isMainThread) parentPort.postMessage("the worker: " + exports.describe());
