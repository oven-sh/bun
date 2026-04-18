// Nested worker that reads env vars during startup.
// Used by worker-env-deep-clone.test.ts to verify that a worker's env map
// is a deep copy of its parent's — the parent worker may exit (freeing its
// arena) before this worker finishes starting.
const { Worker, workerData, parentPort } = require("worker_threads");

const depth = (workerData && workerData.depth) || 0;

// Read a bunch of env vars to exercise the env map lookup path in Zig.
let sum = 0;
for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") sum += v.length;
}

if (depth === 0) {
  // Spawn a child worker, then tell the parent we're done. The parent
  // terminates us immediately, so the child's start() races with our
  // arena teardown.
  const w = new Worker(__filename, { workerData: { depth: depth + 1 } });
  w.unref();
  if (parentPort) parentPort.postMessage({ depth, sum, ok: true });
} else {
  if (parentPort) parentPort.postMessage({ depth, sum, ok: true });
}
