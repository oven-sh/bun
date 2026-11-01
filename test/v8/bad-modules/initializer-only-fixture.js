"use strict";
// Loads initializer_only.node with require() and process.dlopen(), then in a Worker, and prints one JSON report.

const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const addon = require("node:path").join(__dirname, "build", "Release", "initializer_only.node");

if (isMainThread) {
  const report = { require: require(addon).hello() };
  const loaded = { exports: {} };
  process.dlopen(loaded, addon);
  report.dlopen = loaded.exports.hello();

  const worker = new Worker(__filename);
  worker.on("message", hello => {
    report.worker = hello;
    worker.postMessage("exit");
  });
  worker.on("error", error => {
    report.workerError = error.message;
  });
  worker.on("exit", exitCode => {
    console.log(JSON.stringify({ ...report, workerExitCode: exitCode }));
  });
} else {
  parentPort.postMessage(require(addon).hello());
  parentPort.on("message", () => process.exit(0));
}
