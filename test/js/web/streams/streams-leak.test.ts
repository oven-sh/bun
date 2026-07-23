import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";

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
  //
  // The server and the consumer below share one event loop, so the pull
  // callback paces itself on the consumer's progress: it writes chunk i+1
  // only once the consumer has read every byte of chunk i. At most one
  // write is ever in flight, so writes cannot coalesce on the wire and
  // the consumer observes at least one small read per write regardless
  // of machine load (unpaced, a lagging consumer on a busy CI runner saw
  // the 2000 bytes coalesce into as few as 10 reads, starving the
  // sample-size assertion below).
  const CHUNKS_TO_WRITE = 64;
  let bytesRead = 0;
  let wakeProducer = () => {};
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            let bytesWritten = 0;
            for (let i = 0; i < CHUNKS_TO_WRITE; i++) {
              controller.write("x\n");
              bytesWritten += 2;
              await controller.flush();
              while (bytesRead < bytesWritten) {
                const { promise, resolve } = Promise.withResolvers<void>();
                wakeProducer = resolve;
                await promise;
              }
            }
            controller.close();
          },
        }),
      );
    },
  });

  const resp = await fetch(server.url);
  const chunks: Uint8Array[] = [];
  for await (const chunk of resp.body!) {
    chunks.push(chunk);
    bytesRead += chunk.length;
    wakeProducer();
  }

  // At least one read per paced write; a meaningful sample of small reads
  // through the native pull path.
  expect(chunks.length).toBeGreaterThanOrEqual(CHUNKS_TO_WRITE);

  // Consecutive small reads should land in the same backing buffer (the
  // tail subarray is reused until a read fills it). 128 bytes of 2-byte
  // chunks fits well inside one 256KB buffer, so the whole stream should
  // share a handful at most. Pre-fix every chunk had its own 256KB
  // buffer, so this was ~chunks.length.
  const distinctBuffers = new Set(chunks.map(c => c.buffer));
  expect(distinctBuffers.size).toBeLessThan(8);

  let backingBytes = 0;
  for (const buf of distinctBuffers) backingBytes += buf.byteLength;
  // Pre-fix this was ~chunks.length * 256KB ≈ 16 MB.
  expect(backingBytes).toBeLessThan(4 * 1024 * 1024);
});

// Abandoning a Bun.file().stream() reader mid-file (no cancel(), no EOF) must
// not leak the fd once the ReadableStream is collected. Previously on_start()
// took a Strong on its own JS wrapper for every lazy-opened file and only
// released it at EOF/error, so an abandoned reader's wrapper was a GC root
// forever and its finalizer (which closes the fd) never ran.
test.skipIf(isWindows)("abandoned Bun.file().stream() reader does not leak its fd after GC", async () => {
  using dir = tempDir("file-stream-fd-leak", {
    "big.bin": Buffer.alloc(1 << 20, 7),
  });
  const script = `
    import fs from "node:fs";
    const p = process.env.BIG_BIN;
    const fdc = () => fs.readdirSync(process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd").length;
    const shapes = {
      getReader: async () => { Bun.file(p).stream().getReader(); },
      read: async () => { const r = Bun.file(p).stream().getReader(); await r.read(); },
      releaseLock: async () => { const r = Bun.file(p).stream().getReader(); await r.read(); r.releaseLock(); },
      response: async () => { const r = new Response(Bun.file(p)).body.getReader(); await r.read(); },
    };
    const f0 = fdc();
    for (const fn of Object.values(shapes)) {
      for (let i = 0; i < 30; i++) await fn();
    }
    for (let r = 0; r < 30; r++) { Bun.gc(true); await new Promise(x => setImmediate(x)); }
    const fend = fdc();
    process.stdout.write(JSON.stringify({ f0, fend }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, BIG_BIN: `${dir}/big.bin` },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { f0, fend } = JSON.parse(stdout);
  // 120 readers were acquired (4 shapes x 30 each); before the fix ~120 fds
  // stayed open even after a full-GC storm. Allow a small slack for any GC
  // nondeterminism, but require the vast majority to have been reclaimed.
  expect(fend).toBeLessThan(f0 + 20);
  expect(exitCode).toBe(0);
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
