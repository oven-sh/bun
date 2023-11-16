import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { Glob, GlobScanOptions } from "bun";

describe("leaks", () => {
  const cwd = import.meta.dir;
  const iters = 100;
  const hundredMb = (1 << 20) * 100;

  test("scanSync", () => {
    Bun.gc(true);
    let prev = process.memoryUsage.rss();
    for (let i = 0; i < iters; i++) {
      Bun.gc(true);
      const glob = new Glob("**/*.ts");
      Array.from(glob.scanSync({ cwd }));
      Bun.gc(true);
      const current = process.memoryUsage.rss();
      expect(Math.abs(prev - current)).toBeLessThanOrEqual(hundredMb);
    }
  });

  test("scan", async () => {
    Bun.gc(true);
    let prev = process.memoryUsage.rss();
    for (let i = 0; i < iters; i++) {
      Bun.gc(true);
      const glob = new Glob("**/*.ts");
      await Array.fromAsync(glob.scan({ cwd }));
      Bun.gc(true);
      const current = process.memoryUsage.rss();
      expect(Math.abs(prev - current)).toBeLessThanOrEqual(hundredMb);
    }
  });
});
