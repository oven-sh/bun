import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/28741
// Fetch response body data was allocated on the HTTP thread's mimalloc heap
// but freed from the main JS thread during GC. Cross-thread frees in mimalloc
// go to a delayed-free list that the allocating thread never processes when
// idle, so the memory was never returned to the OS.
test("fetch response body memory is reclaimed by GC", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const BODY_SIZE = 1024 * 1024; // 1MB
const FETCH_COUNT = 30;
const body = Buffer.alloc(BODY_SIZE, 0x42);

await using server = Bun.serve({
  port: 0,
  fetch() { return new Response(body); },
});

const startRss = process.memoryUsage().rss;

async function run() {
  let blobs = [];
  for (let i = 0; i < FETCH_COUNT; i++) {
    const res = await fetch("http://localhost:" + server.port + "/");
    blobs.push(await res.blob());
  }
  return blobs;
}
let blobs = await run();
const peakRss = process.memoryUsage().rss;

blobs = null;
Bun.gc(true);
await new Promise(r => setTimeout(r, 500));
Bun.gc(true);
Bun.shrink();
await new Promise(r => setTimeout(r, 500));
Bun.gc(true);

const finalRss = process.memoryUsage().rss;
const growth = peakRss - startRss;
const released = peakRss - finalRss;
const pct = growth > 0 ? (released / growth) * 100 : 100;

console.log(JSON.stringify({ startMB: (startRss/1e6).toFixed(1), peakMB: (peakRss/1e6).toFixed(1), finalMB: (finalRss/1e6).toFixed(1), releasedPct: pct.toFixed(1) }));
process.exit(pct > 20 ? 0 : 1);
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("releasedPct");
  expect(exitCode).toBe(0);
});
