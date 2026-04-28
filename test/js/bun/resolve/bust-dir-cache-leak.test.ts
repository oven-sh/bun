import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Resolver.bustDirCache() only dropped the hash→index mapping in BSSMap; the
// backing DirInfo slot was orphaned (along with whatever heap pointers it
// owned), and the next lookup of the same directory allocated a fresh slot.
// Over a long --hot / --watch / FileSystemRouter.reload() session this grew
// without bound — first exhausting the 2048-entry BSS backing_buf, then
// spilling into heap overflow blocks forever. The fix reclaims the slot so
// put() overwrites it in place.
test("bustDirCache reuses DirInfo and EntriesOption slots across repeated reloads", async () => {
  // A tree of route directories so each reload() busts and re-resolves many
  // DirInfo + EntriesOption slots. FileSystemRouter.reload() calls
  // bustDirCacheRecursive which readDirInfo()s every directory, busts it, then
  // re-resolves from the root — exactly the bust/getOrPut/put cycle that used
  // to burn a fresh backing_buf slot.
  using dir = tempDir("bust-dir-cache-leak", {
    "pages/index.tsx": "export default 1;",
    "pages/a/index.tsx": "export default 1;",
    "pages/a/n/index.tsx": "export default 1;",
    "pages/b/index.tsx": "export default 1;",
    "pages/b/n/index.tsx": "export default 1;",
    "pages/c/index.tsx": "export default 1;",
    "pages/c/n/index.tsx": "export default 1;",
    "pages/d/index.tsx": "export default 1;",
    "pages/d/n/index.tsx": "export default 1;",
    "run.ts": `
      const router = new Bun.FileSystemRouter({
        dir: import.meta.dir + "/pages",
        style: "nextjs",
      });
      void router.routes;

      const warmup = 200;
      const iters = 4000;

      for (let i = 0; i < warmup; i++) router.reload();
      Bun.gc(true);
      const before = process.memoryUsage.rss();

      for (let i = 0; i < iters; i++) router.reload();
      Bun.gc(true);
      const after = process.memoryUsage.rss();

      const perIter = Math.round((after - before) / iters);
      console.log(JSON.stringify({ perIter }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { perIter } = JSON.parse(stdout.trim().split("\n").at(-1)!);
  // Without slot reuse, each reload() of this 9-directory tree leaks roughly
  // 14 KB/iteration in release (9 DirInfo + 9 EntriesOption structs in overflow
  // blocks, plus DirnameStore duplicates). With the fix, slots are overwritten
  // in place and growth drops to the low single-digit KB from unrelated
  // dirname-store appends.
  expect(perIter).toBeLessThan(7 * 1024);
  expect(exitCode).toBe(0);
}, 60_000);
