// https://github.com/oven-sh/bun/issues/10686
//
// Bun.write(path, fetchResponse) installs an `onReceiveValue` callback on the
// locked body and waits for the HTTP client to finish buffering. Two bugs:
//
//   1. The JS Response wrapper is no longer reachable once `await Bun.write(...)`
//      is entered, so GC could collect it. The Response finalizer only looked at
//      `Locked.promise` (set by .text()/.arrayBuffer()) to decide whether anyone
//      was waiting, missed `onReceiveValue`, and discarded the remaining body —
//      the Bun.write promise then never resolved.
//
//   2. When the body did arrive, WriteFileWaitFromLockedValueTask never detached
//      the source Blob it created from `value.use()`, leaking one Store per call.
//
// This fixture repeatedly writes a >1MB fetch() response (large enough that the
// body is still in-flight when Bun.write is called) and asserts both that every
// iteration completes and that RSS stays bounded.

import { rmSync, readFileSync } from "node:fs";
import path from "node:path";

const dest = process.argv[2];
const MAX_ALLOWED_MEMORY_USAGE_MB = Number(process.argv[3]);

// 4 MB, patterned so we can verify integrity
const payload = Buffer.alloc(4 * 1024 * 1024);
for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
const expectedHash = Bun.hash(payload);

using server = Bun.serve({
  port: 0,
  fetch: () => new Response(payload),
});

let maxRSS = 0;
for (let i = 0; i < 100; i++) {
  const file = path.join(dest, `out-${i}.bin`);
  const res = await fetch(server.url);
  // Do NOT insert anything between fetch() and Bun.write() — the bug only
  // reproduces when the body is still .Locked at the Bun.write call site.
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
  const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
  if (rss > maxRSS) maxRSS = rss;
  if (rss > MAX_ALLOWED_MEMORY_USAGE_MB) {
    throw new Error(`iteration ${i}: memory usage ${rss} MB exceeds limit ${MAX_ALLOWED_MEMORY_USAGE_MB} MB`);
  }
}

console.log(JSON.stringify({ ok: true, iterations: 100, maxRSS }));
