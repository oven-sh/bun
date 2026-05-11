import { test } from "bun:test";
import { isASAN } from "harness";

// The internal `Loader.registry` JS object was removed when JSC's module loader
// became pure C++; there's no public way to wipe the whole ESM registry from JS,
// and per-iteration `delete require.cache[key]` would just exercise removeEntry
// instead of the file-loader path this test was measuring.
test.skip("a file: loader file can be imported 10,000 times", async () => {
  const prev = Bun.unsafe.gcAggressionLevel();
  Bun.unsafe.gcAggressionLevel(0);
  var baseline;
  Bun.gc(true);
  for (let i = 0; i < 1000; i++) {
    await import("./an-empty-file-with-a-strange-extension.weird?j" + i);
  }
  baseline = process.memoryUsage.rss();
  Bun.gc(true);
  for (let i = 0; i < (isASAN ? 25_000 : 100_000); i++) {
    await import("./an-empty-file-with-a-strange-extension.weird?i" + i);
  }

  Bun.gc(true);
  const memory = process.memoryUsage.rss();
  Bun.unsafe.gcAggressionLevel(prev);

  // It's pretty hard to test for not leaking specifier strings correctly. We need string stats.
  console.log("Memory usage: ", (memory - baseline) / 1024 / 1024, "MB");
}, 10_000);
