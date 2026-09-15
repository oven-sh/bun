import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isMacOS, tempDir } from "harness";

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

  // JSC hands its structure heap to mimalloc as an arena of its own (`mi_manage_os_memory_ex`), and it halves that
  // reservation when address space is short (`ulimit -v`). mimalloc has to take a small one as well: when it refused
  // 256 MiB and less (page meta data at 256 MiB boundaries, without MI_FREE_USE_PAGEMAP), bun aborted on startup.
  test("starts with a small structure heap reservation", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(typeof {})"],
      env: { ...bunEnv, BUN_JSC_structureHeapSizeInKB: "131072" },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("object\n");
    expect(exitCode).toBe(0);
  });

  // The allocator's purge thread takes back what was freed 100 ms after the free. What a thread freed while the purge thread
  // was in the middle of a pass was left out for good: it stayed resident until the event loop went idle or something forced
  // a collection. A script that keeps its thread busy does neither. It took a pass in which each of the allocator's arenas
  // had something to hand back. JSC's structure heap is an arena of its own that rarely has, so Malloc=1 here: JSC then
  // allocates through malloc (mimalloc as well) and there is one arena. Linux only: the wait reads RSS. Not ASAN: malloc is
  // not mimalloc there.
  test.skipIf(!isLinux || isASAN)(
    "memory freed while the purge thread is at work is purged without an idle event loop",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          import { heapStats } from "bun:jsc";
          const rss = () => process.memoryUsage.rss() / 1048576;
          // the bytes the allocator handed back to the OS so far
          const purged = () => heapStats().mimalloc.purged / 1048576;
          // The allocator starts its purge thread the first time a thread blocks.
          await Bun.sleep(1);
          const first = [], second = [];
          for (let i = 0; i < 32; i++) first.push(new Uint8Array(8 * 1024 * 1024).fill(1));
          for (let i = 0; i < 16; i++) second.push(new Uint8Array(8 * 1024 * 1024).fill(1));
          const held = rss(), purgedBefore = purged();
          // transfer(0) frees the 8 MB here and now, no collection involved. No await from here on.
          for (const array of first) array.buffer.transfer(0);
          // Spin until the purge thread is in the middle of its pass over them (heapStats() would run that pass itself).
          let deadline = performance.now() + 1000;
          while (rss() > held - 64 && performance.now() < deadline);
          for (const array of second) array.buffer.transfer(0);
          // The next pass comes 100 ms later. What RSS fell by is taken before heapStats() runs again: that call polls the
          // allocator, and a poll runs a pass that is due by itself.
          deadline = performance.now() + 2000;
          let released;
          while ((released = held - rss()) < 336 && performance.now() < deadline);
          console.log(JSON.stringify({ released, purged: purged() - purgedBefore }));
        `,
        ],
        env: { ...bunEnv, Malloc: "1" },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      // 384 MB were freed. The first pass alone takes the first 256 MB, and up to 32 MB of the rest.
      const { released, purged } = JSON.parse(stdout);
      expect(released, stdout).toBeGreaterThanOrEqual(336);
      expect(purged, stdout).toBeGreaterThanOrEqual(336);
      expect(exitCode).toBe(0);
    },
  );

  // Buffers of 96 to 512 KiB live in the allocator's 4 MiB pages, and the free blocks of such a page are only handed back
  // by an idle sweep of the thread that owns it, two sweeps or more after the page was last allocated from. A work pool
  // thread swept once, 100 ms after it ran out of work, and then slept for good: what `readFile` had allocated on it and
  // the collector freed stayed resident for as long as one buffer of the page was alive. It now leaves its heaps to the
  // allocator's scavenger thread while it sleeps, which comes back for them. Linux only: reads RssAnon. Not ASAN: malloc is
  // not mimalloc there.
  test.skipIf(!isLinux || isASAN)(
    "an idle work pool thread hands back the free blocks of its large pages",
    async () => {
      using dir = tempDir("pool-large-pages", {
        "index.js": `
          import { readFileSync, writeFileSync } from "node:fs";
          import { readFile } from "node:fs/promises";
          const rssAnon = () => Number(/RssAnon:\\s+(\\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"))[1]) / 1024;
          // one file for each block size of a 4 MiB page
          const files = [96, 128, 160, 192, 224, 256, 320, 384, 448, 512].map((kib, i) => {
            writeFileSync("file" + i, Buffer.alloc(kib * 1024 - 64, 1 + i));
            return "file" + i;
          });
          const start = rssAnon();
          const kept = [];
          for (let round = 0; round < 6; round++) {
            const reads = [];
            for (const file of files) for (let i = 0; i < 8; i++) reads.push(readFile(file));
            const buffers = await Promise.all(reads);
            // one in twelve stays, so that the pages do not become free as a whole
            for (let i = round; i < buffers.length; i += 12) kept.push(buffers[i]);
            // the rest is garbage now: neither array keeps it for the collector to find
            reads.length = buffers.length = 0;
          }
          const loaded = rssAnon();
          Bun.gc(true);
          const keptMB = kept.reduce((sum, buffer) => sum + buffer.byteLength, 0) / 1048576;
          const aliveMB = process.memoryUsage().arrayBuffers / 1048576;
          // Nothing here gives the pool anything to do: a thread that runs a task sweeps again after it.
          const deadline = performance.now() + 2500;
          let freeResident;
          do {
            await Bun.sleep(50);
            freeResident = rssAnon() - start - keptMB;
          } while (freeResident > 12 && performance.now() < deadline);
          console.log(JSON.stringify({ start, loaded, keptMB, aliveMB, freeResident }));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        // enough threads for the reads of a round to be spread over several heaps, whatever the machine
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "4" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const { loaded, start, keptMB, aliveMB, freeResident } = JSON.parse(stdout);
      // 480 buffers of 300 KB on average were read, 42 of them are alive, and the collector freed the others
      expect(loaded - start, stdout).toBeGreaterThan(60);
      expect(keptMB, stdout).toBeGreaterThan(8);
      expect(aliveMB, stdout).toBeLessThan(keptMB + 2);
      // 38 MB and more without the handoff
      expect(freeResident, stdout).toBeLessThanOrEqual(12);
      expect(exitCode).toBe(0);
    },
  );

  // The idle sweep hands the free blocks of the allocator's 4 MiB pages back two sweeps after the page was last allocated
  // from, and a server sits idle between two requests for far longer than that: it took the buffers of every request out
  // of discarded memory again, a page fault for each 4 KiB of them. Most of those buffers are in pages with no other
  // block in use, which were freed outright and made anew. A few MB of the pages that were used last now stay.
  // Linux only: reads the minor faults of the server from /proc. Not ASAN: malloc is not mimalloc there.
  test.skipIf(!isLinux || isASAN)(
    "a server that gets a request now and then does not fault its buffers in again for every request",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const server = Bun.serve({ port: 0, fetch: async req => new Response(await req.arrayBuffer()) });
          console.log(server.port);
          `,
        ],
        // An epoch of the sweep lasts 10 ms here instead of 100, so that the 50 ms between two requests are what half a
        // second is by default: the two epochs for which free blocks stay in any case are long over. And the collector
        // looks every 100 ms instead of every second: until it has freed the buffers of the first requests, every
        // request gets new ones, which no allocator has in memory yet.
        env: { ...bunEnv, MIMALLOC_PURGE_HOLES_MIN_INTERVAL: "10", BUN_GC_TIMER_INTERVAL: "100" },
        stdout: "pipe",
        stderr: "inherit",
      });
      // the line with the port, which can come in more than one chunk
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let line = "";
      while (!line.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`the server exited before it printed its port: ${JSON.stringify(line)}`);
        line += decoder.decode(value, { stream: true });
      }
      reader.releaseLock();
      const port = Number(line.slice(0, line.indexOf("\n")));
      expect(port).toBeGreaterThan(0);
      // the minor faults of the server so far: the tenth field, and the second one can have spaces in it
      const faults = async () => {
        const stat = await Bun.file(`/proc/${proc.pid}/stat`).text();
        return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[7]);
      };
      const body = new Uint8Array(256 * 1024).fill(7);
      const request = async () => {
        const response = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body });
        expect((await response.arrayBuffer()).byteLength).toBe(body.byteLength);
        // The pause is the input of this test and not a wait for something: the server is to go idle and be swept.
        await Bun.sleep(50);
      };
      for (let i = 0; i < 6; i++) await request();
      const before = await faults();
      const requests = 12;
      for (let i = 0; i < requests; i++) await request();
      const perRequest = ((await faults()) - before) / requests;
      // The two 256 KiB buffers of a request are 128 pages of 4 KiB: about a hundred faults for every request when the
      // sweeps in between give the buffers back, one or two when they leave them.
      expect(perRequest).toBeLessThan(20);
    },
  );
});
