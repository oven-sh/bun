// Queues one large body on a QUIC stream, waits until the first bytes of it
// have reached the peer (so the native side has gone through at least one
// on_write with the whole body still queued), and reports how much this
// process's resident set grew. Spawned by quic-stream.test.ts, once per way
// of handing the native side a body:
//
//   open     createBidirectionalStream({ body })
//   setBody  stream.setBody(body)
//   writer   stream.writer.writeSync(body)
//
// The body itself is allocated and filled before the baseline, so the growth
// is what the native side allocated: the one queue it keeps the body in, plus
// anything it copied the body into on the way there or on the way out. Freed
// copies still count: both ASAN's quarantine (debug builds) and mimalloc's
// page cache (release) keep a just-freed block of this size resident, which
// is what lets a single rss() reading after the fact see them.
//
// Prints one JSON line: { bodyBytes, rssBefore, rssAfter, bytesSent }
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

const BODY_BYTES = 64 * 1024 * 1024;
const mode = process.argv[2];

// A client-initiated stream only materializes on the server once data for it
// arrives, so onstream firing means the client drained into lsquic.
const peerGotData = Promise.withResolvers<void>();
const server = await listen(
  (session: any) => {
    session.closed.catch(() => {});
    session.onstream = (stream: any) => {
      stream.closed.catch(() => {});
      peerGotData.resolve();
    };
  },
  { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["rss-fixture"] },
);

const client = await connect(`127.0.0.1:${server.address.port}`, { alpn: "rss-fixture", verifyPeer: "manual" });
client.closed.catch(() => {});
await client.opened;

const body = Buffer.alloc(BODY_BYTES, "body");
let stream: any;
if (mode !== "open") {
  stream = await client.createBidirectionalStream();
  stream.closed.catch(() => {});
}

Bun.gc(true);
const rssBefore = process.memoryUsage.rss();

switch (mode) {
  case "open":
    stream = await client.createBidirectionalStream({ body });
    stream.closed.catch(() => {});
    break;
  case "setBody":
    stream.setBody(body);
    break;
  case "writer":
    if (!stream.writer.writeSync(body)) throw new Error("writeSync refused the body");
    break;
  default:
    throw new Error(`unknown mode ${JSON.stringify(mode)}`);
}

await peerGotData.promise;
const rssAfter = process.memoryUsage.rss();

// Still referenced here, so the caller's copy is part of both readings.
if (body.byteLength !== BODY_BYTES) throw new Error("unreachable");

console.log(
  JSON.stringify({
    bodyBytes: BODY_BYTES,
    rssBefore,
    rssAfter,
    bytesSent: Number(stream.stats.bytesSent),
  }),
);
client.destroy();
server.destroy();
