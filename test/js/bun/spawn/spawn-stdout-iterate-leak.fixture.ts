// Driven by spawn-stdout-iterate-leak.test.ts.
//
// Exercises the FileReader.onPull drain+memcpy branch: child_process stdout
// is a NativeReadable whose `_read()` calls `ptr.pull()` directly (no JS-side
// drain guard after the first read). With the Readable's highWaterMark set
// to CHUNK, a CHUNK-byte write that fulfils a pending pull via `.into_array`
// exactly fills the Node buffer, so `_read()` is not auto-rescheduled. The
// next write therefore lands in `onReadChunk` with no pending pull and is
// appended to `FileReader.buffered`. Draining the Node buffer via `.read()`
// then re-triggers `_read()` → `ptr.pull(CHUNK)` → `onPull`, which now sees
// `drain().len == CHUNK` and takes the memcpy branch.
//
// CHUNK = 32 KiB stays comfortably under the default 64 KiB pipe buffer so
// the round-trip through `cat` never blocks.

import { spawn } from "child_process";
import { once } from "events";

const MB = 1024 * 1024;
const CHUNK = 32768;

async function run(iters: number) {
  const proc = spawn("cat", [], { stdio: ["pipe", "pipe", "ignore"] });
  // Match the Node buffer threshold to CHUNK so one push makes it "full".
  (proc.stdout as any)._readableState.highWaterMark = CHUNK;

  const block = Buffer.alloc(CHUNK, 88);
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));

  let total = 0;
  // Prime: the first chunk is consumed by the one-time JS-side drain in
  // NativeReadable's first _read().
  proc.stdin!.write(block);
  await once(proc.stdout!, "readable");
  let c: Buffer | null;
  while ((c = proc.stdout!.read()) !== null) total += c.length;
  await tick();
  await tick();

  for (let i = 0; i < iters; i++) {
    // First write fulfils the pending pull (into_array); second write lands
    // in FileReader.buffered.
    proc.stdin!.write(block);
    await tick();
    await tick();
    proc.stdin!.write(block);
    await tick();
    await tick();
    // Draining the Node buffer re-triggers _read → onPull with
    // FileReader.buffered populated: the memcpy branch.
    while ((c = proc.stdout!.read()) !== null) total += c.length;
    await tick();
    await tick();
  }

  proc.stdin!.end();
  proc.stdout!.on("data", (d: Buffer) => void (total += d.length));
  proc.stdout!.resume();
  await once(proc, "close");
  if (total !== (iters * 2 + 1) * CHUNK) {
    throw new Error(`wrong total: got ${total}, expected ${(iters * 2 + 1) * CHUNK}`);
  }
}

// A real leak grows RSS on every run; transient allocator growth plateaus.
// After a short warmup we take several equally-sized samples and report the
// delta from the first sample to the last — a leak adds ~ITERS×CHUNK per
// step, non-leaking allocator caching contributes (at most) once.
const ITERS = 1000;
const STEPS = 5;

await run(200);
Bun.gc(true);

const samples: number[] = [];
for (let i = 0; i < STEPS; i++) {
  await run(ITERS);
  Bun.gc(true);
  samples.push(process.memoryUsage.rss());
}

console.log(
  JSON.stringify({
    samples: samples.map(s => s / MB),
    delta: (samples[samples.length - 1] - samples[0]) / MB,
  }),
);
