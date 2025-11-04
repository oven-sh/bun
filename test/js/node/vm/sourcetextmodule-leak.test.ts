const vm = require("vm");
const { describe, it, expect } = require("bun:test");

describe("vm.SourceTextModule", () => {
  it("shouldn't leak memory", async () => {
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

      for (let i = 0; i < 50_000; ++i) {
        await go(i);
      }
    }

    Bun.gc(true);

    const finalUsage = process.memoryUsage.rss();
    const megabytes = Math.round(((finalUsage - initialUsage) / 1024 / 1024) * 100) / 100;
    expect(megabytes).toBeLessThan(3000);
  });
});
