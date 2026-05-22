import { expect, test } from "bun:test";
import { isASAN, isWindows } from "harness";

test("native ReadableStream reuses the pull buffer across small reads", async () => {
  // #getInternalBuffer used to rotate to a fresh autoAllocateChunkSize
  // (256KB) Uint8Array whenever $data.length < chunkSize — true after
  // every nonzero read, since #handleNumberResult stores the tail
  // subarray. So every pull allocated a fresh 256KB Gigacage buffer
  // while the previous one was still pinned by the consumer's enqueued
  // subarray. On Windows libpas commits those pages up front and only
  // the scavenger releases them, so commit charge ran ahead of RSS
  // until VirtualAlloc(MEM_COMMIT) failed in
  // pas_compact_heap_reservation_try_allocate.
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            for (let i = 0; i < 1000; i++) {
              controller.write("x\n");
              await controller.flush();
              await Bun.sleep(0);
            }
            controller.close();
          },
        }),
      );
    },
  });

  const resp = await fetch(server.url);
  const chunks: Uint8Array[] = [];
  for await (const chunk of resp.body!) chunks.push(chunk);

  // Some chunks coalesce on the wire; we just need a meaningful sample
  // of small reads through the native pull path.
  expect(chunks.length).toBeGreaterThan(20);

  // Consecutive small reads should land in the same backing buffer (the
  // tail subarray is reused until a read fills it). 2KB of ~few-byte
  // chunks fits well inside one 256KB buffer, so the whole stream should
  // share a handful at most. Pre-fix every chunk had its own 256KB
  // buffer, so this was ~chunks.length.
  const distinctBuffers = new Set(chunks.map(c => c.buffer));
  expect(distinctBuffers.size).toBeLessThan(8);

  let backingBytes = 0;
  for (const buf of distinctBuffers) backingBytes += buf.byteLength;
  // Pre-fix this was ~chunks.length * 256KB ≈ 25–250 MB.
  expect(backingBytes).toBeLessThan(4 * 1024 * 1024);
});

const BYTES_TO_WRITE = 500_000;

// https://github.com/oven-sh/bun/issues/12198
test.skipIf(isWindows)(
  "Absolute memory usage remains relatively constant when reading and writing to a pipe",
  async () => {
    async function write(bytes: number) {
      const buf = Buffer.alloc(bytes, "foo");
      await cat.stdin.write(buf);
    }
    async function read(bytes: number) {
      let i = 0;
      while (true) {
        const { value } = await r.read();
        i += value?.length ?? 0;
        if (i >= bytes) {
          return;
        }
      }
    }

    async function readAndWrite(bytes = BYTES_TO_WRITE) {
      await Promise.all([write(bytes), read(bytes)]);
    }

    await using cat = Bun.spawn(["cat"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const r = cat.stdout.getReader() as any;

    const rounds = 5000;

    for (let i = 0; i < rounds; i++) {
      await readAndWrite(BYTES_TO_WRITE);
    }
    Bun.gc(true);
    const before = process.memoryUsage.rss();

    for (let i = 0; i < rounds; i++) {
      await readAndWrite();
    }
    Bun.gc(true);
    const after = process.memoryUsage.rss();

    for (let i = 0; i < rounds; i++) {
      await readAndWrite();
    }
    Bun.gc(true);
    const after2 = process.memoryUsage.rss();
    console.log({ after, after2 });
    console.log(require("bun:jsc").heapStats());
    console.log("RSS delta", ((after - before) | 0) / 1024 / 1024);
    console.log("RSS total", (after / 1024 / 1024) | 0, "MB");
    // ASAN's quarantine + shadow memory raise the absolute RSS floor and slow
    // recycling of freed allocations; widen both bounds under bun-asan.
    expect(after).toBeLessThan((isASAN ? 700 : 250) * 1024 * 1024);
    expect(after).toBeLessThan(before * (isASAN ? 3 : 1.5));
  },
);
