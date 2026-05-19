// https://github.com/oven-sh/bun/issues/21560
// https://github.com/oven-sh/bun/issues/27514
//
// `Bun.gc(true)` ran a sync JS GC and called `mi_collect(false)`, but never
// scavenged libpas (JSC's allocator) or forced a mimalloc purge. So after GC
// freed ArrayBuffer contents / WTF::StringImpl bodies into libpas page
// caches, and Blob bytes / external payloads into mimalloc thread heaps,
// RSS stayed at peak even though the JS heap was empty. Under sustained
// allocation churn this ratchets RSS toward OOM while heap stats look flat.
//
// Linux-only: only on Linux does `madvise(MADV_DONTNEED)` make the kernel
// drop pages from RSS immediately. macOS uses `MADV_FREE_REUSABLE` (lazy,
// reclaimed only under pressure) and Windows uses `VirtualAlloc(MEM_RESET)`
// (stays in the working set), so `process.memoryUsage().rss` doesn't move
// there even though the fix is working. The runtime change applies on every
// platform; only the RSS-based measurement here is non-portable.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

test.skipIf(!isLinux)("Bun.gc(true) returns freed libpas/mimalloc pages to the OS (#21560)", async () => {
  // Churn a mixed workload (typed arrays -> libpas Gigacage, large strings
  // -> libpas FastCompactMalloc) through a rolling window so the allocators
  // build up a page cache, then drop everything and Bun.gc(true). Measure
  // how much of the peak RSS growth is released.
  const fixture = `
    const hold = 8;
    const iters = 200;
    const ring = new Array(hold);

    function round(r) {
      const ta = new Uint8Array(2_000_000);
      for (let i = 0; i < ta.length; i += 4096) ta[i] = r & 0xff;
      const s = Buffer.alloc(2_000_000, (r & 0x7f) | 0x20).toString("latin1");
      return { ta, s };
    }

    const start = process.memoryUsage().rss;
    let peak = start;
    for (let r = 1; r <= iters; r++) {
      ring[r % hold] = round(r);
      const rss = process.memoryUsage().rss;
      if (rss > peak) peak = rss;
    }
    for (let i = 0; i < ring.length; i++) ring[i] = undefined;

    Bun.gc(true);

    const final = process.memoryUsage().rss;
    const growth = peak - start;
    const released = peak - final;
    const pct = (released / growth) * 100;
    console.log(JSON.stringify({
      startMB: (start / 1048576).toFixed(1),
      peakMB: (peak / 1048576).toFixed(1),
      finalMB: (final / 1048576).toFixed(1),
      growthMB: (growth / 1048576).toFixed(1),
      releasedPct: pct.toFixed(1),
    }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { startMB, peakMB, finalMB, growthMB, releasedPct } = JSON.parse(stdout);
  console.log({ startMB, peakMB, finalMB, growthMB, releasedPct });

  // 8 rounds live * ~4MB each = ~32MB minimum working set; RSS growth must
  // be meaningful or the released% assertion below proves nothing.
  expect(Number(growthMB)).toBeGreaterThan(20);

  // Without the fix: ~0% released (libpas/mimalloc keep the pages until the
  // background pas_scavenger / mimalloc purge timer runs, which never gets
  // ahead under churn). With the fix: consistently >90% released.
  expect(Number(releasedPct)).toBeGreaterThan(50);
  expect(exitCode).toBe(0);
});
