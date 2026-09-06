import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Response.bytes() with async iterable body does not crash with null deref", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function* gen() {}
      const body = {};
      body[Symbol.asyncIterator] = () => gen();
      const resp = new Response(body);
      try { resp.bytes(); } catch {}
      try { resp.bytes(); } catch(e) { console.log(e.message); }
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).not.toContain("null is not an object");
  expect(exitCode).toBe(0);
});

test("Response.arrayBuffer() with async iterable body does not crash with null deref", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function* gen() {}
      const body = {};
      body[Symbol.asyncIterator] = () => gen();
      const resp = new Response(body);
      try { resp.arrayBuffer(); } catch {}
      try { resp.arrayBuffer(); } catch(e) { console.log(e.message); }
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).not.toContain("null is not an object");
  expect(exitCode).toBe(0);
});

// Let the stream machinery run: the pump advances in microtasks and nextTick jobs, so a
// few macrotask turns is enough for an unbounded pump to run far ahead.
async function settle(turns = 10) {
  for (let i = 0; i < turns; i++) await new Promise(resolve => setImmediate(resolve));
}

test("async generator body read in-process is pulled on demand, not to exhaustion", async () => {
  const CHUNKS = 200;
  let produced = 0;
  async function* gen() {
    for (let i = 0; i < CHUNKS; i++) {
      produced++;
      yield new Uint8Array(65536).fill(i & 0xff);
    }
  }
  const reader = new Response(gen()).body!.getReader();
  const first = await reader.read();
  expect(first.value!.byteLength).toBe(65536);
  await settle();
  // One chunk delivered, about one more buffered: nowhere near all of them.
  expect(produced).toBeLessThanOrEqual(3);

  let total = first.value!.byteLength;
  let reads = 1;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    reads++;
  }
  expect({ total, produced }).toEqual({ total: CHUNKS * 65536, produced: CHUNKS });
  expect(reads).toBeGreaterThan(CHUNKS / 2);
});

test("node:stream Readable body read in-process is pulled on demand, not to exhaustion", async () => {
  const { Readable } = await import("node:stream");
  const CHUNKS = 64;
  let produced = 0;
  const readable = new Readable({
    highWaterMark: 65536,
    read() {
      if (produced >= CHUNKS) return this.push(null);
      produced++;
      this.push(Buffer.alloc(1 << 20, produced));
    },
  });
  const reader = new Response(readable).body!.getReader();
  const first = await reader.read();
  expect(first.value!.byteLength).toBe(1 << 20);
  await settle();
  // Readable's own highWaterMark lets it run a little ahead; the whole stream must not be
  // collected into memory.
  expect(produced).toBeLessThan(CHUNKS / 4);

  let total = first.value!.byteLength;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
  }
  expect({ total, produced }).toEqual({ total: CHUNKS << 20, produced: CHUNKS });
});

test("async generator body piped to a slow sink in-process stays bounded", async () => {
  const CHUNKS = 100;
  let produced = 0;
  let consumed = 0;
  let release: (() => void) | undefined;
  async function* gen() {
    for (let i = 0; i < CHUNKS; i++) {
      produced++;
      yield new Uint8Array(65536);
    }
  }
  const piped = new Response(gen()).body!.pipeTo(
    new WritableStream(
      {
        async write() {
          consumed++;
          if (consumed === 3) await new Promise<void>(resolve => (release = resolve));
        },
      },
      { highWaterMark: 1 },
    ),
  );
  while (!release) await settle(1);
  await settle();
  expect(consumed).toBe(3);
  // Consumed, plus what the WritableStream queue and the body's own buffer hold.
  expect(produced).toBeLessThanOrEqual(8);
  release();
  await piped;
  expect({ consumed, produced }).toEqual({ consumed: CHUNKS, produced: CHUNKS });
});

test("direct stream controller.write() resolves once a reader takes the bytes", async () => {
  const events: string[] = [];
  const stream = new ReadableStream({
    type: "direct",
    async pull(controller) {
      for (let i = 0; i < 3; i++) {
        const result = controller.write(new Uint8Array(128 * 1024));
        events.push(`write ${i}: ${typeof result}`);
        await result;
        events.push(`drained ${i}`);
      }
      controller.close();
    },
  });
  const reader = stream.getReader();
  const first = await reader.read();
  await settle();
  expect(first.value!.byteLength).toBe(128 * 1024);
  expect(events).toEqual(["write 0: object", "drained 0", "write 1: object"]);
  const second = await reader.read();
  expect(second.value!.byteLength).toBe(128 * 1024);
  const third = await reader.read();
  expect(third.value!.byteLength).toBe(128 * 1024);
  expect((await reader.read()).done).toBe(true);
  expect(events).toEqual(["write 0: object", "drained 0", "write 1: object", "drained 1", "write 2: object", "drained 2"]);
});
