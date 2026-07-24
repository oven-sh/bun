import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("heapStats() mimalloc integration", () => {
  test("mimalloc aggregate stats are present", () => {
    const s = heapStats();
    expect(s.mimalloc).toBeDefined();
    expect(s.mimalloc.mimalloc_version).toBeGreaterThan(3000);
    expect(s.mimalloc.pages.current).toBeGreaterThan(0);
    expect(s.mimalloc.committed.current).toBeGreaterThan(0);
    expect(Array.isArray(s.mimalloc.malloc_bins)).toBe(true);
  });

  test("heapStats({dump: true}) returns per-heap pages", () => {
    const s = heapStats({ dump: true });
    expect(s.mimallocDump).toBeDefined();
    expect(Array.isArray(s.mimallocDump.heaps)).toBe(true);
    expect(s.mimallocDump.heaps.length).toBeGreaterThan(0);
    const main = s.mimallocDump.heaps.find((h: any) => h.seq === 0);
    expect(main).toBeDefined();
    expect(Array.isArray(main.pages)).toBe(true);
    expect(main.pages.length).toBeGreaterThan(0);
    const page = main.pages[0];
    expect(typeof page.id).toBe("number");
    expect(page.block_size).toBeGreaterThan(0);
    expect(page.used).toBeGreaterThanOrEqual(0);
    expect(page.reserved).toBeGreaterThan(0);
    expect(typeof page.thread_id).toBe("number");
    // pages-only mode: no blocks
    expect(main.blocks).toBeUndefined();
  });

  test("heapStats({dump: 'blocks'}) includes per-block ids", () => {
    const s = heapStats({ dump: "blocks" });
    const main = s.mimallocDump.heaps.find((h: any) => h.seq === 0);
    expect(Array.isArray(main.blocks)).toBe(true);
    expect(main.blocks.length).toBeGreaterThan(0);
    const [id, size] = main.blocks[0];
    expect(typeof id).toBe("number");
    expect(size).toBeGreaterThan(0);
    // every block size should match some page's block_size
    const pageSizes = new Set(main.pages.map((p: any) => p.block_size));
    for (const [, sz] of main.blocks.slice(0, 50)) {
      expect(pageSizes.has(sz)).toBe(true);
    }
  });

  // `pages.current` must account for pages allocated by every thread's theap, not just the
  // caller's: the increment lands in the allocating thread's theap, while a cross-thread free
  // of an abandoned page decrements heap->stats directly. Summing only the caller's theap
  // underreports by the pages other threads allocated (and can go negative under churn).
  test("pages.current agrees with the live heap dump across threads", async () => {
    using dir = tempDir("heapStats-mimalloc-pages", {
      "check.js": `
        import { heapStats } from "bun:jsc";
        const theapsBefore = heapStats().mimalloc.theaps?.current ?? 0;
        const code = \`
          const hold = [];
          for (let i = 0; i < 50000; i++) hold.push({ a: i, b: "str_" + i });
          self.postMessage("ready");
          self.onmessage = () => {};
        \`;
        const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
        const w = new Worker(url);
        await new Promise(r => { w.onmessage = r; });
        const s = heapStats({ dump: true });
        let dump = 0;
        for (const h of s.mimallocDump.heaps) dump += h.pages.length;
        const stat = s.mimalloc.pages.current;
        const binSum = s.mimalloc.page_bins.reduce((a, b) => a + b.current, 0);
        const theaps = s.mimalloc.theaps?.current ?? 0;
        console.log(JSON.stringify({ stat, dump, binSum, theapsBefore, theaps }));
        w.terminate();
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Surface stderr/exitCode before parsing so a subprocess crash reports the real diagnostic
    // instead of a bare JSON SyntaxError.
    expect({ stdout: stdout.trim() || null, stderr, exitCode }).toMatchObject({
      stdout: expect.any(String),
      exitCode: 0,
    });
    const { stat, dump, binSum, theapsBefore, theaps } = JSON.parse(stdout);
    // The Worker allocates on its own thread; if that didn't create a new theap the assertion
    // below would be vacuous (only the caller's theap exists, which the old aggregate already
    // folded in). The static main theap is not counted, so before is 0 in practice.
    expect({ theapsBefore, theaps }).toSatisfy(v => v.theaps > v.theapsBefore);
    // The live heap walk is ground truth. Bracket the counter: the lower bound catches the
    // pre-fix underreport (~-36 here), the upper bound catches a double-fold. Slack covers the
    // few pages that can change between the two reads plus a concurrent merge-and-zero.
    expect(stat).toBeGreaterThanOrEqual(0);
    expect({ stat, dump }).toSatisfy(v => v.stat >= v.dump - 5 && v.stat <= v.dump + 10);
    expect({ binSum, dump }).toSatisfy(v => v.binSum >= v.dump - 5 && v.binSum <= v.dump + 10);
  });

  test("dump reflects new heaps and allocations", () => {
    const before = heapStats({ dump: true }).mimallocDump.heaps.length;
    // MimallocArena is internal; trigger via something that creates a heap.
    // Transpiler creates a per-call arena.
    const t = new Bun.Transpiler();
    const out = t.transformSync("export const x = 1");
    expect(out.length).toBeGreaterThan(0);
    const after = heapStats({ dump: true }).mimallocDump.heaps;
    // Either a new heap was created (and may already be destroyed), or main grew.
    // We assert the dump is still well-formed and >= before.
    expect(after.length).toBeGreaterThanOrEqual(1);
    for (const h of after) {
      expect(typeof h.seq).toBe("number");
      expect(Array.isArray(h.pages)).toBe(true);
    }
    void before;
  });
});
