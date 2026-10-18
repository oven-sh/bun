// Both ends of one node:quic connection, in one process. The server answers
// every stream with stream.setBody(8 MiB). The client reads the answers one
// stream after another and keeps every stream object, so no wrapper is
// collected while the process measures. The queue of a finished stream must
// be freed when its FIN goes out, not when the GC collects the stream.
//
// Prints one JSON line: { deltaMiB }
//   deltaMiB   the RSS growth over <streams> streams after the first one
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, type SessionOptions } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

const BODY = 8 * 1024 * 1024;
const STREAMS = Number(process.argv[2]);
const body = Buffer.alloc(BODY, "body");

const serverStreams: any[] = [];
const server = await listen(
  (session: any) => {
    session.closed.catch(() => {});
    session.onstream = async (stream: any) => {
      stream.closed.catch(() => {});
      serverStreams.push(stream);
      for await (const _ of stream);
      stream.setBody(body);
    };
  },
  { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["body-release"] },
);

const client = await connect(server.address!, { alpn: "body-release", verifyPeer: "manual" } as SessionOptions);
client.closed.catch(() => {});
await client.opened;

const clientStreams: any[] = [];
async function fetchOne() {
  const stream = await client.createBidirectionalStream({ body: Buffer.from("get") });
  stream.closed.catch(() => {});
  clientStreams.push(stream);
  let arrived = 0;
  for await (const batch of stream) for (const chunk of batch) arrived += chunk.byteLength;
  // The iterator ends only once the server's FIN arrived.
  if (arrived !== BODY) throw new Error(`got ${arrived} of ${BODY} bytes`);
}

function rss() {
  Bun.gc(true);
  return process.memoryUsage.rss();
}

// Not measured: the first stream pays for the connection and the allocators.
await fetchOne();
const before = rss();
for (let i = 0; i < STREAMS; i++) await fetchOne();
const after = rss();

console.log(JSON.stringify({ deltaMiB: (after - before) / (1024 * 1024) }));
client.destroy();
server.destroy();
