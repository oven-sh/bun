const vm = require("vm");
const { describe, it, expect } = require("bun:test");
const { isASAN, isDebug, rss, expectMaxObjectTypeCount } = require("harness");
const { heapStats } = require("bun:jsc");

// Each module carries ~50 KB of source, so a module record that keeps its
// source alive shows up in RSS. A full GC after every batch keeps the no-leak
// RSS near one batch of outstanding work instead of the allocator's high-water
// mark over the whole run. Without it, 50k iterations with every module
// retained (2.8 GB) and with none retained both stayed under the old 3 GB bound.
//
// The object count at the end is the exact signal for a retained module record.
// It does not depend on RSS, so ASAN's quarantine, which holds freed pages and
// hides RSS deltas, cannot mask it.
const ITERATIONS = isDebug ? 200 : 8_000;
const BATCH = isDebug ? 50 : 500;
// No-leak RSS settles near 90 MB on release and 25 MB on debug. A retained
// module adds ~55 KB each (~440 MB at 8k iterations). ASAN's quarantine raises
// the floor by up to 256 MB regardless of leak state.
const THRESHOLD_MB = isASAN ? 600 : 256;

describe("vm.SourceTextModule", () => {
  it("shouldn't leak memory", async () => {
    const baseline = heapStats().objectTypeCounts.NodeVMSourceTextModule ?? 0;
    const initialUsage = rss();

    {
      const source = `/*\n${Buffer.alloc(50_000, " * aaaaa\n").toString("utf8")}\n*/ export const result = Buffer.alloc(10, 'hello').toString();`;

      let last;
      async function go(i) {
        const mod = new vm.SourceTextModule(source + "//" + i, {
          identifier: Buffer.alloc(64, i.toString()).toString("utf8"),
        });
        await mod.link(() => {});
        await mod.evaluate();
        last = mod;
      }

      for (let i = 0; i < ITERATIONS; ++i) {
        await go(i);
        if ((i + 1) % BATCH === 0) Bun.gc(true);
      }

      expect(last.status).toBe("evaluated");
      expect(last.namespace.result).toBe("hellohello");
      last = undefined;
    }

    Bun.gc(true);

    const finalUsage = rss();
    const megabytes = Math.round(((finalUsage - initialUsage) / 1024 / 1024) * 100) / 100;
    expect(megabytes).toBeLessThan(THRESHOLD_MB);

    await expectMaxObjectTypeCount(expect, "NodeVMSourceTextModule", baseline + 10, 100);
  });
});
