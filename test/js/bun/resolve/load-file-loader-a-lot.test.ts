import { test } from "bun:test";
import { isASAN, isDebug } from "harness";

// 101k dynamic imports straddles 10s on CI release-asan (observed
// 9.4-10.8s) and takes ~115s under a debug+ASAN build. Scale the
// iteration count and timeout the same way load-same-js-file-a-lot
// does so the memory-growth signal survives without flaking.
const slowMultiplier = isDebug || isASAN ? 0.1 : 1;
const warmup = Math.floor(1_000 * slowMultiplier);
const iterations = Math.floor(100_000 * slowMultiplier);

test(
  "a file: loader file can be imported 10,000 times",
  async () => {
    const prev = Bun.unsafe.gcAggressionLevel();
    Bun.unsafe.gcAggressionLevel(0);
    var baseline;
    Bun.gc(true);
    for (let i = 0; i < warmup; i++) {
      await import("./an-empty-file-with-a-strange-extension.weird?j" + i);
      Loader.registry.clear();
    }
    baseline = process.memoryUsage.rss();
    Bun.gc(true);
    for (let i = 0; i < iterations; i++) {
      await import("./an-empty-file-with-a-strange-extension.weird?i" + i);
      Loader.registry.clear();
    }

    Bun.gc(true);
    const memory = process.memoryUsage.rss();
    Bun.unsafe.gcAggressionLevel(prev);

    // It's pretty hard to test for not leaking specifier strings correctly. We need string stats.
    console.log("Memory usage: ", (memory - baseline) / 1024 / 1024, "MB");
  },
  isDebug || isASAN ? 30_000 : 10_000,
);
