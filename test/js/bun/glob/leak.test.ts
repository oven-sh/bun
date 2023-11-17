import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { Glob, GlobScanOptions } from "bun";

describe("leaks", () => {
  const bun = process.argv[0];
  const cwd = import.meta.dir;
  const iters = 100;
  const hundredMb = (1 << 20) * 100;

  test("scanSync", () => {
    const code = /* ts */ `
      let prev: number | undefined = undefined;
      for (let i = 0; i < ${iters}; i++) {
        Bun.gc(true);
        (function () {
          const glob = new Bun.Glob("**/*");
          Array.from(glob.scanSync({ cwd: '${cwd}' }));
        })();
        Bun.gc(true);
        const val = process.memoryUsage.rss();
        if (prev === undefined) {
          prev = val;
        } else {
          if (Math.abs(prev - val) >= ${hundredMb}) {
            throw new Error('uh oh: ' + Math.abs(prev - val))
          }
        }
      }
    `;

    const { stdout, stderr, exitCode } = Bun.spawnSync([bun, "--smol", "-e", code]);
    console.log(stdout.toString(), stderr.toString());
    expect(exitCode).toBe(0);
  });

  test("scan", async () => {
    const code = /* ts */ `
      let prev: number | undefined = undefined;
      for (let i = 0; i < ${iters}; i++) {
        Bun.gc(true);
        await (async function () {
          const glob = new Bun.Glob("**/*");
          await Array.fromAsync(glob.scan({ cwd: '${cwd}' }));
        })();
        Bun.gc(true);
        const val = process.memoryUsage.rss();
        if (prev === undefined) {
          prev = val;
        } else {
          if (Math.abs(prev - val) >= ${hundredMb}) {
            throw new Error('uh oh: ' + Math.abs(prev - val))
          }
        }
      }
    `;

    const { stdout, stderr, exitCode } = Bun.spawnSync([bun, "--smol", "-e", code]);
    console.log(stdout.toString(), stderr.toString());
    expect(exitCode).toBe(0);
  });
});
