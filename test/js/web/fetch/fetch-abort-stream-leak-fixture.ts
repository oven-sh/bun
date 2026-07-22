// https://github.com/oven-sh/bun/issues/32659
import { heapStats } from "bun:jsc";

const ITER = Number(process.env.ITERATIONS ?? "60");
const MAX_GROWTH_MB = Number(process.env.MAX_GROWTH_MB ?? "55");
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

for (let n = 0; n < ITER; n++) {
  sent = 0;
  const ac = new AbortController();
  const res = await fetch(server.url, { signal: ac.signal });
  const reader = res.body!.getReader();
  await reader.read();
  // Wait until the server-side stream stops making forward progress, which
  // means the transport and the client's response buffer are full, so the
  // abort lands on a body with buffered-but-unread bytes.
  let last = sent;
  for (;;) {
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
const heapMB = heapStats().heapSize / 1024 / 1024;
console.log(`held=${held.length / 2} growthMB=${growthMB.toFixed(1)} heapMB=${heapMB.toFixed(1)}`);

if (growthMB > MAX_GROWTH_MB) {
  console.error(`LEAK: RSS grew ${growthMB.toFixed(1)}MB over ${ITER} aborts (> ${MAX_GROWTH_MB}MB)`);
  process.exit(1);
}
process.exit(0);
