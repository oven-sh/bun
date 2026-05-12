import { expect, test } from "bun:test";
import { isWindows } from "harness";

test("native ReadableStream small chunks don't pin autoAllocateChunkSize ArrayBuffers", async () => {
  // The native pull buffer is 256KB. Before the fix, every read that
  // returned bytes enqueued a subarray of that 256KB buffer (so the
  // consumer's chunk pinned the whole thing) and the leftover tail —
  // now shorter than chunkSize — forced a fresh 256KB allocation on
  // the next pull. A stream of N small chunks therefore held N×256KB
  // of Gigacage memory. On Windows the large heap commits those pages
  // up front and only the scavenger releases them, so commit charge
  // ran ahead of RSS until VirtualAlloc(MEM_COMMIT) failed inside
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
  expect(chunks.length).toBeGreaterThan(100);

  const dataBytes = chunks.reduce((s, c) => s + c.byteLength, 0);
  const backingBytes = chunks.reduce((s, c) => s + c.buffer.byteLength, 0);

  // Each enqueued chunk should own a buffer sized to the read, not the
  // 256KB pull buffer. Allow generous slack for the handful of larger
  // coalesced reads, page rounding, and the one reused pull buffer that
  // may still back the final partially-filled chunk.
  expect(backingBytes).toBeLessThan(dataBytes + 4 * 1024 * 1024);
  // Pre-fix this was ~chunks.length * 256KB ≈ 25–250 MB.
  expect(backingBytes).toBeLessThan(chunks.length * 64 * 1024);
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
    expect(after).toBeLessThan(250 * 1024 * 1024);
    expect(after).toBeLessThan(before * 1.5);
  },
);
