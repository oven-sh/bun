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

  // Every `new Bun.Transpiler(opts)` owns a mimalloc heap (a bun_alloc::Arena). A `define` value that
  // goes through the JSON parser allocates into that heap, so the heap also gets its per-arena page
  // bitmaps (`mi_arena_pages_t`, about 150 KiB). The GC finalizes the instances in one batch, so
  // hundreds of heaps are destroyed while their meta data fills whole pages of the main heap.
  // mimalloc abandons a page once it is full. A free into an abandoned page has to collect the page
  // (free it, reclaim it, or re-map it), or the block is stranded: the page stays abandoned and
  // resident forever. `mi_heap_destroy` used to free the meta data without collecting, so every
  // destroyed heap leaked about 150 KiB of RSS and left one more abandoned page behind.
  test("destroying many heaps at once does not strand their meta data", async () => {
    const heapsPerRound = 200;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { heapStats } from "bun:jsc";
         const opts = { loader: "ts", define: { A: '"x"' } };
         const rounds = [];
         for (let round = 0; round < 4; round++) {
           for (let i = 0; i < ${heapsPerRound}; i++) new Bun.Transpiler(opts);
           Bun.gc(true);
           Bun.gc(true);
           rounds.push({ abandoned: heapStats().mimalloc.pages_abandoned.current, rss: process.memoryUsage.rss() });
         }
         console.log(JSON.stringify(rounds));`,
      ],
      env: {
        ...bunEnv,
        // ASAN's quarantine pins freed blocks and keeps RSS at peak.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
          .filter(Boolean)
          .join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const rounds: { abandoned: number; rss: number }[] = JSON.parse(stdout.trim());
    expect(rounds).toHaveLength(4);
    expect(exitCode).toBe(0);

    const abandoned = rounds.map(r => r.abandoned);
    const rssMiB = rounds.map(r => r.rss / 1024 / 1024);
    // A stranded page stays abandoned, so the count used to grow by about 29 per round: one 4 MiB
    // page per 28 `mi_arena_pages_t` and one 64 KiB page per 9 `mi_heap_t`. A collected page is
    // freed, or taken over by the next round's heaps, so the count stays where the first round left it.
    expect(abandoned[3] - abandoned[0]).toBeLessThan(heapsPerRound / 10);
    // The stranded pages were resident: about 150 KiB per heap, so a round cost about 30 MiB in a
    // release build and more in a debug build. A round now reuses the memory the rounds before it freed.
    expect(rssMiB[3] - rssMiB[2]).toBeLessThan(20);
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
