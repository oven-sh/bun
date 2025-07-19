// Avoid using String.prototype.repeat in this file because it's very slow in
// debug builds of JavaScriptCore
let MAX_ALLOWED_MEMORY_USAGE = 0;
let MAX_ALLOWED_MEMORY_USAGE_INCREMENT = 15;
const dest = process.argv.at(-1);
const { randomUUID } = require("crypto");
const payload = new Buffer(1024 * 1024 + 1, "A".charCodeAt(0)).toString("utf-8");
async function writeLargeFile() {
  const s3file = Bun.s3.file(randomUUID());
  await s3file.write(payload);
  await s3file.unlink();
}
async function run() {
  {
    // base line
    await Promise.all(new Array(10).fill(writeLargeFile()));
    await Bun.sleep(10);
    Bun.gc(true);
  }
  MAX_ALLOWED_MEMORY_USAGE = ((process.memoryUsage.rss() / 1024 / 1024) | 0) + MAX_ALLOWED_MEMORY_USAGE_INCREMENT;

  {
    await Promise.all(new Array(100).fill(writeLargeFile()));
    Bun.gc(true);
  }
  const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
  if (rss > MAX_ALLOWED_MEMORY_USAGE) {
    throw new Error("Memory usage is too high");
  }
}
await run();
