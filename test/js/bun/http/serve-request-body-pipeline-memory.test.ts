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

type Seen = { len: number; backing: number; off: number };

async function runUpload(
  handler: (req: Request, onParked: () => void, onChunk: () => void) => Promise<Seen[]>,
  bodyBytes: number,
  writes: number[],
): Promise<Seen[]> {
  const { promise: handlerP, resolve: handlerDone, reject: handlerFail } = Promise.withResolvers<Seen[]>();
  const { promise: pullParkedP, resolve: pullParked, reject: pullParkedFail } = Promise.withResolvers<void>();
  // One ack per client write so the next write only leaves after the server
  // has observed the previous one as a distinct on_data chunk.
  const acks = writes.map(() => Promise.withResolvers<void>());
  // `fail` rejects every promise, but only the one currently awaited has a
  // handler at that point; mark the rest observed so a regression surfaces as
  // one failure instead of one plus N unhandled-rejection noise entries.
  void handlerP.catch(() => {});
  void pullParkedP.catch(() => {});
  for (const a of acks) void a.promise.catch(() => {});
  let ackIndex = 0;
  const onChunk = () => acks[ackIndex++]?.resolve();
  const fail = (e: unknown) => {
    handlerFail(e);
    pullParkedFail(e);
    for (const a of acks) a.reject(e);
  };

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      try {
        const seen = await handler(req, () => queueMicrotask(() => queueMicrotask(pullParked)), onChunk);
        handlerDone(seen);
      } catch (e) {
        fail(e);
      }
      return new Response("ok");
    },
  });

  const sock = connect({ port: server.port, host: "127.0.0.1" });
  sock.on("error", fail);
  await new Promise<void>((res, rej) => {
    sock.once("connect", () => res());
    sock.once("error", rej);
  });

  try {
    sock.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${bodyBytes}\r\nConnection: close\r\n\r\n`);
    await pullParkedP;
    for (const [i, n] of writes.entries()) {
      sock.write(Buffer.alloc(n, 0x61));
      await acks[i].promise;
    }
    sock.end();
    return await handlerP;
  } finally {
    sock.destroy();
  }
}

function checkRightSized(seen: Seen[], expectedTotal: number, minChunks: number) {
  let total = 0;
  for (const { len } of seen) total += len;
  expect(total).toBe(expectedTotal);
  expect(seen.length).toBeGreaterThanOrEqual(minChunks);
  // Every chunk is its own allocation. On main each chunk was a subarray into
  // a single ~516 KiB (for await) / ~64 KiB (fromWeb) scratch view, so
  // `backing >> len` and `off` advanced per chunk.
  for (const { len, backing, off } of seen) {
    expect({ len, backing, off }).toEqual({ len, backing: len, off: 0 });
  }
}

test("for await (req.body) chunks are backed by right-sized buffers, not the adapter's scratch view", async () => {
  // Content-Length large enough that on_start would have sized the pull view
  // at its ~512 KiB ceiling on main.
  const BODY = 2 * 1024 * 1024;
  const writes = [8 * 1024, 8 * 1024, BODY - 16 * 1024];
  const seen = await runUpload(
    async (req, onParked, onChunk) => {
      const out: Seen[] = [];
      // Let the client know the first pull has parked (no body bytes yet) so
      // the first chunk is resolved from on_data, not from drain().
      onParked();
      for await (const chunk of req.body!) {
        out.push({ len: chunk.byteLength, backing: chunk.buffer.byteLength, off: chunk.byteOffset });
        onChunk();
      }
      return out;
    },
    BODY,
    writes,
  );
  checkRightSized(seen, BODY, writes.length);
});

test("Readable.fromWeb(req.body) chunks are backed by right-sized buffers", async () => {
  const BODY = 64 * 1024;
  const writes = [BODY / 4, BODY / 4, BODY / 4, BODY / 4];
  const seen = await runUpload(
    async (req, onParked, onChunk) => {
      const r = Readable.fromWeb(req.body as any);
      const out: Seen[] = [];
      r.on("data", (chunk: Buffer) => {
        out.push({ len: chunk.byteLength, backing: chunk.buffer.byteLength, off: chunk.byteOffset });
        onChunk();
      });
      onParked();
      await new Promise<void>((res, rej) => {
        r.once("end", () => res());
        r.once("error", rej);
      });
      return out;
    },
    BODY,
    writes,
  );
  checkRightSized(seen, BODY, writes.length);
});
