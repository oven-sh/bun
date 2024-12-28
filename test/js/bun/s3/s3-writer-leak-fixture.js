// Avoid using String.prototype.repeat in this file because it's very slow in
// debug builds of JavaScriptCore
let MAX_ALLOWED_MEMORY_USAGE = 0;
let MAX_ALLOWED_MEMORY_USAGE_INCREMENT = 10;
const dest = process.argv.at(-1);
const { randomUUID } = require("crypto");

const s3Dest = randomUUID();

const s3file = Bun.s3(s3Dest);

async function writeLargeFile(inputType) {
  const writer = s3file.writer();
  writer.write(inputType);
  await writer.end();
  Bun.gc(true);
}
async function run(inputType) {
  for (let i = 0; i < 5; i++) {
    await writeLargeFile(inputType);
    Bun.gc(true);
    if (!MAX_ALLOWED_MEMORY_USAGE) {
      MAX_ALLOWED_MEMORY_USAGE = ((process.memoryUsage.rss() / 1024 / 1024) | 0) + MAX_ALLOWED_MEMORY_USAGE_INCREMENT;
    }
    const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    if (rss > MAX_ALLOWED_MEMORY_USAGE) {
      await s3file.unlink();
      throw new Error("Memory usage is too high");
    }
  }
}
await run(new Buffer(1024 * 1024 * 1).fill("A".charCodeAt(0)).toString("utf-8"));
await s3file.unlink();
