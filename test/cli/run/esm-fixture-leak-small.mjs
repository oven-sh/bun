import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dest = require.resolve("./leak-fixture-small-ast.js");
// ASAN's quarantine retains freed allocations (default 256 MB) so RSS deltas
// run far higher under bun-asan; widen the threshold to avoid false positives.
const isASAN = process.execPath.includes("bun-asan");
const rss = process.memoryUsage.rss;

if (typeof Bun !== "undefined") Bun.gc(true);
for (let i = 0; i < 5; i++) {
  delete require.cache[dest];
  await import(dest);
}
if (typeof Bun !== "undefined") Bun.gc(true);
const baseline = rss();

// An import takes ~0.35ms under ASAN, and the full count does not fit the test's 60s on the slowest CI agents.
for (let i = 0; i < (isASAN ? 40000 : 100000); i++) {
  delete require.cache[dest];
  await import(dest);
}
if (typeof Bun !== "undefined") Bun.gc(true);

setTimeout(() => {
  let diff = rss() - baseline;
  diff = (diff / 1024 / 1024) | 0;
  console.log({ leaked: diff + " MB" });
  console.error("esm-fixture-leak-small: leaked", diff, "MB");
  // This test seems to be more flaky on slow filesystems.
  // This used to be 40 MB, but the original version of Bun which this triggered on would reach 120 MB
  // so we can increase it to 100 and still catch the leak.
  //
  // ❯ bunx bun@1.0.0 --smol test/cli/run/esm-fixture-leak-small.mjs
  // {
  //   leaked: "100 MB"
  // }
  // ❯ bunx bun@1.1.0 --smol test/cli/run/esm-fixture-leak-small.mjs
  // {
  //   leaked: "38 MB",
  // }
  // Under ASAN the quarantine alone reads ~4 KB per import: 180 to 191 MB at 40,000 imports.
  if (diff >= (isASAN ? 225 : 100)) {
    console.log("\n--fail--\n");
    process.exit(1);
  } else {
    console.log("\n--pass--\n");
  }
}, 24);
