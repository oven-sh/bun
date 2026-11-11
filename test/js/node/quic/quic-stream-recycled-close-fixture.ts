// Each flight, the client opens FLIGHT unidirectional streams in one tick. The server destroys the
// first REFUSED of them in `onstream` while their read and close events are still queued on the
// session, runs GC, and opens FRESH streams that reuse the freed allocations. If a stale close event
// reaches a fresh stream, it loses its GC root and the next GC frees it while lsquic is still writing.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect, listen, type QuicStream, type SessionOptions } from "node:quic";

const [keyPath, certPath] = process.argv.slice(2);
const key = createPrivateKey(readFileSync(keyPath));
const cert = readFileSync(certPath);

const FLIGHTS = 2;
const FLIGHT = 8;
const REFUSED = 6;
const FRESH = 8;
// Larger than lsquic accepts in one write, so each stream still has a pending write after its flight.
const BODY = 65536;
// If a body is lost, the session idles out before the test times out.
const transportParams = { maxIdleTimeout: 10, initialMaxStreamsUni: 1024 };

let opened = 0;
let delivered = 0;
const closedBeforeSent: { id: number; sent: number; error?: string }[] = [];
const failed = Promise.withResolvers<void>();
let flightDelivered = Promise.withResolvers<void>();

async function read(stream: QuicStream) {
  const chunks: Uint8Array[] = [];
  for await (const batch of stream) chunks.push(...batch);
  return Buffer.concat(chunks);
}

const server = await listen(
  session => {
    session.closed.catch(() => {});
    let seen = 0;
    session.onstream = stream => {
      stream.closed.catch(() => {});
      const index = seen++ % FLIGHT;
      if (index < REFUSED) {
        stream.destroy();
        return;
      }
      read(stream).catch(() => {});
      if (index !== REFUSED) return;
      Bun.gc(true);
      for (let i = 0; i < FRESH; i++) {
        const id = opened++;
        const body = Buffer.alloc(BODY, 0x66);
        body.writeUInt32LE(id, 0);
        session.createUnidirectionalStream({ body }).then(fresh => {
          // `stats` is created lazily, and it reads all zeros if it's first accessed after the close.
          const stats = fresh.stats;
          const settled = (error?: unknown) => {
            const sent = Number(stats.bytesSent);
            if (sent === BODY && error === undefined) return;
            closedBeforeSent.push({ id, sent, error: error === undefined ? undefined : String(error) });
            failed.resolve();
          };
          fresh.closed.then(() => settled(), settled);
        });
      }
    };
  },
  { alpn: ["echo"], sni: { "*": { keys: [key], certs: [cert] } }, transportParams },
);

const client = await connect(server.address!, {
  alpn: "echo",
  servername: "localhost",
  verifyPeer: "manual",
  transportParams,
  onstream(stream: QuicStream) {
    stream.closed.catch(() => {});
    read(stream).then(
      body => {
        if (body.length === BODY) delivered++;
        if (delivered === opened) flightDelivered.resolve();
      },
      () => {},
    );
  },
} as SessionOptions);
client.closed.then(
  () => failed.resolve(),
  () => failed.resolve(),
);
await client.opened;

let ok = true;
for (let flight = 0; flight < FLIGHTS; flight++) {
  flightDelivered = Promise.withResolvers<void>();
  for (let i = 0; i < FLIGHT; i++) {
    client.createUnidirectionalStream({ body: Buffer.from("s" + i) }).then(stream => stream.closed.catch(() => {}));
  }
  if (!(await Promise.race([flightDelivered.promise.then(() => true), failed.promise.then(() => false)]))) ok = false;
  // Let the flight's callbacks return, run GC, then let lsquic write again.
  await new Promise(resolve => setImmediate(resolve));
  Bun.gc(true);
  await new Promise(resolve => setImmediate(resolve));
}

console.log(JSON.stringify({ opened, delivered, closedBeforeSent }));
// After a bogus close event the sessions can't close cleanly.
if (!ok) process.exit(1);
await client.close();
await server.close();
