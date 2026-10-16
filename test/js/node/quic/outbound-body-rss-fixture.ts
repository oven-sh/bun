// Hands one large body to a QUIC stream and waits until the first bytes of it
// have reached the peer. By then the native side has written to lsquic at
// least once with the whole body still queued. quic-stream.test.ts reads the
// peak RSS of this process, once for each way of handing over a body:
//
//   none     the body is not handed over (the baseline)
//   open     createBidirectionalStream({ body })
//   setBody  stream.setBody(body)
//   writer   stream.writer.writeSync(body)
//
// The peak of a mode above the peak of `none` is what the native side held at
// one time for the body: the one queue, plus every copy that was live beside
// it.
//
// Prints one JSON line: { bodyBytes, bytesSent }
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, type SessionOptions } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

const BODY_BYTES = 16 * 1024 * 1024;
const mode = process.argv[2];
const transportParams = { maxIdleTimeout: 5 };

// A client-initiated stream only materializes on the server once data for it
// arrives, so onstream firing means the client drained into lsquic.
const peerGotData = Promise.withResolvers<void>();
const closedEarly = (what: string) => () => peerGotData.reject(new Error(`${what} closed before the peer got data`));

const server = await listen(
  (session: any) => {
    session.closed.then(closedEarly("the server session"), closedEarly("the server session"));
    session.onstream = (stream: any) => {
      stream.closed.catch(() => {});
      peerGotData.resolve();
    };
  },
  { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["rss-fixture"], transportParams },
);

const client = await connect(server.address!, {
  alpn: "rss-fixture",
  verifyPeer: "manual",
  transportParams,
} as SessionOptions);
client.closed.then(closedEarly("the client session"), closedEarly("the client session"));
await client.opened;

const body = Buffer.alloc(BODY_BYTES, "body");
let stream: any;
switch (mode) {
  case "none":
    peerGotData.resolve();
    break;
  case "open":
    stream = await client.createBidirectionalStream({ body });
    break;
  case "setBody":
    stream = await client.createBidirectionalStream();
    stream.setBody(body);
    break;
  case "writer":
    stream = await client.createBidirectionalStream();
    if (!stream.writer.writeSync(body)) throw new Error("writeSync refused the body");
    break;
  default:
    throw new Error(`unknown mode ${JSON.stringify(mode)}`);
}
stream?.closed.then(closedEarly("the stream"), closedEarly("the stream"));

await peerGotData.promise;

// Still referenced here, so the caller's copy is part of every peak.
if (body.byteLength !== BODY_BYTES) throw new Error("unreachable");

console.log(JSON.stringify({ bodyBytes: BODY_BYTES, bytesSent: Number(stream?.stats.bytesSent ?? 0) }));
client.destroy();
server.destroy();
