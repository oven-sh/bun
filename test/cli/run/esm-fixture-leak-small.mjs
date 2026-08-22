import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dest = require.resolve("./leak-fixture-small-ast.js");
// ASAN's quarantine retains freed allocations (default 256 MB) so RSS deltas
// run far higher under bun-asan; widen the threshold to avoid false positives.
const isASAN = process.execPath.includes("bun-asan");
const rss =
  process.platform === "darwin" && typeof Bun !== "undefined" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

// The JS heap and allocator grow by 5-10 MB over the first couple thousand
// loads and then hold steady. Taking the baseline after that leaves only
// per-load growth inside the measured window, which is what lets the window be
// 40k loads instead of the 100k this fixture used to need (20-27s on the 4 vCPU
// CI agents, against the test's 30s budget).
const warmupLoads = 2_000;
const measuredLoads = 40_000;

if (typeof Bun !== "undefined") Bun.gc(true);
for (let i = 0; i < warmupLoads; i++) {
  delete require.cache[dest];
  await import(dest);
}
if (typeof Bun !== "undefined") Bun.gc(true);
const baseline = rss();

for (let i = 0; i < measuredLoads; i++) {
  delete require.cache[dest];
  await import(dest);
}
if (typeof Bun !== "undefined") Bun.gc(true);

setTimeout(() => {
  let diff = rss() - baseline;
  diff = (diff / 1024 / 1024) | 0;
  console.log({ leaked: diff + " MB" });
  // The leak this guards against retained about 1 KB per load (bun 1.0.0
  // measured 100-120 MB over 100k loads), so 40k loads of it are 40 MB or more.
  // A non-leaking release build measures 0-7 MB here (20 runs, Linux x64).
  if (diff >= (isASAN ? 500 : 20)) {
    console.log("\n--fail--\n");
    process.exit(1);
  } else {
    console.log("\n--pass--\n");
  }
}, 24);
