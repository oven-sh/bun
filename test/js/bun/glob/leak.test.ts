import { describe, test } from "bun:test";
import { expectRssDeltaBelow, tempDir } from "harness";

const timeout = 60_000;

// The 10,000 scans of the warm-up put the memory that the JIT tiers take (7 MiB, or 22 MiB on a debug ASAN build)
// before the baseline. The delta is then under 3 MiB. With a walker that is never freed, it is 54 MiB for "*.txt" and
// 142 MiB for "**/*" (83 and 200 MiB on a debug ASAN build).
async function run(dir: string, code: string) {
  await expectRssDeltaBelow(["--smol", "-e", code], { release: 30, debug: 50 }, { cwd: dir });
}

describe("leaks", () => {
  test.concurrent(
    "scanSync",
    async () => {
      using dir = tempDir("glob-leak-scansync", { "a.txt": "", "b.txt": "", "sub/c.txt": "" });
      await run(
        String(dir),
        /* ts */ `
        const rss = process.memoryUsage.rss;
        const glob = new Bun.Glob("**/*");
        for (let i = 0; i < 10000; i++) Array.from(glob.scanSync());
        Bun.gc(true);
        const before = rss();
        for (let i = 0; i < 100000; i++) Array.from(glob.scanSync());
        Bun.gc(true);
        console.log(JSON.stringify({ deltaMiB: (rss() - before) / 1024 / 1024 }));
      `,
      );
    },
    timeout,
  );

  test.concurrent(
    "scan",
    async () => {
      using dir = tempDir("glob-leak-scan", { "a.txt": "", "b.txt": "", "sub/c.txt": "" });
      await run(
        String(dir),
        /* ts */ `
        const rss = process.memoryUsage.rss;
        const glob = new Bun.Glob("**/*");
        for (let i = 0; i < 10000; i++) await Array.fromAsync(glob.scan());
        Bun.gc(true);
        const before = rss();
        for (let i = 0; i < 100000; i++) await Array.fromAsync(glob.scan());
        Bun.gc(true);
        console.log(JSON.stringify({ deltaMiB: (rss() - before) / 1024 / 1024 }));
      `,
      );
    },
    timeout,
  );

  test.concurrent(
    "scanSync does not leak GlobWalker struct",
    async () => {
      using dir = tempDir("glob-struct-leak-sync", { "a.txt": "" });
      await run(
        String(dir),
        /* ts */ `
        const rss = process.memoryUsage.rss;
        const glob = new Bun.Glob("*.txt");
        for (let i = 0; i < 10000; i++) Array.from(glob.scanSync());
        Bun.gc(true);
        const before = rss();
        for (let i = 0; i < 100000; i++) Array.from(glob.scanSync());
        Bun.gc(true);
        console.log(JSON.stringify({ deltaMiB: (rss() - before) / 1024 / 1024 }));
      `,
      );
    },
    timeout,
  );

  test.concurrent(
    "scan does not leak GlobWalker struct",
    async () => {
      using dir = tempDir("glob-struct-leak-async", { "a.txt": "" });
      await run(
        String(dir),
        /* ts */ `
        const rss = process.memoryUsage.rss;
        const glob = new Bun.Glob("*.txt");
        for (let i = 0; i < 10000; i++) await Array.fromAsync(glob.scan());
        Bun.gc(true);
        const before = rss();
        for (let i = 0; i < 100000; i++) await Array.fromAsync(glob.scan());
        Bun.gc(true);
        console.log(JSON.stringify({ deltaMiB: (rss() - before) / 1024 / 1024 }));
      `,
      );
    },
    timeout,
  );
});
