// Avoid using String.prototype.repeat in this file because it's very slow in
// debug builds of JavaScriptCore
//
// Measure RSS *growth* against a baseline captured up front, not absolute RSS:
// the debug+ASAN build's process baseline is already >300 MB, which would trip
// any reasonable absolute threshold before the loop even allocates. A real leak
// (issue #10588) accretes ~1 MB per Bun.write(), i.e. ~100 MB per run() — a
// 64 MB ceiling on growth catches that with headroom for allocator slack.
const MAX_ALLOWED_MEMORY_GROWTH = 64;
const dest = process.argv.at(-1);

Bun.gc(true);
const baselineRss = (process.memoryUsage.rss() / 1024 / 1024) | 0;

async function run(inputType) {
  for (let i = 0; i < 100; i++) {
    const largeFile = inputType;
    await Bun.write(dest, largeFile);
    Bun.gc(true);
    const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    const growth = rss - baselineRss;
    console.log("Memory usage:", rss, "MB (+" + growth + " MB)");
    if (growth > MAX_ALLOWED_MEMORY_GROWTH) {
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
