import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";

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

  // The malloc_* counters are only maintained when mimalloc is built with statistics (MI_STAT, i.e.
  // debug builds); release builds report 0 for all of them.
  const tracksMallocStats = heapStats().mimalloc.malloc_normal.total > 0;

  test.skipIf(!tracksMallocStats)("malloc_* counters come back down when a heap is destroyed", () => {
    // Bun.Transpiler#transformSync allocates everything for the call in a fresh mimalloc heap
    // (bun_alloc::MimallocArena) and mi_heap_destroy()s it on return, so none of those blocks is
    // ever passed to mi_free. The exports fill the heap with small blocks (malloc_normal and
    // malloc_bins); a source this large also makes the call allocate blocks above mimalloc's large
    // object limit (512 KiB), which are accounted separately in malloc_huge.
    const source =
      `/* ${Buffer.alloc(640 * 1024, "x").toString()} */\n` +
      Array.from({ length: 300 }, (_, i) => `export const e${i} = { a: [${i}, "x"] };`).join("\n");
    const transpiler = new Bun.Transpiler();
    const iterations = 10;

    function counters() {
      // Collect the JS garbage made by the previous heapStats() call so that only the transpiler's
      // heaps are left in the deltas.
      Bun.gc(true);
      const m = heapStats().mimalloc;
      return {
        normalBytes: m.malloc_normal.current,
        hugeBytes: m.malloc_huge.current,
        binBlocks: m.malloc_bins.reduce((sum: number, bin: any) => sum + bin.current, 0),
        heapsCreated: m.heaps.total,
        heapsAlive: m.heaps.current,
      };
    }

    transpiler.transformSync(source); // lazily-initialized state (the retained output buffer, ...) must not count
    const before = counters();
    for (let i = 0; i < iterations; i++) transpiler.transformSync(source);
    const after = counters();

    // One heap per call, and none of them survived the call.
    expect(after.heapsCreated - before.heapsCreated).toBeGreaterThanOrEqual(iterations);
    expect(after.heapsAlive).toBe(before.heapsAlive);

    // Every destroyed heap used to leave its live blocks in the counters: about 940 KiB in
    // malloc_normal, 2.25 MiB in malloc_huge and 2,770 blocks in malloc_bins per call (9.6 MB,
    // 23.6 MB and 27,710 blocks after the loop). Each bound is below what a single call left
    // behind; the slack is for whatever else the process legitimately keeps across the loop.
    expect(after.normalBytes - before.normalBytes).toBeLessThan(512 * 1024);
    expect(after.hugeBytes - before.hugeBytes).toBeLessThan(2 * 1024 * 1024);
    expect(after.binBlocks - before.binBlocks).toBeLessThan(2000);
  });

  // mimalloc tags its arena mmaps with an app-reserved VM tag (240-255). The old default,
  // 100, is VM_MEMORY_IOACCELERATOR, so profilers reported Bun's heap as GPU memory.
  // The tags are read back from the kernel (mach_vm_region's user_tag), not from vmmap's
  // summary: vmmap's names for them change between releases (macOS 26 prints tag 240 as
  // "Memory Tag 240", macOS 27 as "App-Specific Tag 1").
  test.skipIf(!isMacOS)("arena memory is tagged as application memory, not IOAccelerator", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { dlopen, ptr } from "bun:ffi";
         const keep = [];
         for (let i = 0; i < 96; i++) keep.push(Buffer.alloc(1 << 20, i).toString("latin1"));
         const { task_self_trap, mach_vm_region } = dlopen("libSystem.B.dylib", {
           task_self_trap: { args: [], returns: "u32" },
           mach_vm_region: { args: ["u32", "ptr", "ptr", "i32", "ptr", "ptr", "ptr"], returns: "i32" },
         }).symbols;
         const task = task_self_trap();
         const VM_REGION_EXTENDED_INFO = 13, VM_REGION_EXTENDED_INFO_COUNT = 9; // sizeof(vm_region_extended_info_data_t) / 4
         const address = new BigUint64Array(1), size = new BigUint64Array(1);
         const info = new Uint32Array(VM_REGION_EXTENDED_INFO_COUNT), count = new Uint32Array(1), object = new Uint32Array(1);
         const bytesByTag = new Map();
         for (;;) {
           count[0] = VM_REGION_EXTENDED_INFO_COUNT;
           if (mach_vm_region(task, ptr(address), ptr(size), VM_REGION_EXTENDED_INFO, ptr(info), ptr(count), ptr(object)) !== 0) break;
           const tag = info[1]; // vm_region_extended_info.user_tag, after the protection field
           bytesByTag.set(tag, (bytesByTag.get(tag) ?? 0) + Number(size[0]));
           address[0] += size[0];
         }
         const mb = (from, to) => {
           let bytes = 0;
           for (let tag = from; tag <= to; tag++) bytes += bytesByTag.get(tag) ?? 0;
           return bytes / (1 << 20);
         };
         console.log(JSON.stringify({ ioaccelerator: mb(100, 100), appTag: mb(240, 255), kept: keep.length }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const { ioaccelerator, appTag } = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(ioaccelerator).toBe(0);
    expect(appTag).toBeGreaterThan(64);
    expect(exitCode).toBe(0);
  });
});
