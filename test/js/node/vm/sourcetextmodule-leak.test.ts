const vm = require("vm");
const { describe, it, expect } = require("bun:test");
const { isASAN, isDebug } = require("harness");

// 20k×50KB ≈ 1 GB of source text — if module records leak their source we
// blow past the threshold. Debug builds parse/link ~50× slower, so scale down.
// ASAN's quarantine raises the RSS floor; keep a wide-but-bounded ceiling there.
// RSS delta scales linearly with N (~54 KB/iter), so thresholds scale with it.
const ITERATIONS = isDebug ? 2_000 : 20_000;
const THRESHOLD_MB = isDebug ? (isASAN ? 1500 : 300) : isASAN ? 1400 : 1200;

describe("vm.SourceTextModule", () => {
  it(
    "shouldn't leak memory",
    async () => {
      const initialUsage = process.memoryUsage.rss();

      {
        const source = `/*\n${Buffer.alloc(50_000, " * aaaaa\n").toString("utf8")}\n*/ Buffer.alloc(10, 'hello');`;

        async function go(i) {
          const mod = new vm.SourceTextModule(source + "//" + i, {
            identifier: Buffer.alloc(64, i.toString()).toString("utf8"),
          });
          await mod.link(() => {});
          await mod.evaluate();
        }

        for (let i = 0; i < ITERATIONS; ++i) {
          await go(i);
        }
      }

      Bun.gc(true);

      const finalUsage = process.memoryUsage.rss();
      const megabytes = Math.round(((finalUsage - initialUsage) / 1024 / 1024) * 100) / 100;
      expect(megabytes).toBeLessThan(THRESHOLD_MB);
    },
    isDebug ? 60_000 : 30_000,
  );
});
