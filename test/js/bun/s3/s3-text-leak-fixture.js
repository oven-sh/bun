// Avoid using String.prototype.repeat in this file because it's very slow in
// debug builds of JavaScriptCore
const { randomUUID } = require("crypto");

// Reads are sequential and the warmup runs the same number of iterations as
// the measured phase so allocator segments, the HTTP connection pool, and
// TLS state are already at steady state when the baseline sample is taken.
// If the body is freed, the measured phase reuses the same segments and
// growth is near zero; if each .text() leaks its 1 MiB body, the measured
// phase adds ~ITERATIONS MiB on top of the baseline.
const ITERATIONS = 30;
const MAX_ALLOWED_MEMORY_USAGE_INCREMENT = ITERATIONS / 2;
let MAX_ALLOWED_MEMORY_USAGE = 0;

const s3Dest = randomUUID() + "-s3-stream-leak-fixture";

const s3file = Bun.s3.file(s3Dest);
async function readLargeFile() {
  await Bun.s3.file(s3Dest).text();
}
async function settle() {
  // External strings need their finalizers to run before the backing
  // allocation is released; cycle GC a few times so both samples are taken
  // under the same conditions.
  for (let i = 0; i < 4; i++) {
    Bun.gc(true);
    await Bun.sleep(10);
  }
}
async function run(inputType) {
  await s3file.write(inputType);
  Bun.gc(true);

  // base line
  for (let i = 0; i < ITERATIONS; i++) await readLargeFile();
  await settle();
  MAX_ALLOWED_MEMORY_USAGE = ((process.memoryUsage.rss() / 1024 / 1024) | 0) + MAX_ALLOWED_MEMORY_USAGE_INCREMENT;

  for (let i = 0; i < ITERATIONS; i++) await readLargeFile();
  await settle();

  const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
  if (rss > MAX_ALLOWED_MEMORY_USAGE) {
    await s3file.unlink();
    throw new Error("Memory usage is too high");
  }
}
await run(new Buffer(1024 * 1024 * 1, "A".charCodeAt(0)).toString("utf-8"));
await s3file.unlink();
