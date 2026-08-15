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
    // A worker that did not run its source did not make the copy being measured.
    worker.on("exit", exitCode => (exitCode === 0 ? resolve() : reject(new Error(`worker exited with ${exitCode}`))));
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
// The copies have to be this large: allocations of this size go back to the OS
// when freed, so a healthy run reads about 0 and retained copies read about
// eachSizeMiB * iterations; the test draws the line between the two.
console.log(JSON.stringify({ eachSizeMiB, iterations, deltaMiB: Math.round((after - before) / 1024 / 1024) }));
