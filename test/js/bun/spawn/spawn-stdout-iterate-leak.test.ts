import { expect, test } from "bun:test";
import { spawn } from "child_process";
import { once } from "events";
import { isWindows } from "harness";

// Regression test for FileReader.onPull: after `drain()` moves the
// internally buffered data into a local ByteList and the data is memcpy'd
// into the JS-provided pull buffer, that ByteList must be freed. The old
// code freed `this.buffered` instead — but `drain()` had already emptied
// it, so the moved allocation was orphaned on every such pull.
//
// Reaching that branch requires onPull to be called while data is sitting
// in `this.buffered` *and* the JS buffer is large enough to hold it. Most
// consumers route through a JS-side `handle.drain()` guard first, so we
// construct the exact sequence that bypasses it:
//
//   - child_process stdout is a NativeReadable whose `_read()` calls
//     `ptr.pull()` directly (no drain guard after the first read).
//   - With the Readable's highWaterMark set to CHUNK, the first CHUNK-byte
//     write fulfils the pending pull via `.into_array` (result == view
//     length, so `kRemainingChunk` becomes undefined) and fills the Node
//     buffer exactly, so `_read()` is not auto-rescheduled.
//   - The second write then lands in `onReadChunk` with no pending pull
//     and is appended to `FileReader.buffered`.
//   - Draining the Node buffer via `.read()` triggers `_read()` →
//     `ptr.pull(CHUNK)` → `onPull`, which now sees `drain().len == CHUNK`
//     and takes the memcpy branch.
//
// CHUNK = 32 KiB stays comfortably under the default 64 KiB pipe buffer
// so the round-trip through `cat` never blocks.

const MB = 1024 * 1024;
const CHUNK = 32768;

async function run(iters: number) {
  const proc = spawn("cat", [], { stdio: ["pipe", "pipe", "ignore"] });
  // Match the Node buffer threshold to CHUNK so one push makes it "full".
  (proc.stdout as any)._readableState.highWaterMark = CHUNK;

  const block = Buffer.alloc(CHUNK, 88);
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));

  let total = 0;
  // Prime: first chunk is consumed by the one-time JS-side drain in
  // NativeReadable's first _read().
  proc.stdin!.write(block);
  await once(proc.stdout!, "readable");
  let c: Buffer | null;
  while ((c = proc.stdout!.read()) !== null) total += c.length;
  await tick();
  await tick();

  for (let i = 0; i < iters; i++) {
    // First write fulfils the pending pull (into_array), second write
    // lands in FileReader.buffered.
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
  proc.stdout!.resume();
  proc.stdout!.on("data", (d: Buffer) => void (total += d.length));
  await once(proc, "close");
  expect(total).toBe((iters * 2 + 1) * CHUNK);
}

// The leak is in the posix poll-reader path; Windows pipes go through
// libuv with different buffering.
test.todoIf(isWindows)(
  "FileReader.onPull frees the drained buffer after memcpy",
  async () => {
    // Warmup to settle allocator / JIT state.
    await run(100);
    Bun.gc(true);
    const before = process.memoryUsage.rss();

    await run(2000);
    Bun.gc(true);
    const after = process.memoryUsage.rss();

    const deltaMB = (after - before) / MB;
    console.log(
      `RSS before=${(before / MB).toFixed(1)}MB after=${(after / MB).toFixed(1)}MB delta=${deltaMB.toFixed(1)}MB`,
    );

    // Without the fix each of the 2000 iterations orphans a ~32 KiB
    // allocation: ~64 MB of leaked mimalloc memory (≈95 MB RSS under
    // ASAN). With the fix RSS stays roughly flat (<30 MB of noise).
    expect(deltaMB).toBeLessThan(50);
  },
  // Debug+ASAN event-loop ticks are slow; release finishes in ~1s.
  180_000,
);
