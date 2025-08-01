// Create a worker with extremely large source code which completes instantly and the `eval` option
// set to true. Ensure that the Blob created to hold the source code is not kept in memory after the
// worker exits.
const { Worker } = require("node:worker_threads");

const eachSizeMiB = 100;
const iterations = 5;

function test() {
  const code = " ".repeat(eachSizeMiB * 1024 * 1024);
  return new Promise((resolve, reject) => {
    const worker = new Worker(code, { eval: true });
    worker.on("exit", () => resolve());
    worker.on("error", e => reject(e));
  });
}

async function reallyGC() {
  for (let i = 0; i < 3; i++) {
    await Bun.sleep(5);
    Bun.gc(true);
  }
}

// warmup
await test();
await reallyGC();

const before = process.memoryUsage.rss();
for (let i = 0; i < iterations; i++) {
  await test();
  await reallyGC();
}
const after = process.memoryUsage.rss();
// The bug is that the source code passed to `new Worker` would never be freed.
// If this bug is present, then the memory growth likely won't be much more than the total amount
// of source code, but it's impossible for the memory growth to be less than the source code size.
// On macOS before fixing this bug, deltaMiB was around 503.
const deltaMiB = (after - before) / 1024 / 1024;
if (deltaMiB >= eachSizeMiB * iterations) throw new Error(`leaked ${deltaMiB} MiB`);
