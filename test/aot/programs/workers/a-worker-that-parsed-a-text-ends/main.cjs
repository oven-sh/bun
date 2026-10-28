// A worker parses a text, prints what it made, posts it and ends. Everything its own heap remembered dies with it, and the process goes on.
"use strict";
const { Worker } = require("node:worker_threads");
const worker = new Worker(require.resolve("./inner.cjs"));
worker.on("message", message => console.log("the worker says", message));
worker.on("error", error => console.log("error:", String(error.message).slice(0, 60)));
worker.on("exit", code => console.log("the worker ended with", code));
setTimeout(() => console.log("the process is alive half a second later"), 500);
