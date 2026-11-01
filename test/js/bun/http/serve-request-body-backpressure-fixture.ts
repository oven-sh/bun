// Uploads to a Bun.serve handler that takes one chunk of the body and then stays away from
// it, while the client sends until nothing more is accepted. Reports what the server holds
// for the body at that point, then lets the handler read the rest.
//
// Prints one JSON line. MODE=held: { results: [{ via, held, readAhead, received, intact }] },
// where `held` is the largest native buffer of a body stream (the GC does not see it, a heap
// snapshot does) and `readAhead` says whether the next read() was already satisfied. MODE=rss:
// { rssPerUploadKiB } for UPLOADS uploads whose sink never finishes its first write.

import { generateHeapSnapshot } from "bun";
import { once } from "node:events";
import net from "node:net";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import nodeTls from "node:tls";

const TOTAL = 32 * 1024 * 1024;
const block = Buffer.alloc(256 * 1024);
for (let i = 0; i < block.length; i += 4) block.writeUInt32LE(i, i);

// Whether `chunk` is the body's bytes from `offset` on.
function isBodyAt(chunk: Uint8Array, offset: number) {
  let taken = 0;
  while (taken < chunk.length) {
    const at = (offset + taken) % block.length;
    const n = Math.min(block.length - at, chunk.length - taken);
    if (Buffer.compare(chunk.subarray(taken, taken + n), block.subarray(at, at + n)) !== 0) return false;
    taken += n;
  }
  return true;
}

function heldByBodyStreams() {
  const { nodes, nodeClassNames } = generateHeapSnapshot() as unknown as { nodes: number[]; nodeClassNames: string[] };
  const source = nodeClassNames.indexOf("BytesInternalReadableStreamSource");
  let held = 0;
  // [id, size, class, flags] per node.
  for (let i = 0; i < nodes.length; i += 4) if (nodes[i + 2] === source) held = Math.max(held, nodes[i + 1]);
  return held;
}

// Sends the request head and then the body until the socket has taken nothing more for 300 ms.
async function uploadUntilStalled(sock: net.Socket, total: number) {
  sock.on("error", () => {});
  sock.on("data", () => {});
  sock.write(`PUT /up HTTP/1.1\r\nHost: x\r\nContent-Length: ${total}\r\nConnection: close\r\n\r\n`);
  let sent = 0;
  const writeMore = () => {
    while (sent < total) {
      const ok = sock.write(block);
      sent += block.length;
      if (!ok) return void sock.once("drain", writeMore);
    }
  };
  writeMore();
  let last = -1;
  let stable = 0;
  while (sent < total && stable < 12) {
    await Bun.sleep(25);
    if (sent === last) stable++;
    else {
      stable = 0;
      last = sent;
    }
  }
}

type Via = "getReader()" | "getReader() over TLS" | "Readable.fromWeb()";

async function heldWhileReaderIsAway(via: Via) {
  const away = Promise.withResolvers<void>();
  const outcome = Promise.withResolvers<{ readAhead?: boolean; received: number; intact: boolean }>();
  const overTls = via === "getReader() over TLS";

  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    maxRequestBodySize: TOTAL + 1,
    tls: overTls ? { cert: process.env.TLS_CERT!, key: process.env.TLS_KEY! } : undefined,
    error(error) {
      outcome.reject(error);
    },
    async fetch(req) {
      let received = 0;
      let intact = true;
      const take = (chunk: Uint8Array) => {
        intact &&= isBodyAt(chunk, received);
        received += chunk.length;
      };

      if (via === "Readable.fromWeb()") {
        let first = true;
        const sink = new Writable({
          write(chunk, _encoding, callback) {
            take(chunk);
            if (first) away.promise.then(() => callback());
            else callback();
            first = false;
          },
        });
        await pipeline(Readable.fromWeb(req.body as any), sink);
        outcome.resolve({ received, intact });
        return new Response("ok");
      }

      const reader = req.body!.getReader();
      take((await reader.read()).value!);
      await away.promise;
      // A chunk that was read ahead settles this read() with no trip to the socket, so in microtasks alone.
      let settled = false;
      const next = reader.read().finally(() => (settled = true));
      for (let i = 0; i < 64; i++) await Promise.resolve();
      const readAhead = settled;
      for (let result = await next; !result.done; result = await reader.read()) take(result.value);
      outcome.resolve({ readAhead, received, intact });
      return new Response("ok");
    },
  });

  const sock = overTls
    ? nodeTls.connect({ port: server.port, host: "127.0.0.1", rejectUnauthorized: false })
    : net.connect(server.port!, "127.0.0.1");
  try {
    await once(sock, overTls ? "secureConnect" : "connect");
    await uploadUntilStalled(sock, TOTAL);
    const held = heldByBodyStreams();
    away.resolve();
    return { via, held, ...(await outcome.promise) };
  } finally {
    sock.destroy();
  }
}

async function rssPerStalledUpload(uploads: number) {
  const stalled: unknown[] = [];
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    maxRequestBodySize: TOTAL + 1,
    async fetch(req) {
      // Like fs.WriteStream, one write at a time. This one never completes.
      const sink = new Writable({
        write(_chunk, _encoding, callback) {
          stalled.push(callback, sink);
        },
      });
      await pipeline(req.body as any, sink);
      return new Response("ok");
    },
  });

  Bun.gc(true);
  const before = process.memoryUsage.rss();
  const socks = Array.from({ length: uploads }, () => net.connect(server.port!, "127.0.0.1"));
  try {
    await Promise.all(socks.map(sock => once(sock, "connect").then(() => uploadUntilStalled(sock, TOTAL))));
    Bun.gc(true);
    return Math.round((process.memoryUsage.rss() - before) / uploads / 1024);
  } finally {
    for (const sock of socks) sock.destroy();
  }
}

if (process.env.MODE === "rss") {
  console.log(JSON.stringify({ rssPerUploadKiB: await rssPerStalledUpload(Number(process.env.UPLOADS)) }));
} else {
  const results = [];
  for (const via of ["getReader()", "getReader() over TLS", "Readable.fromWeb()"] as const) {
    results.push(await heldWhileReaderIsAway(via));
  }
  console.log(JSON.stringify({ results }));
}
process.exit(0);
