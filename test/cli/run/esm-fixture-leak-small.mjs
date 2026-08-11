import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
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

if (typeof Bun !== "undefined") Bun.gc(true);
for (let i = 0; i < 5; i++) {
  delete require.cache[dest];
  await import(dest);
}
if (typeof Bun !== "undefined") Bun.gc(true);
const baseline = rss();

// Instrumented builds (ASAN, debug) load modules many times slower, so the
// driving test scales the loop down via LEAK_ITERATIONS; the threshold below
// scales with it. Release runs keep the full 100k.
const iterations = Number(process.env.LEAK_ITERATIONS) || 100000;
for (let i = 0; i < iterations; i++) {
  delete require.cache[dest];
  await import(dest);
}
if (typeof Bun !== "undefined") Bun.gc(true);

setTimeout(() => {
  let diff = rss() - baseline;
  diff = (diff / 1024 / 1024) | 0;
  console.log({ leaked: diff + " MB", iterations });
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
  //
  // The leak this guards against costs ~1 KB per iteration (100 MB / 100k
  // above), so the allowance scales with the iteration count on top of an
  // iteration-independent floor: allocator/JIT warmup normally, and under
  // ASAN also the free quarantine (256 MB by default) plus redzones. At the
  // full 100k this is the same 100 MB / 500 MB as before.
  const leakAllowance = Math.ceil((60 * iterations) / 100000);
  const limit = (isASAN ? 440 : 40) + leakAllowance;
  if (diff >= limit) {
    console.log("\n--fail--\n");
    process.exit(1);
  } else {
    console.log("\n--pass--\n");
  }
}, 24);
