// Every Bun.Transpiler owns a mimalloc heap (bun_alloc::Arena) that is destroyed
// when the GC finalizes the instance. mimalloc's mi_heap_destroy freed the heap's
// meta data (mi_heap_t, mi_arena_pages_t, its theap) without collecting the page
// it lives in. Once enough heaps were alive at the same time to fill that page,
// the page was abandoned and never found again, so each finalized instance leaked
// about 7 KiB, or about 150 KiB when its arena had allocated (a define value that
// needs the JSON parser does that). GC finalizes instances in batches, so every
// instance hit the full-page case. patches/mimalloc/free-heap-metadata-in-full-pages.patch
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

test("finalized Bun.Transpiler instances release their native memory", async () => {
  const fixture = `
    const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
    const n = 1500;
    // Keep 64 instances alive so that every finalizer runs while many heaps exist.
    const live = new Array(64);
    Bun.gc(true);
    const before = rss();
    for (let i = 0; i < n; i++) {
      live[i % live.length] = new Bun.Transpiler({ define: { "process.env.LEAK_PROBE": "1" } });
    }
    live.fill(undefined);
    Bun.gc(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    Bun.gc(true);
    const after = rss();
    console.log(JSON.stringify({ delta_mb: (after - before) / 1024 / 1024 }));
  `;

  const env = { ...bunEnv };
  if (isASAN) {
    // ASAN's allocator keeps freed chunks around. Shrink that so RSS follows the
    // mimalloc heaps this test is about.
    env.ASAN_OPTIONS = [env.ASAN_OPTIONS, "quarantine_size_mb=1", "allocator_release_to_os_interval_ms=0"]
      .filter(Boolean)
      .join(":");
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
    stdout: expect.stringMatching(/^\{"delta_mb":/),
    exitCode: 0,
  });
  const { delta_mb } = JSON.parse(stdout);
  // Before the fix: 225 MB in release and over 600 MB in debug+ASAN for n=1500.
  // After: under 10 MB in release, about 55 MB in debug+ASAN.
  expect(delta_mb).toBeLessThan(120);
}, 120_000);
