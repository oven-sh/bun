const { Worker } = require("node:worker_threads");
const path = require("node:path");
const nativeTests = require("./build/Debug/napitests.node");

const worker = new Worker(path.join(__dirname, "tsfn-orphan-worker.js"));

worker.on("error", err => {
  console.error("worker error:", err);
  process.exit(1);
});

worker.on("exit", code => {
  // The worker's env, and the event loop those threadsafe functions point at,
  // are gone.
  console.log("worker exited with " + code);
  console.log(nativeTests.use_orphaned_threadsafe_functions());
  console.log("done");
});
