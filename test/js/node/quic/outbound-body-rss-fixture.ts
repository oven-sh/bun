// Hands one 16 MiB body to a QUIC stream and exits once the peer has seen the
// stream, so lsquic was written to at least once with the body still queued.
// argv[2] picks how the body is handed over. "none" is the baseline.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, type SessionOptions } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

const mode = process.argv[2];
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
  { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["rss-fixture"] },
);

const client = await connect(server.address!, { alpn: "rss-fixture", verifyPeer: "manual" } as SessionOptions);
client.closed.then(closedEarly("the client session"), closedEarly("the client session"));
await client.opened;

const body = Buffer.alloc(16 * 1024 * 1024, "body");
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

console.log(JSON.stringify({ bodyBytes: body.byteLength, bytesSent: Number(stream?.stats.bytesSent ?? 0) }));
client.destroy();
server.destroy();
