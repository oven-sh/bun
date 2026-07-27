// https://github.com/oven-sh/bun/issues/32659
import { heapStats } from "bun:jsc";

const ITER = Number(process.env.ITERATIONS ?? "120");
const MAX_OFFHEAP_MB = Number(process.env.MAX_OFFHEAP_MB ?? "64");
const CHUNK = new Uint8Array(512 * 1024);

let sent = 0;
using server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  fetch() {
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(CHUNK);
          sent++;
        },
      }),
      { headers: { "content-type": "application/octet-stream" } },
    );
  },
});

// Keep every response + reader reachable so the buffered body cannot be
// reclaimed by GC finalization.
const held: unknown[] = [];

Bun.gc(true);
const rss0 = process.memoryUsage().rss;
const heap0 = heapStats().heapSize;

for (let n = 0; n < ITER; n++) {
  sent = 0;
  const ac = new AbortController();
  const res = await fetch(server.url, { signal: ac.signal });
  const reader = res.body!.getReader();
  await reader.read();
  // Wait until the server-side stream stops making forward progress, which
  // means the transport and the client's response buffer are full, so the
  // abort lands on a body with buffered-but-unread bytes. Bounded so a
  // backpressure regression fails the assertions instead of hanging here.
  let last = sent;
  for (let p = 0; p < 200; p++) {
    await Bun.sleep(5);
    if (sent === last && sent > 2) break;
    last = sent;
  }
  ac.abort();
  held.push(res, reader);
}

Bun.gc(true);
await Bun.sleep(1);
Bun.gc(true);

const growthMB = (process.memoryUsage().rss - rss0) / 1024 / 1024;
const heapGrowthMB = (heapStats().heapSize - heap0) / 1024 / 1024;
// The leak is the native ByteStream buffer, which lives outside the JS heap.
// The held Response/Reader objects account for the linear JS-heap growth on
// fixed and unfixed builds alike, so subtract that to isolate the off-heap
// component. On a fixed build this is flat at ~25-40 MB (allocator and
// transport overhead, independent of ITER); unfixed it grows per iteration
// by the retained ByteStream buffer (~0.5-1 MB, bounded by one recv() plus
// the kernel socket receive buffer).
const offHeapMB = growthMB - heapGrowthMB;
console.log(
  `held=${held.length / 2} growthMB=${growthMB.toFixed(1)} heapGrowthMB=${heapGrowthMB.toFixed(1)} offHeapMB=${offHeapMB.toFixed(1)}`,
);

if (offHeapMB > MAX_OFFHEAP_MB) {
  console.error(`LEAK: off-heap grew ${offHeapMB.toFixed(1)}MB over ${ITER} aborts (> ${MAX_OFFHEAP_MB}MB)`);
  process.exit(1);
}
process.exit(0);
