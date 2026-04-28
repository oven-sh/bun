import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Each .on() / .onDocument() call heap-allocates an ElementHandler / DocumentHandler
// struct via bun.default_allocator. When the HTMLRewriter is garbage-collected,
// LOLHTMLContext.deinit() must destroy those allocations. Previously it only
// unprotected the held JSValues and leaked the struct memory.
//
// Measuring the leak:
//  - The handler structs live in mimalloc (bun.default_allocator), so in debug
//    builds (where mimalloc stats are compiled in) we can read the live-heap
//    counter directly from `heapStats().mimalloc.malloc_normal.current`. This is
//    exact and unaffected by ASAN quarantine / page retention.
//  - In release builds mimalloc stats are compiled out (all zeros), so we fall
//    back to RSS, which is stable there since there is no ASAN.
test("HTMLRewriter does not leak element/document handler allocations", async () => {
  const code = /* js */ `
      const { heapStats } = require("bun:jsc");
      const noop = { element() {}, comments() {}, text() {} };
      const docNoop = { doctype() {}, comments() {}, text() {}, end() {} };

      function once() {
        const rw = new HTMLRewriter();
        for (let i = 0; i < 32; i++) rw.on("div", noop);
        for (let i = 0; i < 32; i++) rw.onDocument(docNoop);
      }

      // Warm up so allocator arenas / JIT / JSC structures stabilize.
      for (let i = 0; i < 500; i++) once();
      Bun.gc(true);

      const haveMimallocStats = heapStats().mimalloc.malloc_normal.total > 0;
      const beforeMi = heapStats().mimalloc.malloc_normal.current;
      const beforeRss = process.memoryUsage.rss();

      for (let i = 0; i < 4000; i++) once();
      Bun.gc(true);

      const afterMi = heapStats().mimalloc.malloc_normal.current;
      const afterRss = process.memoryUsage.rss();

      const miDeltaMB = (afterMi - beforeMi) / 1024 / 1024;
      const rssDeltaMB = (afterRss - beforeRss) / 1024 / 1024;
      process.stdout.write(JSON.stringify({ haveMimallocStats, miDeltaMB, rssDeltaMB }) + "\\n");
    `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", code],
    env: {
      ...bunEnv,
      // ASAN's freed-block quarantine inflates RSS with transient lol-html
      // builder allocations; it is irrelevant to what we're measuring.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.replaceAll(/^WARNING:.*\n/gm, "")).toBe("");
  expect(exitCode).toBe(0);

  const { haveMimallocStats, miDeltaMB, rssDeltaMB } = JSON.parse(stdout.trim());

  if (haveMimallocStats) {
    // 4000 * 64 handlers * ~48 bytes each => ~12-20 MB when leaking; ~0 MB when fixed.
    expect(miDeltaMB).toBeLessThan(4);
  } else {
    // Release builds: no ASAN, RSS tracks the real leak closely.
    // Without the fix this is ~30-50 MB; with the fix it is a few MB at most.
    expect(rssDeltaMB).toBeLessThan(20);
  }
}, 120_000);
