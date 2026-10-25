// One server and one client. The client lets the server send `window` bytes on the connection, and the server
// answers every request in one turn with a body and trailers, which is several times that. It prints the
// responses that did not arrive whole.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect, listen, type SessionOptions } from "node:quic";

const [keyPath, certPath] = process.argv.slice(2);
const [streams, bodySize, trailerSize, window] = process.argv.slice(4).map(Number);
const body = Buffer.alloc(bodySize, "b");
const trailerValue = Buffer.alloc(trailerSize, "X").toString();

const unanswered: any[] = [];
const server = await listen(
  async session => {
    session.onerror = () => {};
    session.onstream = (stream: any) => void stream.closed.catch(() => {});
    await session.closed.catch(() => {});
  },
  {
    sni: { "*": { keys: [createPrivateKey(readFileSync(keyPath))], certs: [readFileSync(certPath)] } },
    transportParams: { maxIdleTimeout: 10, initialMaxStreamsBidi: streams },
    onheaders(this: any) {
      if (unanswered.push(this) < streams) return;
      for (const stream of unanswered) {
        stream.sendHeaders({ ":status": "200" });
        stream.writer.writeSync(body);
        stream.writer.endSync();
      }
    },
    onwanttrailers(this: any) {
      this.sendTrailers({ "x-filler": trailerValue });
    },
  },
);

const client = await connect(server.address!, {
  servername: "localhost",
  verifyPeer: "manual",
  transportParams: { maxIdleTimeout: 10, initialMaxData: window },
  onerror() {},
} as SessionOptions);
await client.opened;
const closed = client.closed.then(
  () => undefined,
  error => String(error?.message ?? error),
);
const wrong: string[] = [];
await Promise.all(
  Array.from({ length: streams }, async (_, i) => {
    let bytes = 0;
    let trailers: number | undefined;
    let failed: string | undefined;
    try {
      const stream: any = await client.createBidirectionalStream({
        headers: { ":method": "GET", ":path": `/${i}`, ":scheme": "https", ":authority": "localhost" },
        onheaders() {},
        ontrailers(received: Record<string, string>) {
          trailers = received["x-filler"]?.length;
        },
      } as any);
      for await (const batch of stream) for (const chunk of batch) bytes += chunk.byteLength;
      await stream.closed;
    } catch (error: any) {
      failed = String(error?.code ?? error);
    }
    if (failed || bytes !== bodySize || trailers !== trailerSize) {
      wrong.push(`stream ${i}: ${failed ?? `${bytes} body bytes, a ${trailers}-byte trailer`}`);
    }
  }),
);
client.close();
console.log(JSON.stringify({ wrong, closed: await closed }));
process.exit(0);
