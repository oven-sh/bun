// Avoid using String.prototype.repeat in this file because it's very slow in
// debug builds of JavaScriptCore
let MAX_ALLOWED_MEMORY_USAGE = 0;
// The measured phase fires 100 concurrent GETs vs 10 in the baseline, so the
// socket pool / TLS buffers / allocator segments grow. Allow headroom for that
// while still catching the per-call body leak (which would be ~100 MiB here).
let MAX_ALLOWED_MEMORY_USAGE_INCREMENT = 30;
const { randomUUID } = require("crypto");

const s3Dest = randomUUID() + "-s3-stream-leak-fixture";

const s3file = Bun.s3.file(s3Dest);
async function readLargeFile() {
  await Bun.s3.file(s3Dest).text();
}
async function settle() {
  // External strings need their finalizers to run before the backing
  // allocation is released; cycle GC a few times so both samples are taken
  // under the same conditions.
  for (let i = 0; i < 3; i++) {
    Bun.gc(true);
    await Bun.sleep(10);
  }
}
async function run(inputType) {
  await s3file.write(inputType);
  Bun.gc(true);

  {
    // base line
    await Promise.all(Array.from({ length: 10 }, () => readLargeFile()));
    await settle();
  }
  MAX_ALLOWED_MEMORY_USAGE = ((process.memoryUsage.rss() / 1024 / 1024) | 0) + MAX_ALLOWED_MEMORY_USAGE_INCREMENT;
  {
    await Promise.all(Array.from({ length: 100 }, () => readLargeFile()));
    await settle();
  }
  const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
  if (rss > MAX_ALLOWED_MEMORY_USAGE) {
    await s3file.unlink();
    throw new Error("Memory usage is too high");
  }
}
await run(new Buffer(1024 * 1024 * 1, "A".charCodeAt(0)).toString("utf-8"));
await s3file.unlink();
