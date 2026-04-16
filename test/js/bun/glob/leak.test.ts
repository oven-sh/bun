import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
          Array.from(glob.scanSync({ cwd: '${escapeCwd(cwd)}' }));
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
          await Array.fromAsync(glob.scan({ cwd: '${escapeCwd(cwd)}' }));
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

  // Regression: GlobWalker struct (~1-4KB, embeds bun.PathBuffer) was never
  // alloc.destroy()'d after deinit, leaking on every scan/scanSync call.
  // ASAN's malloc quarantine is disabled so freed memory leaves RSS; equal
  // warmup/measure phases let mimalloc's page cache reach steady state.
  const structLeakEnv = {
    ...bunEnv,
    ASAN_OPTIONS:
      ((bunEnv as any).ASAN_OPTIONS ? (bunEnv as any).ASAN_OPTIONS + ":" : "") +
      "quarantine_size_mb=0:thread_local_quarantine_size_kb=0",
  };

  test("scanSync does not leak GlobWalker struct", () => {
    using dir = tempDir("glob-struct-leak-sync", { "a.txt": "" });
    const cwdEsc = escapeCwd(String(dir));
    const code = /* ts */ `
      const glob = new Bun.Glob("*.txt");
      for (let i = 0; i < 10000; i++) Array.from(glob.scanSync({ cwd: '${cwdEsc}' }));
      Bun.gc(true);
      const before = process.memoryUsage.rss();
      for (let i = 0; i < 10000; i++) Array.from(glob.scanSync({ cwd: '${cwdEsc}' }));
      Bun.gc(true);
      const after = process.memoryUsage.rss();
      const growthMB = (after - before) / 1024 / 1024;
      if (growthMB > 8) throw new Error("leaked " + growthMB.toFixed(2) + "MB over 10000 iters");
    `;
    const { stderr, exitCode } = Bun.spawnSync({ cmd: [bunExe(), "--smol", "-e", code], env: structLeakEnv });
    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);
  });

  test("scan does not leak GlobWalker struct", () => {
    using dir = tempDir("glob-struct-leak-async", { "a.txt": "" });
    const cwdEsc = escapeCwd(String(dir));
    const code = /* ts */ `
      const glob = new Bun.Glob("*.txt");
      for (let i = 0; i < 10000; i++) await Array.fromAsync(glob.scan({ cwd: '${cwdEsc}' }));
      Bun.gc(true);
      const before = process.memoryUsage.rss();
      for (let i = 0; i < 10000; i++) await Array.fromAsync(glob.scan({ cwd: '${cwdEsc}' }));
      Bun.gc(true);
      const after = process.memoryUsage.rss();
      const growthMB = (after - before) / 1024 / 1024;
      if (growthMB > 8) throw new Error("leaked " + growthMB.toFixed(2) + "MB over 10000 iters");
    `;
    const { stderr, exitCode } = Bun.spawnSync({ cmd: [bunExe(), "--smol", "-e", code], env: structLeakEnv });
    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);
  });
});

function escapeCwd(cwd: string): string {
  if (process.platform == "win32") return cwd.replaceAll("\\", "\\\\");
  return cwd;
}
