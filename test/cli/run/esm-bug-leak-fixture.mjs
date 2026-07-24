import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dest = await import.meta.resolve("./esm-leak-fixture-large-ast.mjs");
// ASAN's quarantine retains freed allocations (default 256 MB) so RSS deltas
// run far higher under ASAN; widen the threshold to avoid false positives.
// harness.ts sets BUN_TEST_IS_ASAN in bunEnv when the parent test process is
// ASAN-instrumented (covers both CI's `bun-asan` and local `bun bd` debug builds).
const isASAN = process.env.BUN_TEST_IS_ASAN === "1";

if (typeof Bun !== "undefined") Bun.gc(true);
for (let i = 0; i < 5; i++) {
  delete require.cache[dest];
  await import(dest);
}
if (typeof Bun !== "undefined") Bun.gc(true);
const baseline = process.memoryUsage.rss();

for (let i = 0; i < 50; i++) {
  delete require.cache[dest];
  await import(dest);
}
if (typeof Bun !== "undefined") Bun.gc(true);

setTimeout(() => {
  let diff = process.memoryUsage.rss() - baseline;
  diff = (diff / 1024 / 1024) | 0;
  console.log({ leaked: diff + " MB" });
  if (diff > (isASAN ? 400 : 120)) {
    console.log("\n--fail--\n");
    process.exit(1);
  } else {
    console.log("\n--pass--\n");
  }
}, 16);
