const vm = require("vm");
const { describe, it, expect } = require("bun:test");

describe("vm.Script", () => {
  it("shouldn't leak memory", () => {
    const initialUsage = process.memoryUsage.rss();

    {
      const source = `/*\n${Buffer.alloc(10000, " * aaaaa\n").toString("utf8")}\n*/ Buffer.alloc(10, 'hello');`;

      function go(i) {
        const script = new vm.Script(source + "//" + i);
        script.runInThisContext();
      }

      for (let i = 0; i < 10000; ++i) {
        go(i);
      }
    }

    Bun.gc(true);

    const finalUsage = process.memoryUsage.rss();
    const megabytes = Math.round(((finalUsage - initialUsage) / 1024 / 1024) * 100) / 100;
    expect(megabytes).toBeLessThan(200);
  });
});
