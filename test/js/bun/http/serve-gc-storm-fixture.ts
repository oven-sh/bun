// Fixture for serve-gc-storm.test.ts. Build a large long-lived heap, serve an
// allocation-heavy handler under self-generated load for a fixed number of
// requests, then exit. The parent counts "EdenCollection" in stderr (from
// BUN_JSC_logGC=1) to measure how many eden GCs the controller requested.
import { createServer } from "node:http";

const REQUESTS = Number(process.env.REQUESTS ?? 4000);
const LIVE_RECORDS = Number(process.env.LIVE_RECORDS ?? 100_000);
const CONCURRENCY = 16;

// ~50 MB of records at the default count. Big enough for each eden pause to
// be measurable, small enough for an ASAN debug build to construct in a few
// seconds.
const pad = Buffer.alloc(64, 120).toString();
const live = new Map<number, { id: number; name: string; pad: string; meta: { s: number } }>();
for (let i = 0; i < LIVE_RECORDS; i++) {
  live.set(i, { id: i, name: "item-" + i, pad, meta: { s: (i * 2654435761) >>> 0 } });
}

let served = 0;
const server = createServer((req, res) => {
  const id = served % LIVE_RECORDS;
  const related: unknown[] = [];
  for (let k = 1; k <= 20; k++) {
    const r = live.get((id + k * 97) % LIVE_RECORDS)!;
    related.push({ id: r.id, name: r.name, score: r.meta.s });
  }
  const body = JSON.stringify({ ok: true, id, related });
  res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
  served++;
});

server.listen(0, async () => {
  // One sync GC to settle the 40 MB construction before the marker.
  Bun.gc(true);
  process.stderr.write("=== LOAD-START ===\n");
  const { port } = server.address() as import("node:net").AddressInfo;
  const base = `http://127.0.0.1:${port}/`;
  let i = 0;
  const worker = async () => {
    while (i < REQUESTS) {
      i++;
      const r = await fetch(base);
      await r.arrayBuffer();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stderr.write("=== LOAD-END ===\n");
  console.log(JSON.stringify({ served, rss: process.memoryUsage().rss }));
  server.close(() => process.exit(0));
});
