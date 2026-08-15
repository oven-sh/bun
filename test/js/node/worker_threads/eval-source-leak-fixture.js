// Run `eval: true` Workers whose source is very large and completes instantly,
// and report how much the process grew. Each Worker copies its source into the
// Blob behind its blob: URL; that copy must be released once the Worker exits.
const { Worker } = require("node:worker_threads");

const eachSizeMiB = 100;
const iterations = 5;
const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

// One source string for every Worker: the per-Worker allocation under test is the
// Blob copy, not the string. A block comment is the cheapest thing of this size
// for the worker to evaluate.
const code = "/*" + Buffer.alloc(eachSizeMiB * 1024 * 1024 - 4, 0x20).toString() + "*/";

function test() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(code, { eval: true });
    worker.on("exit", resolve);
    worker.on("error", reject);
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

const before = rss();
for (let i = 0; i < iterations; i++) {
  await test();
  await reallyGC();
}
const after = rss();
// Retaining the copies grows the process by at least eachSizeMiB per Worker
// (around 503 MiB on macOS before they were released); the test fails the run
// once deltaMiB reaches eachSizeMiB * iterations.
console.log(JSON.stringify({ eachSizeMiB, iterations, deltaMiB: Math.round((after - before) / 1024 / 1024) }));
