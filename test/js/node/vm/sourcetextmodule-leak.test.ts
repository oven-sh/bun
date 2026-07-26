const vm = require("vm");
const { describe, it, expect } = require("bun:test");
const { isASAN, isDebug, expectMaxObjectTypeCount } = require("harness");
const { heapStats } = require("bun:jsc");

// Each module carries ~50 KB of source so a retained SourceProvider shows up in
// RSS. A full GC after every batch bounds the no-leak RSS to roughly one batch
// of outstanding work; without that, the allocator's high-water mark dominates
// and the leak and no-leak RSS end up within noise of each other (50k iters on
// release both landed ~2.7 GB, under the old 3 GB threshold).
//
// Debug builds parse/link ~25× slower, so scale iterations down there. The
// object-count check at the end is the authoritative leak signal: it is exact
// and unaffected by ASAN's ~256 MB quarantine, which otherwise absorbs freed
// pages and makes the RSS delta under-report on sanitized lanes.
const ITERATIONS = isDebug ? 400 : 8_000;
const BATCH = isDebug ? 50 : 500;
// No-leak RSS settles at ~110-130 MB release / ~30 MB debug with the batch GC;
// a per-module leak adds ~55 KB each (~430 MB at 8k iters). ASAN's quarantine
// raises the floor by up to 256 MB regardless of leak state.
const THRESHOLD_MB = isASAN ? 600 : 256;

describe("vm.SourceTextModule", () => {
  it(
    "shouldn't leak memory",
    async () => {
      const baseline = heapStats().objectTypeCounts.NodeVMSourceTextModule ?? 0;
      const initialUsage = process.memoryUsage.rss();

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

      const finalUsage = process.memoryUsage.rss();
      const megabytes = Math.round(((finalUsage - initialUsage) / 1024 / 1024) * 100) / 100;
      expect(megabytes).toBeLessThan(THRESHOLD_MB);

      await expectMaxObjectTypeCount(expect, "NodeVMSourceTextModule", baseline + 20);
    },
    isDebug ? 30_000 : 15_000,
  );
});
