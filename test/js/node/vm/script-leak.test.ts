import { heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { isASAN, isDebug, rss } from "harness";
import vm from "node:vm";

// Each script carries ~50 KB of source. A full GC after every batch bounds the
// garbage that can pile up, so a release build reads ~90 MB when nothing leaks
// and ~430 MB when all 8000 scripts are retained. Without the batch GC, RSS is
// the allocator's high-water mark over the whole loop in both cases.
//
// RSS cannot judge the other builds. A debug build compiles each script ~50x
// slower, so its loop is short. ASAN's quarantine keeps up to 256 MB of freed
// memory resident. The object count does not depend on RSS and covers them.
const ITERATIONS = isDebug ? 100 : isASAN ? 1_000 : 8_000;
const BATCH = isDebug ? 50 : 500;
const RSS_LIMIT_MB = 256;

describe("vm.Script", () => {
  it("shouldn't leak memory", () => {
    Bun.gc(true);
    const initialCount = heapStats().objectTypeCounts.Script ?? 0;
    const initialUsage = rss();

    {
      const source = `/*\n${Buffer.alloc(50_000, " * aaaaa\n").toString("utf8")}\n*/ Buffer.alloc(10, 'hello').toString();`;

      let result;
      function go(i) {
        const script = new vm.Script(source + "//" + i);
        result = script.runInThisContext();
      }

      for (let i = 0; i < ITERATIONS; ++i) {
        go(i);
        if ((i + 1) % BATCH === 0) Bun.gc(true);
      }

      expect(result).toBe("hellohello");
    }

    Bun.gc(true);

    const finalUsage = rss();
    const finalCount = heapStats().objectTypeCounts.Script ?? 0;
    const megabytes = Math.round(((finalUsage - initialUsage) / 1024 / 1024) * 100) / 100;

    expect(finalCount).toBeLessThanOrEqual(initialCount + 10);
    if (!isDebug && !isASAN) expect(megabytes).toBeLessThan(RSS_LIMIT_MB);
  });
});
