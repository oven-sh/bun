import { test } from "bun:test";
import { isASAN, isDebug } from "harness";

test(
  "a file: loader file can be imported 10,000 times",
  async () => {
    const prev = Bun.unsafe.gcAggressionLevel();
    Bun.unsafe.gcAggressionLevel(0);
    var baseline;
    Bun.gc(true);
    for (let i = 0; i < 1000; i++) {
      await import("./an-empty-file-with-a-strange-extension.weird?j" + i);
      Loader.registry.clear();
    }
    baseline = process.memoryUsage.rss();
    Bun.gc(true);
    for (let i = 0; i < 100_000; i++) {
      await import("./an-empty-file-with-a-strange-extension.weird?i" + i);
      Loader.registry.clear();
    }

    Bun.gc(true);
    const memory = process.memoryUsage.rss();
    Bun.unsafe.gcAggressionLevel(prev);

    // It's pretty hard to test for not leaking specifier strings correctly. We need string stats.
    console.log("Memory usage: ", (memory - baseline) / 1024 / 1024, "MB");
  },
  // 100k imports straddles the 10s limit under ASAN (observed 9.4-10.8s on
  // debian-13-x64-asan CI). Same shape as load-same-js-file-a-lot.test.ts.
  isDebug || isASAN ? 30_000 : 10_000,
);
