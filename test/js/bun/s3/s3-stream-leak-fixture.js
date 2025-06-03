// Avoid using String.prototype.repeat in this file because it's very slow in
// debug builds of JavaScriptCore
let MAX_ALLOWED_MEMORY_USAGE = 0;
let MAX_ALLOWED_MEMORY_USAGE_INCREMENT = 15;
const { randomUUID } = require("crypto");

const s3Dest = randomUUID() + "-s3-stream-leak-fixture";

const s3file = Bun.s3.file(s3Dest);
async function readLargeFile() {
  const stream = Bun.s3.file(s3Dest).stream();
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
  }
}
async function run(inputType) {
  await s3file.write(inputType);
  Bun.gc(true);

  {
    // base line
    await Promise.all(new Array(10).fill(readLargeFile()));
    await Bun.sleep(10);
    Bun.gc(true);
  }
  MAX_ALLOWED_MEMORY_USAGE = ((process.memoryUsage.rss() / 1024 / 1024) | 0) + MAX_ALLOWED_MEMORY_USAGE_INCREMENT;
  {
    await Promise.all(new Array(100).fill(readLargeFile()));
    Bun.gc(true);
  }
  const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
  if (rss > MAX_ALLOWED_MEMORY_USAGE) {
    await s3file.unlink();
    throw new Error("Memory usage is too high");
  }
}
await run(new Buffer(1024 * 1024 * 1, "A".charCodeAt(0)).toString("utf-8"));
await s3file.unlink();
