import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { Glob, GlobScanOptions } from "bun";

describe("leaks", () => {
  const bun = process.argv[0];
  const cwd = import.meta.dir;
  const iters = 100;
  const hundredMb = (1 << 20) * 100;

  test("scanSync", () => {
    const code = /* ts */ `
      Bun.gc(true);
      (function () {
        const glob = new Bun.Glob("**/*.ts");
        Array.from(glob.scanSync({ cwd: '${cwd}' }));
      })();
      Bun.gc(true);
      console.error(process.memoryUsage.rss())
    `;

    let prev: number | undefined = undefined;
    for (let i = 0; i < iters; i++) {
      const { stderr, exitCode } = Bun.spawnSync([bun, "--smol", "-e", code]);
      expect(exitCode).toBe(0);
      const val = parseInt(stderr.toString());
      if (prev === undefined) {
        prev = val;
      } else {
        expect(Math.abs(prev - val)).toBeLessThanOrEqual(hundredMb);
      }
    }
  });

  test("scan", async () => {
    const code = /* ts */ `
      Bun.gc(true);
      await (async function () {
        const glob = new Bun.Glob("**/*.ts");
        Array.fromAsync(glob.scan({ cwd: '${cwd}' }));
      })();
      Bun.gc(true);
      console.error(process.memoryUsage.rss())
    `;

    let prev: number | undefined = undefined;
    for (let i = 0; i < iters; i++) {
      const { stderr, exitCode } = Bun.spawnSync([bun, "--smol", "-e", code]);
      expect(exitCode).toBe(0);
      const val = parseInt(stderr.toString());
      if (prev === undefined) {
        prev = val;
      } else {
        expect(Math.abs(prev - val)).toBeLessThanOrEqual(hundredMb);
      }
    }
  });
});
