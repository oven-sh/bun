//#FILE: test-worker-memory.js
//#SHA1: e425b7d8f32d04fae4a6e0c697a78aeae4de2f60
//-----------------
"use strict";

const util = require("util");
const { Worker } = require("worker_threads");
const os = require("os");

if (process.platform === "os400") {
  test.skip("On IBMi, the rss memory always returns zero");
}

let numWorkers = +process.env.JOBS || os.availableParallelism();
if (numWorkers > 20) {
  // Cap the number of workers at 20 (as an even divisor of 60 used as
  // the total number of workers started) otherwise the test fails on
  // machines with high core counts.
  numWorkers = 20;
}

// Verify that a Worker's memory isn't kept in memory after the thread finishes.

function run(n, done) {
  console.log(`run() called with n=${n} (numWorkers=${numWorkers})`);
  if (n <= 0) return done();
  const worker = new Worker("require('worker_threads').parentPort.postMessage(2 + 2)", { eval: true });
  worker.on("message", value => {
    expect(value).toBe(4);
  });
  worker.on("exit", () => {
    run(n - 1, done);
  });
}

test("Worker memory is not kept after thread finishes", async () => {
  const startStats = process.memoryUsage();
  let finished = 0;

  const runPromises = Array(numWorkers)
    .fill()
    .map(
      () =>
        new Promise(resolve => {
          run(60 / numWorkers, () => {
            console.log(`done() called (finished=${finished})`);
            if (++finished === numWorkers) {
              const finishStats = process.memoryUsage();
              // A typical value for this ratio would be ~1.15.
              // 5 as a upper limit is generous, but the main point is that we
              // don't have the memory of 50 Isolates/Node.js environments just lying
              // around somewhere.
              expect(finishStats.rss / startStats.rss).toBeLessThan(5);
            }
            resolve();
          });
        }),
    );

  await Promise.all(runPromises);
}, 30000); // Increase timeout to 30 seconds

//<#END_FILE: test-worker-memory.js
