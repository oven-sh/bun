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
  handler: (req: Request, onParked: () => void) => Promise<Seen[]>,
  bodyBytes: number,
  writes: number[],
): Promise<Seen[]> {
  const { promise: handlerP, resolve: handlerDone, reject: handlerFail } = Promise.withResolvers<Seen[]>();
  const { promise: pullParkedP, resolve: pullParked } = Promise.withResolvers<void>();

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      try {
        const seen = await handler(req, () => queueMicrotask(() => queueMicrotask(pullParked)));
        handlerDone(seen);
      } catch (e) {
        handlerFail(e);
      }
      return new Response("ok");
    },
  });

  const sock = connect({ port: server.port, host: "127.0.0.1" });
  sock.on("error", handlerFail);
  await new Promise<void>((res, rej) => {
    sock.once("connect", () => res());
    sock.once("error", rej);
  });

  sock.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${bodyBytes}\r\nConnection: close\r\n\r\n`);
  await pullParkedP;
  for (const n of writes) {
    sock.write(Buffer.alloc(n, 0x61));
    await Bun.sleep(20);
  }
  sock.end();

  const seen = await handlerP;
  sock.destroy();
  return seen;
}

function checkRightSized(seen: Seen[], expectedTotal: number) {
  let total = 0;
  for (const { len } of seen) total += len;
  expect(total).toBe(expectedTotal);
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
  const seen = await runUpload(
    async (req, onParked) => {
      const out: Seen[] = [];
      // Let the client know the first pull has parked (no body bytes yet) so
      // the first chunk is resolved from on_data, not from drain().
      onParked();
      for await (const chunk of req.body!) {
        out.push({ len: chunk.byteLength, backing: chunk.buffer.byteLength, off: chunk.byteOffset });
      }
      return out;
    },
    BODY,
    [8 * 1024, 8 * 1024, BODY - 16 * 1024],
  );
  checkRightSized(seen, BODY);
});

test("Readable.fromWeb(req.body) chunks are backed by right-sized buffers", async () => {
  const BODY = 64 * 1024;
  const seen = await runUpload(
    async (req, onParked) => {
      const r = Readable.fromWeb(req.body as any);
      const out: Seen[] = [];
      r.on("data", (chunk: Buffer) => {
        out.push({ len: chunk.byteLength, backing: chunk.buffer.byteLength, off: chunk.byteOffset });
      });
      onParked();
      await new Promise<void>((res, rej) => {
        r.once("end", () => res());
        r.once("error", rej);
      });
      return out;
    },
    BODY,
    [BODY / 4, BODY / 4, BODY / 4, BODY / 4],
  );
  checkRightSized(seen, BODY);
});
