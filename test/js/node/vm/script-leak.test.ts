const vm = require("vm");
const { describe, it, expect } = require("bun:test");
const { isDebug } = require("harness");

// 10k×10KB ≈ 100 MB of source text — if Script records leak their source we
// blow past the threshold. Debug builds parse/evaluate ~30× slower, so scale down.
const ITERATIONS = isDebug ? 1_000 : 10_000;

describe("vm.Script", () => {
  it("shouldn't leak memory", () => {
    const initialUsage = process.memoryUsage.rss();

    {
      const source = `/*\n${Buffer.alloc(10000, " * aaaaa\n").toString("utf8")}\n*/ Buffer.alloc(10, 'hello');`;

      function go(i) {
        const script = new vm.Script(source + "//" + i);
        script.runInThisContext();
      }

      for (let i = 0; i < ITERATIONS; ++i) {
        go(i);
      }
    }

    Bun.gc(true);

    const finalUsage = process.memoryUsage.rss();
    const megabytes = Math.round(((finalUsage - initialUsage) / 1024 / 1024) * 100) / 100;
    expect(megabytes).toBeLessThan(200);
  });
});
