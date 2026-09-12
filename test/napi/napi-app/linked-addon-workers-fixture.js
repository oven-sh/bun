// Loads the same addon from several Workers and the main thread at the same
// time and prints "ok <count>" once every thread got a working module. Under
// `bun build --compile` on Windows the addon is merged into the exe, so the
// first dlopen binds it in place while the others wait for the binder lock and
// then replay the registration; every thread has to end up with the same,
// working exports. Elsewhere (and run directly) this covers the plain DLL path.
const { Worker, isMainThread, parentPort } = require("node:worker_threads");

const WORKERS = 4;

if (isMainThread) {
  const results = [];
  const workers = [];
  for (let i = 0; i < WORKERS; i++) {
    const worker = new Worker(__filename);
    workers.push(worker);
    results.push(
      new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      }),
    );
  }
  // Race the main thread's own load against the workers' loads.
  const mine = require("./build/Debug/unwind_addon.node").longjmp_depth();
  Promise.all(results).then(
    values => {
      const bad = [mine, ...values].filter(v => v !== "longjmp: 3");
      console.log(bad.length === 0 ? `ok ${values.length + 1}` : `bad results: ${JSON.stringify(bad)}`);
      for (const worker of workers) worker.terminate();
    },
    error => {
      console.log(`worker failed: ${error && error.message ? error.message : error}`);
      process.exit(1);
    },
  );
} else {
  parentPort.postMessage(require("./build/Debug/unwind_addon.node").longjmp_depth());
}
