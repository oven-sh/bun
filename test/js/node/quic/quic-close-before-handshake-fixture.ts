// Run by quic-stream.test.ts in a process of its own, because every case here
// used to crash. Each case is an HTTP/3 client whose handshake cannot end. It
// creates one stream, so the stream stays pending, and closes the session
// gracefully. One line per case says how the promises settle.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const GET = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };

const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => "fulfilled",
    e => e?.code ?? String(e),
  );

// Nothing answers on this socket.
const silent = await Bun.udpSocket({ hostname: "127.0.0.1" });
// An endpoint takes `handshakeTimeout` from its first connect(), so each
// session gets an endpoint of its own. No timer can then end a session here.
const endpoints: QuicEndpoint[] = [];
function connectToSilentPeer() {
  const endpoint = new QuicEndpoint();
  endpoints.push(endpoint);
  return connect(
    { address: "127.0.0.1", port: silent.port },
    {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      handshakeTimeout: 600_000,
      transportParams: { maxIdleTimeout: 0 },
    },
  );
}

// A close that waits for the pending stream gives no signal: it ends when a
// timer fires, and these sessions have no timer that can. The deadline
// reports that wait. The test passes it in, because it is longer in CI.
async function report(name: string, closed: Promise<unknown>, opened: Promise<string>, stream: Promise<string>) {
  const settled = (async () =>
    `closed ${await outcome(closed)}, opened ${await opened}, stream.closed ${await stream}`)();
  const deadline = Bun.sleep(Number(process.env.PARKED_AFTER_MS ?? 3000)).then(() => "still parked");
  return `${name}: ${await Promise.race([settled, deadline])}`;
}

const streams: Record<string, (session: any) => Promise<any>> = {
  "an empty stream": session => session.createBidirectionalStream({}),
  "a request": session => session.createBidirectionalStream({ headers: GET }),
  "a stream with a body": session => session.createBidirectionalStream({ body: new TextEncoder().encode("hello") }),
  "a unidirectional stream": session => session.createUnidirectionalStream({}),
};

const server = await listen(
  serverSession => {
    serverSession.onerror = () => {};
    serverSession.closed.catch(() => {});
  },
  {
    sni: {
      "*": {
        keys: [createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")))],
        certs: [readFileSync(join(keysDir, "agent1-cert.pem"))],
      },
    },
  },
);

const lines = await Promise.all([
  ...Object.keys(streams).map(async shape => {
    const session = await connectToSilentPeer();
    const opened = outcome(session.opened);
    const stream = outcome((await streams[shape](session)).closed);
    return report(`close(), ${shape}`, session.close(), opened, stream);
  }),
  (async () => {
    const session = await connectToSilentPeer();
    const opened = outcome(session.opened);
    const stream = outcome((await streams["a request"](session)).closed);
    return report("Symbol.asyncDispose", session[Symbol.asyncDispose](), opened, stream);
  })(),
  // Both clients use one endpoint. close() of the waiting client runs while
  // the endpoint dispatches the callback of the other client, so the endpoint
  // applies that close on its next pass and not inside close().
  (async () => {
    const waiting = await connectToSilentPeer();
    const opened = outcome(waiting.opened);
    const stream = outcome((await streams["a request"](waiting)).closed);
    const closeCalled = Promise.withResolvers<{ closed: Promise<unknown> }>();
    const live = await connect(server.address, {
      endpoint: waiting.endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      onhandshake() {
        closeCalled.resolve({ closed: waiting.close() });
      },
    });
    live.closed.then(() => closeCalled.reject(new Error("the live session closed first")), closeCalled.reject);
    const line = await report(
      "close() in a callback of another session",
      (await closeCalled.promise).closed,
      opened,
      stream,
    );
    live.close();
    return line;
  })(),
]);

console.log(lines.join("\n"));
// The server goes first: it must not answer to a client port that is closed.
await server.destroy();
await Promise.all(endpoints.map(endpoint => endpoint.destroy()));
process.exit(0);
