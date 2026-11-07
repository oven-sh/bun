// One process hosts an HTTP/3 server and its client. In each flight the client
// sends FLIGHT requests in one turn, so their response header blocks wait in
// the client session's queue together. In the first `onheaders` the client
// destroys the other requests of the flight, collects them and sends FRESH
// requests, which take the freed blocks.
//
// Prints one JSON line: for each fresh request, the `x-id` values that its
// `onheaders` received. The server answers each request with the request path.
// If a fresh request cannot get its own answer, the line names that failure.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect, listen, type QuicStream, type SessionOptions } from "node:quic";

const [keyPath, certPath] = process.argv.slice(2);
const key = createPrivateKey(readFileSync(keyPath));
const cert = readFileSync(certPath);

const FLIGHTS = 2;
const FLIGHT = 8;
const FRESH = 8;
// A lost answer ends as an idle close of the session, not as the timeout of the test.
const transportParams = { maxIdleTimeout: 10, initialMaxStreamsBidi: 1024 };
const request = (path: string) => ({ ":method": "GET", ":path": path, ":scheme": "https", ":authority": "localhost" });

const server = await listen(
  session => {
    session.closed.catch(() => {});
    session.onstream = stream => {
      stream.closed.catch(() => {});
    };
  },
  {
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams,
    onheaders(headers) {
      const path = String(headers[":path"]);
      this.sendHeaders({ ":status": "200", "x-id": path });
      // A refused request stays open, so only its header block is queued.
      if (path.startsWith("/fresh/")) this.writer.endSync();
    },
  },
);

const client = await connect(server.address!, {
  servername: "localhost",
  verifyPeer: "manual",
  transportParams,
} as SessionOptions);
const failed = Promise.withResolvers<string>();
client.closed.then(
  () => failed.resolve("the session closed"),
  error => failed.resolve("the session closed: " + error),
);
await client.opened;

const received: string[][] = [];
for (let flight = 0; flight < FLIGHTS; flight++) {
  const answered = Promise.withResolvers<QuicStream>();
  const first = received.length;
  let refused: QuicStream[] | undefined;
  const onFirstResponse = function (this: QuicStream) {
    const others = refused;
    if (others === undefined) return;
    refused = undefined;
    for (const other of others) if (other !== this) other.destroy();
    // A destroyed stream keeps its native handle until it is collected.
    others.length = 0;
    Bun.gc(true);
    for (let i = 0; i < FRESH; i++) {
      const id = received.length;
      const got: string[] = [];
      received.push(got);
      client
        .createBidirectionalStream({
          headers: request("/fresh/" + id),
          onheaders: headers => {
            got.push(String(headers["x-id"]));
            if (received.slice(first).every((seen, n) => seen.includes("/fresh/" + (first + n))))
              answered.resolve(this);
          },
        })
        .then(stream => {
          const settled = () => {
            if (!got.includes("/fresh/" + id)) failed.resolve("/fresh/" + id + " closed before its headers");
          };
          stream.closed.then(settled, settled);
        });
    }
  };
  refused = await Promise.all(
    Array.from({ length: FLIGHT }, (_, i) =>
      client.createBidirectionalStream({ headers: request(`/refused/${flight}/${i}`), onheaders: onFirstResponse }),
    ),
  );
  for (const stream of refused) stream.closed.catch(() => {});
  const survivor = await Promise.race([answered.promise, failed.promise]);
  if (typeof survivor === "string") {
    console.log(JSON.stringify({ failed: survivor, received }));
    process.exit(1);
  }
  survivor.destroy();
}

console.log(JSON.stringify(received));
await client.close();
await server.close();
