// Two Workers and the main thread require one module that keeps a counter in an export: three counters.
const { Worker } = require("node:worker_threads");
const counter = require("./counter.cjs");
counter.bump();
const lines = [];
for (const times of [2, 3]) {
  new Worker("./worker.cjs", { workerData: times }).on("message", line => {
    lines.push(line);
    if (lines.length === 2) console.log(lines.sort().join(), counter.n);
  });
}
