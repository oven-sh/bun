import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

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

  // A small read is copied out right-sized and the pull slab is reused for
  // the next read, so each chunk's backing store is its own few bytes rather
  // than a 256KB slab per chunk (~chunks.length * 256KB ≈ 16 MB before).
  const distinctBuffers = new Set(chunks.map(c => c.buffer));
  let backingBytes = 0;
  for (const buf of distinctBuffers) backingBytes += buf.byteLength;
  expect(backingBytes).toBeLessThan(64 * 1024);
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
test.skipIf(isWindows)("reading and writing to a pipe does not accumulate ArrayBuffers or Uint8Arrays", async () => {
  async function write(bytes: number) {
    const buf = Buffer.alloc(bytes, "foo");
    await cat.stdin.write(buf);
  }
  async function read(bytes: number) {
    let i = 0;
    while (i < bytes) {
      const { done, value } = await r.read();
      // When this test times out, the runner kills `cat`, its stdout closes,
      // and every further read() resolves {done: true} at once. Without this
      // check the abandoned loop spins in microtasks forever, the event loop
      // never runs again, and no later test file makes progress.
      if (done) throw new Error(`cat stdout closed after ${i} of ${bytes} bytes`);
      i += value.length;
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
  const r = cat.stdout.getReader();

  // The #12198 leak stranded one 16 KB pull buffer per read(), about four
  // ArrayBuffers per 500 KB round (bun 1.2.2: +437 per 100 rounds). Those
  // buffers are never written, so their pages never reach RSS: the former
  // RSS bounds passed on the leaking build even at 5000 rounds.
  const rounds = 100;
  function bufferCounts() {
    Bun.gc(true);
    const { ArrayBuffer = 0, Uint8Array = 0 } = heapStats().objectTypeCounts;
    return { ArrayBuffer, Uint8Array };
  }

  for (let i = 0; i < rounds; i++) {
    await readAndWrite();
  }
  const before = bufferCounts();

  for (let i = 0; i < rounds; i++) {
    await readAndWrite();
  }
  const after = bufferCounts();

  for (let i = 0; i < rounds; i++) {
    await readAndWrite();
  }
  const after2 = bufferCounts();

  for (const type of ["ArrayBuffer", "Uint8Array"] as const) {
    expect(after[type] - before[type]).toBeLessThan(rounds / 10);
    expect(after2[type] - before[type]).toBeLessThan(rounds / 10);
  }
});
