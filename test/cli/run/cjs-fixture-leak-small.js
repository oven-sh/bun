const dest = require.resolve("./leak-fixture-small-ast.js");
// ASAN's quarantine retains freed allocations (default 256 MB) so RSS deltas
// run far higher under bun-asan; widen the threshold to avoid false positives.
const isASAN = process.execPath.includes("bun-asan");

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
const baseline = process.memoryUsage.rss();

for (let i = 0; i < 10000; i++) {
  delete require.cache[dest];
  require(dest);
}
gc();

setTimeout(() => {
  let diff = process.memoryUsage.rss() - baseline;
  diff = (diff / 1024 / 1024) | 0;
  console.log({ leaked: diff + " MB" });
  if (diff > (isASAN ? 320 : 48)) {
    console.log("\n--fail--\n");
    process.exit(1);
  } else {
    console.log("\n--pass--\n");
  }
}, 16);
