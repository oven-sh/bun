const dest = require.resolve("./leak-fixture-small-ast.js");
// ASAN's quarantine retains freed allocations (default 256 MB) so RSS deltas
// run far higher under ASAN; widen the threshold to avoid false positives.
// Ask the runtime (same as harness.isASAN): debug builds also enable ASAN but
// are named bun-debug, so the executable name alone is not enough.
const isASAN = (() => {
  try {
    const { isASANEnabled } = require("bun:internal-for-testing");
    if (typeof isASANEnabled === "function") return isASANEnabled();
  } catch {}
  return process.execPath.includes("bun-asan");
})();
const rss =
  process.platform === "darwin" && typeof Bun !== "undefined" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

let gc = globalThis.gc;
if (typeof Bun !== "undefined") {
  gc = () => Bun.gc(true);
}

if (!gc) {
  gc = () => {};
}

gc();
for (let i = 0; i < 5; i++) {
  delete require.cache[dest];
  require(dest);
}
gc();
const baseline = rss();

for (let i = 0; i < 10000; i++) {
  delete require.cache[dest];
  require(dest);
}
gc();

setTimeout(() => {
  let diff = rss() - baseline;
  diff = (diff / 1024 / 1024) | 0;
  console.log({ leaked: diff + " MB" });
  if (diff > (isASAN ? 320 : 48)) {
    console.log("\n--fail--\n");
    process.exit(1);
  } else {
    console.log("\n--pass--\n");
  }
}, 16);
