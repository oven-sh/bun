// The server answers each of argv[2] streams with a 4 MiB setBody(). Both ends
// keep every stream object, so the GC can't free a finished stream's queue.
// Prints the RSS growth after the first stream as { deltaMiB }.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, type SessionOptions } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

const body = Buffer.alloc(4 * 1024 * 1024, "body");
const streams: any[] = [];

const server = await listen(
  (session: any) => {
    session.closed.catch(() => {});
    session.onstream = async (stream: any) => {
      stream.closed.catch(() => {});
      streams.push(stream);
      for await (const _ of stream);
      stream.setBody(body);
    };
  },
  { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["body-release"] },
);

const client = await connect(server.address!, { alpn: "body-release", verifyPeer: "manual" } as SessionOptions);
client.closed.catch(() => {});
await client.opened;

async function fetchOne() {
  const stream = await client.createBidirectionalStream({ body: Buffer.from("get") });
  stream.closed.catch(() => {});
  streams.push(stream);
  let arrived = 0;
  for await (const batch of stream) for (const chunk of batch) arrived += chunk.byteLength;
  if (arrived !== body.byteLength) throw new Error(`got ${arrived} of ${body.byteLength} bytes`);
}

// Bun.gc(true) leaves returning freed pages to the OS to background scavengers. Bun.shrink() does it as soon as the VM is idle.
async function rss() {
  Bun.gc(true);
  Bun.shrink();
  await new Promise(resolve => setImmediate(resolve));
  return process.memoryUsage.rss();
}

await fetchOne();
const before = await rss();
for (let i = 0; i < Number(process.argv[2]); i++) await fetchOne();
console.log(JSON.stringify({ deltaMiB: ((await rss()) - before) / (1024 * 1024) }));
client.destroy();
server.destroy();
