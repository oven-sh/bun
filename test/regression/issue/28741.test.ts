import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

// https://github.com/oven-sh/bun/issues/28741
// `Bun.gc(true)` called `mimalloc_cleanup(false)` BEFORE running the JS GC.
// The JS GC is what actually invokes finalizers (Blob → Store.deref → mi_free),
// so when it ran there was no subsequent mimalloc collection pass and the
// freed pages stayed cached on mimalloc's per-thread heaps instead of being
// returned to the OS. RSS stayed at peak even after every Blob was collected.
//
// Fix: call `mimalloc_cleanup(true)` after `runGC(true)` so mimalloc actually
// reclaims pages freed by finalizers.
//
// Linux-only: only on Linux does mimalloc's post-cleanup `madvise(MADV_DONTNEED)`
// cause the kernel to immediately evict pages and drop RSS. macOS uses
// `MADV_FREE_REUSABLE` (lazy — reclaimed only under memory pressure) and
// Windows uses `VirtualAlloc(MEM_RESET)` (stays in the working set), so
// `process.memoryUsage().rss` doesn't move on those platforms even though
// the fix is working. The runtime change applies everywhere; only the
// `rss`-based measurement is non-portable.
test.skipIf(!isLinux)("fetch response body memory is reclaimed by GC", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const BODY_SIZE = 1.5 * 1024 * 1024;
const FETCH_COUNT = 50;
const body = Buffer.alloc(BODY_SIZE, 0x42);

await using server = Bun.serve({
  port: 0,
  fetch() { return new Response(body); },
});

const startRss = process.memoryUsage().rss;

// Wrap in an async function so the blobs/responses go out of scope on return
// and become eligible for GC. (Top-level \`await\` in JSC keeps local bindings
// alive in the module's async state machine — that's a separate limitation.)
async function run() {
  let blobs = [];
  for (let i = 0; i < FETCH_COUNT; i++) {
    const res = await fetch("http://localhost:" + server.port + "/");
    blobs.push(await res.blob());
  }
}
await run();
const peakRss = process.memoryUsage().rss;

Bun.gc(true);
await new Promise(r => setTimeout(r, 300));
Bun.gc(true);

const finalRss = process.memoryUsage().rss;
const growth = peakRss - startRss;
const released = peakRss - finalRss;
const pct = growth > 0 ? (released / growth) * 100 : 100;

console.log(JSON.stringify({
  startMB: (startRss/1e6).toFixed(1),
  peakMB: (peakRss/1e6).toFixed(1),
  finalMB: (finalRss/1e6).toFixed(1),
  releasedPct: pct.toFixed(1),
}));

// Baseline (no fix): ~0% released — mimalloc never returns the pages.
// With fix: consistently 80-90% released.
process.exit(pct > 50 ? 0 : 1);
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("releasedPct");
  expect(exitCode).toBe(0);
});
