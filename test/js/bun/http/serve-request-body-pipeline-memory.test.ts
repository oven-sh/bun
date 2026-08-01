// `for await (chunk of req.body)` (what `pipeline(req.body, writable)` runs
// via `pumpToNode`) should yield right-sized chunks. A `Bun.serve` request
// body is a push source (`ByteStream`): bytes arrive via `on_data` and are
// handed to the reader as the owning allocation. Previously `on_pull`/`on_data`
// copied into the native-source adapter's ~256-512 KiB scratch view and
// surfaced each chunk as a subarray over that whole backing, so every in-flight
// request held a ~0.5 MB `ArrayBuffer` regardless of how little data was
// actually read.

import { expect, test } from "bun:test";
import { connect } from "node:net";
import { Readable } from "node:stream";

test("for await (req.body) chunks are backed by right-sized buffers, not the adapter's scratch view", async () => {
  type Seen = { len: number; backing: number; off: number };
  let handlerDone!: (v: Seen[]) => void;
  const handlerP = new Promise<Seen[]>(r => {
    handlerDone = r;
  });
  let pullParked!: () => void;
  const pullParkedP = new Promise<void>(r => {
    pullParked = r;
  });

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const seen: Seen[] = [];
      // Let the client know the first pull has parked (no body bytes yet) so
      // the first chunk is resolved from on_data, not from drain().
      queueMicrotask(() => queueMicrotask(pullParked));
      for await (const chunk of req.body!) {
        seen.push({
          len: chunk.byteLength,
          backing: chunk.buffer.byteLength,
          off: chunk.byteOffset,
        });
      }
      handlerDone(seen);
      return new Response("ok");
    },
  });

  const sock = connect({ port: server.port, host: "127.0.0.1" });
  await new Promise<void>((res, rej) => {
    sock.once("connect", () => res());
    sock.once("error", rej);
  });

  // Content-Length large enough that on_start would have sized the pull view
  // at its ~512 KiB ceiling on main.
  const BODY = 2 * 1024 * 1024;
  sock.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${BODY}\r\nConnection: close\r\n\r\n`);
  await pullParkedP;
  // A couple of small chunks first so their backing size is unambiguous.
  sock.write(Buffer.alloc(8 * 1024, 0x61));
  await Bun.sleep(20);
  sock.write(Buffer.alloc(8 * 1024, 0x62));
  await Bun.sleep(20);
  sock.write(Buffer.alloc(BODY - 16 * 1024, 0x63));
  sock.end();

  const seen = await handlerP;
  sock.destroy();

  let total = 0;
  for (const { len } of seen) total += len;
  expect(total).toBe(BODY);

  // Every chunk is its own allocation: backing size equals payload size and
  // the view starts at offset 0. On main each chunk was a subarray into a
  // single ~516 KiB scratch view (backing >> len, off advancing per chunk).
  for (const { len, backing, off } of seen) {
    expect({ len, backing, off }).toEqual({ len, backing: len, off: 0 });
  }
});

test("Readable.fromWeb(req.body) chunks are backed by right-sized buffers", async () => {
  type Seen = { len: number; backing: number; off: number };
  let handlerDone!: (v: Seen[]) => void;
  const handlerP = new Promise<Seen[]>(r => {
    handlerDone = r;
  });
  let pullParked!: () => void;
  const pullParkedP = new Promise<void>(r => {
    pullParked = r;
  });

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const r = Readable.fromWeb(req.body as any);
      const seen: Seen[] = [];
      r.on("data", (chunk: Buffer) => {
        seen.push({
          len: chunk.byteLength,
          backing: chunk.buffer.byteLength,
          off: chunk.byteOffset,
        });
      });
      queueMicrotask(() => queueMicrotask(pullParked));
      await new Promise<void>(res => r.once("end", () => res()));
      handlerDone(seen);
      return new Response("ok");
    },
  });

  const sock = connect({ port: server.port, host: "127.0.0.1" });
  await new Promise<void>((res, rej) => {
    sock.once("connect", () => res());
    sock.once("error", rej);
  });

  const BODY = 64 * 1024;
  sock.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${BODY}\r\nConnection: close\r\n\r\n`);
  await pullParkedP;
  for (let i = 0; i < 4; i++) {
    sock.write(Buffer.alloc(BODY / 4, 0x61 + i));
    await Bun.sleep(20);
  }
  sock.end();

  const seen = await handlerP;
  sock.destroy();

  let total = 0;
  for (const { len } of seen) total += len;
  expect(total).toBe(BODY);

  // Same invariant for the node:stream adapter path: the native-readable pull
  // loop previously pre-allocated a 64-256 KiB Buffer and pushed subarrays
  // into it; now it receives the source's own allocation.
  for (const { len, backing, off } of seen) {
    expect({ len, backing, off }).toEqual({ len, backing: len, off: 0 });
  }
});
