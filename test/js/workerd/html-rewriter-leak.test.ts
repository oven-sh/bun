import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Each .on() / .onDocument() call heap-allocates an ElementHandler / DocumentHandler
// struct via bun.default_allocator. When the HTMLRewriter is garbage-collected,
// LOLHTMLContext.deinit() must destroy those allocations. Previously it only
// unprotected the held JSValues and leaked the struct memory.
//
// Measuring the leak:
//  - The handler structs live in mimalloc (bun.default_allocator), so in debug
//    builds (where mimalloc stats are compiled in) we read the live-heap counter
//    from `heapStats().mimalloc.malloc_normal.current`. This is exact and
//    unaffected by ASAN quarantine / page retention.
//  - In release builds mimalloc stats are compiled out (all zeros), so we fall
//    back to RSS. RSS carries allocator-arena retention noise (notably on
//    Windows), so the release path uses a much bigger warmup + workload to make
//    the actual leak dominate that noise. Release is fast enough that 20k
//    iterations still finish in well under a second.
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

      // Probe whether mimalloc stats are being collected (debug builds only).
      once();
      Bun.gc(true);
      const haveMimallocStats = heapStats().mimalloc.malloc_normal.total > 0;

      // In release (no mimalloc stats) use a much larger workload so the
      // handler leak dwarfs RSS noise from allocator arena retention.
      const warmup = haveMimallocStats ? 500 : 4000;
      const iterations = haveMimallocStats ? 4000 : 16000;

      // GC every batch instead of once at the end. With a single trailing GC
      // the lol-html builder allocations (Rust side) for all N rewriters are
      // live simultaneously, then freed in one burst. Under ASAN those go
      // through the sanitizer allocator, which never returns freed pages to
      // the OS, so RSS pins at the peak live set (~230 MB at 16k iterations)
      // regardless of whether the Zig-side handler structs leak. Batched GC
      // bounds the live set so RSS only tracks the *retained* handler structs
      // — exactly the leak being measured.
      const batch = 1000;
      function spin(n) {
        for (let i = 0; i < n; i += batch) {
          for (let j = 0; j < batch && i + j < n; j++) once();
          Bun.gc(true);
        }
      }

      spin(warmup);

      const beforeMi = heapStats().mimalloc.malloc_normal.current;
      const beforeRss = process.memoryUsage.rss();

      spin(iterations);

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

  const filteredStderr = stderr
    .split("\n")
    .filter(line => !line.startsWith("WARNING: ASAN interferes"))
    .join("\n")
    .trim();
  expect(filteredStderr).toBe("");

  const { haveMimallocStats, miDeltaMB, rssDeltaMB } = JSON.parse(stdout.trim());

  if (haveMimallocStats) {
    // 4000 * 64 handlers * ~48 bytes each => ~12-20 MB when leaking; ~0 MB when fixed.
    expect(miDeltaMB).toBeLessThan(4);
  } else {
    // Release: 16000 * 64 handlers * ~48 bytes each => ~49 MB of leaked handler
    // structs (plus overhead) when leaking; a few MB of arena churn when fixed.
    expect(rssDeltaMB).toBeLessThan(30);
  }

  expect(exitCode).toBe(0);
}, 120_000);
