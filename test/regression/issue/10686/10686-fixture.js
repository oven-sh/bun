import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

const dest = process.argv[2];
const MAX_GROWTH_MB = Number(process.argv[3]);

// 4 MB, patterned so we can verify integrity.
const payload = Buffer.alloc(4 * 1024 * 1024);
for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
const expectedHash = Bun.hash(payload);
const half = payload.length / 2;

// Stream the payload in two chunks with a delay between them so the body is
// guaranteed to still be `.Locked` (in-flight) when the client calls
// Bun.write(). A single `new Response(payload)` lets the whole body be
// delivered in one burst on release builds, in which case Bun.write sees an
// already-buffered `.InternalBlob` and the buggy path is never reached.
using server = Bun.serve({
  port: 0,
  fetch: () =>
    new Response(
      new ReadableStream({
        async pull(controller) {
          controller.enqueue(payload.subarray(0, half));
          await Bun.sleep(10);
          controller.enqueue(payload.subarray(half));
          controller.close();
        },
      }),
      { headers: { "Content-Length": String(payload.length) } },
    ),
});

Bun.gc(true);
const startRSS = process.memoryUsage.rss();
let maxGrowth = 0;

for (let i = 0; i < 50; i++) {
  const file = path.join(dest, `out-${i % 4}.bin`);
  const res = await fetch(server.url);
  // Nothing between fetch() and Bun.write(): the body must be `.Locked` here.
  const written = await Bun.write(file, res);
  if (written !== payload.length) {
    throw new Error(`iteration ${i}: wrote ${written}, expected ${payload.length}`);
  }
  const onDisk = readFileSync(file);
  if (onDisk.length !== payload.length || Bun.hash(onDisk) !== expectedHash) {
    throw new Error(`iteration ${i}: written data does not match payload`);
  }
  rmSync(file);

  Bun.gc(true);
  const growth = (process.memoryUsage.rss() - startRSS) / 1024 / 1024;
  if (growth > maxGrowth) maxGrowth = growth;
  if (growth > MAX_GROWTH_MB) {
    throw new Error(`iteration ${i}: RSS grew ${growth.toFixed(1)} MB, limit ${MAX_GROWTH_MB} MB`);
  }
}

console.log(JSON.stringify({ ok: true, iterations: 50, maxGrowthMB: Math.round(maxGrowth) }));
