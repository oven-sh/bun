// Loops on the ungated napi calls until the parent terminates this worker
// (test_ungated_calls_worker_terminate in module.js).
const { parentPort } = require("node:worker_threads");
const nativeTests = require("./build/Debug/napitests.node");

const spin = nativeTests.make_ungated_calls_spinner();
parentPort.postMessage("spinning");
for (;;) spin(-7n, "ungated");
