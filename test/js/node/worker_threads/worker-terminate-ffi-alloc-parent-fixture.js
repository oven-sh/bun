"use strict";
// Parent driver for the "terminate() during allocating FFI wrapper" leak test.
// Runs THREADS concurrent chains, each spawning ITERS workers back-to-back and
// terminate()ing each as soon as it reports ready. The worker body spends most
// of its time inside the allocating C++ `fill()` loop, so terminate() lands in
// the trap-window reliably.
const { Worker } = require("worker_threads");
const path = require("path");

const ITERS = Number(process.env.ITERS || 6);
const THREADS = Number(process.env.THREADS || 6);
const body = path.join(__dirname, "worker-terminate-ffi-alloc-worker-fixture.js");

let finished = 0;
let failed = false;
function chain(iter) {
  const w = new Worker(body);
  w.on("message", () => w.terminate());
  w.on("error", err => {
    failed = true;
    console.error(err);
    process.exitCode = 1;
  });
  w.on("exit", () => {
    if (failed) return;
    if (iter < ITERS) chain(iter + 1);
    else if (++finished === THREADS) console.log("done");
  });
}
for (let i = 0; i < THREADS; i++) chain(0);
