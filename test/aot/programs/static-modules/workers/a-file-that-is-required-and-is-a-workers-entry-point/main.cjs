// One file is required by the entry point and is the entry point of a Worker: it runs once in each thread, and each thread has its own variables.
const { Worker } = require("node:worker_threads");
const shared = require("./shared.cjs");
console.log("the main thread:", shared.describe());
const worker = new Worker("./shared.cjs");
worker.on("message", line => console.log(line, "| the main thread again:", require("./shared.cjs").describe()));
