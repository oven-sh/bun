import { test, expect } from "bun:test";

test("Printing errors does not leak", () => {
  function batch() {
    for (let i = 0; i < 1000; i++) {
      Bun.inspect(new Error("leak"));
    }
    Bun.gc(true);
  }

  batch();
  const baseline = Math.floor(process.memoryUsage.rss() / 1024);
  for (let i = 0; i < 20; i++) {
    batch();
    const after = Math.floor(process.memoryUsage.rss() / 1024);
    const diff = after - baseline;
    expect(diff, `after ${i} iterations`).toBeLessThan(5000);
  }
}, 10_000);
