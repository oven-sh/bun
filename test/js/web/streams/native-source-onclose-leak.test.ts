import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";

// The JS onClose callback is installed on the native source wrapper when the
// lazy stream is first pulled. Storing it in a JSC::Strong rooted a cycle
// (source wrapper -> m_ctx NewSource -> Strong(onClose) -> bound fn ->
// NativeReadableStreamSource -> $stream -> source wrapper) that only broke
// when EOF ran the JS-side callClose or the cancel algorithm ran #cancel. A
// stream that is read partially and then dropped (releaseLock without cancel)
// never hits either path, so the source wrapper leaked forever. Storing
// onClose in the GC-traced onCloseCallback WriteBarrier slot (as onDrain
// already did) turns the cycle into an ordinary intra-heap cycle that
// mark-sweep collects.

test("native ReadableStream source is collectable after partial read + releaseLock", async () => {
  // Payload must exceed the native pull buffer (ByteBlobLoader caps
  // chunk_size at 2MB) so the first pull does not return *AndDone and
  // callClose is never queued.
  const payload = Buffer.alloc(8 * 1024 * 1024, "x");
  async function once() {
    const stream = new Blob([payload]).stream();
    const reader = stream.getReader();
    await reader.read();
    reader.releaseLock();
  }

  for (let i = 0; i < 5; i++) await once();
  Bun.gc(true);
  const before = heapStats().objectTypeCounts.BlobInternalReadableStreamSource ?? 0;

  for (let i = 0; i < 30; i++) await once();
  Bun.gc(true);
  await 1;
  Bun.gc(true);
  const after = heapStats().objectTypeCounts.BlobInternalReadableStreamSource ?? 0;

  // Pre-fix this grew by exactly 30 (one pinned wrapper per iteration).
  expect(after - before).toBeLessThan(8);
});

test("fetch body native source is collectable after partial read + releaseLock", async () => {
  const payload = Buffer.alloc(4 * 1024 * 1024, "x");
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(payload);
    },
  });
  const url = `http://127.0.0.1:${server.port}/`;

  async function once() {
    const res = await fetch(url);
    const reader = res.body!.getReader();
    await reader.read();
    reader.releaseLock();
  }

  for (let i = 0; i < 5; i++) await once();
  Bun.gc(true);
  const countSources = () => {
    const c = heapStats().objectTypeCounts;
    return (c.BlobInternalReadableStreamSource ?? 0) + (c.BytesInternalReadableStreamSource ?? 0);
  };
  const before = countSources();

  for (let i = 0; i < 30; i++) await once();
  Bun.gc(true);
  await 1;
  Bun.gc(true);
  const after = countSources();

  // Pre-fix this grew by ~30.
  expect(after - before).toBeLessThan(8);
});

// Regression guard: the cycle-breaking paths that already worked must keep
// working after switching storage.
test("native ReadableStream source is collectable after full consumption", async () => {
  const payload = Buffer.alloc(8 * 1024 * 1024, "x");
  async function once() {
    const stream = new Blob([payload]).stream();
    for await (const _ of stream) {
    }
  }

  for (let i = 0; i < 5; i++) await once();
  Bun.gc(true);
  const before = heapStats().objectTypeCounts.BlobInternalReadableStreamSource ?? 0;

  for (let i = 0; i < 30; i++) await once();
  Bun.gc(true);
  await 1;
  Bun.gc(true);
  const after = heapStats().objectTypeCounts.BlobInternalReadableStreamSource ?? 0;

  expect(after - before).toBeLessThan(8);
});

test("native source onClose callback still fires after switching to cached slot", async () => {
  // proc.stdout is a FileInternalReadableStreamSource; closing stdin makes
  // cat exit, which EOFs stdout. FileReader.on_reader_done -> parent.on_close
  // -> on_js_close must still find and invoke the JS onClose callback now
  // that it lives in a WriteBarrier slot rather than a Strong.
  await using proc = Bun.spawn({
    cmd: ["cat"],
    stdin: "pipe",
    stdout: "pipe",
    env: { PATH: process.env.PATH },
  });
  const reader = proc.stdout.getReader();
  const pending = reader.read();
  proc.stdin.end();
  const { done } = await pending;
  // If on_js_close did not fire, the pending pull promise would never resolve
  // with done:true and this test would hang.
  expect(done).toBe(true);
  reader.releaseLock();
  await proc.exited;
});
