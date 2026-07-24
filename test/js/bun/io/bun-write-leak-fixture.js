// Avoid using String.prototype.repeat in this file because it's very slow in
// debug builds of JavaScriptCore
// ASAN's quarantine retains freed allocations (default 256 MB) and shadow memory
// raises the absolute RSS floor, so widen the cap to avoid false positives.
// harness.ts sets BUN_TEST_IS_ASAN in bunEnv when the parent test process is
// ASAN-instrumented (covers both CI's `bun-asan` and local `bun bd` debug builds).
const isASAN = process.env.BUN_TEST_IS_ASAN === "1";
const MAX_ALLOWED_MEMORY_USAGE = isASAN ? 768 : 256;
const dest = process.argv.at(-1);

async function run(inputType) {
  for (let i = 0; i < 100; i++) {
    const largeFile = inputType;
    await Bun.write(dest, largeFile);
    Bun.gc(true);
    const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    console.log("Memory usage:", rss, "MB");
    if (rss > MAX_ALLOWED_MEMORY_USAGE) {
      throw new Error("Memory usage is too high");
    }
  }
}

// 30 MB, plain-text ascii
await run(new Buffer(1024 * 1024 * 1).fill("A".charCodeAt(0)).toString("utf-8"));

// ~15 MB, UTF-16 emoji
await run(new Buffer(1024 * 1024 * 1).fill("😃").toString("utf-8"));

// 30 MB, ArrayBufferView
await run(new Uint8Array(1024 * 1024 * 1).fill("B".charCodeAt(0)));
