"use strict";
// Parent driver for the "terminate during native property iteration" leak test. Runs
// THREADS concurrent chains, each spawning ITERS workers back-to-back and terminate()ing
// each as soon as it asks. The exit -> spawn handoff is where the termination trap most
// often lands inside the JSPropertyIterator create window.
const { Worker } = require("worker_threads");
const path = require("path");

const ITERS = 6;
const THREADS = 6;
const body = path.join(__dirname, "worker-terminate-propiter-worker-fixture.js");

function spin(iter) {
  const w = new Worker(body);
  w.on("message", () => w.terminate());
  w.on("error", () => {});
  w.on("exit", () => {
    if (iter < ITERS) spin(iter + 1);
  });
}
for (let i = 0; i < THREADS; i++) spin(0);
