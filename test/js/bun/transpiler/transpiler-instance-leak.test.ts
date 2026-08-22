// Every Bun.Transpiler owns a mimalloc heap (bun_alloc::Arena) that is destroyed
// when the GC finalizes the instance. mimalloc's mi_heap_destroy freed the heap's
// meta data (mi_heap_t, mi_arena_pages_t, its theap) without collecting the page
// it lives in. Once enough heaps were alive at the same time to fill that page,
// the page was abandoned and never found again, so each finalized instance leaked
// about 7 KiB, or about 150 KiB when its arena had allocated (a define value that
// needs the JSON parser does that). GC finalizes instances in batches, so every
// instance hit the full-page case. patches/mimalloc/free-heap-metadata-in-full-pages.patch
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("finalized Bun.Transpiler instances release their native memory", async () => {
  const fixture = `
    const { heapStats } = require("bun:jsc");
    const committed = () => heapStats().mimalloc.committed.current;
    const n = 1500;
    // Keep 64 instances alive so that every finalizer runs while many heaps exist.
    const live = new Array(64);
    Bun.gc(true);
    const before = committed();
    for (let i = 0; i < n; i++) {
      live[i % live.length] = new Bun.Transpiler({ define: { "process.env.LEAK_PROBE": "1" } });
    }
    live.fill(undefined);
    Bun.gc(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    Bun.gc(true);
    const after = committed();
    console.log(JSON.stringify({ delta_mb: (after - before) / 1024 / 1024 }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
    stdout: expect.stringMatching(/^\{"delta_mb":/),
    exitCode: 0,
  });
  const { delta_mb } = JSON.parse(stdout);
  // mimalloc's committed memory. Before the fix it grew by about 150 KiB per
  // instance: 225 MB for n=1500, in release and debug builds alike. After the
  // fix it stays within a few MB of where it started.
  expect(delta_mb).toBeLessThan(100);
}, 120_000);
