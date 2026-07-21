"use strict";
// Parent driver for the node-http2.test.js "terminating a worker mid-stream" leak test. Runs
// THREADS concurrent chains, each spawning ITERS workers back-to-back and terminate()ing each as
// soon as it asks. The chain shape matches node's test-worker-http2-stream-terminate.js: the
// exit→spawn handoff is where ~VM's lastChanceToFinalize most often misses a JSH2FrameParser
// cell on a worker that is being torn down while its successor starts up.
const { Worker } = require("worker_threads");
const path = require("path");

const ITERS = 6;
const THREADS = 6;
const body = path.join(__dirname, "worker-terminate-h2-leak.fixture.js");

function spin(iter) {
  const w = new Worker(body);
  w.on("message", () => w.terminate());
  w.on("error", () => {});
  w.on("exit", () => {
    if (iter < ITERS) spin(iter + 1);
  });
}
for (let i = 0; i < THREADS; i++) spin(0);
