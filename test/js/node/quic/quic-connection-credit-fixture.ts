// The server, the client, and a UDP relay between them, for "a HEADERS frame that has no connection credit waits for
// it". The relay first keeps a flight of the server from the client, so that the server gets no ACK for it. Later it
// keeps the client's MAX_DATA from the server. This is its own process because an assertion of lsquic stops a debug
// build that does not have the fix.
//
//   <key> <cert> <flight>
//
// The flight is what the server writes in one turn before it uses up the connection's credit:
//   bodies              The response headers left earlier. The flight is the bodies, and it ends inside one of them.
//   headers-and-bodies  The flight is whole responses. The ones that got no packet are in their streams' buffers.
//
// Prints two lines of JSON. The first has the bytes of header fields, bodies and trailers that the client got while
// the server had no MAX_DATA from it, and how often lsquic held a frame header back for connection credit. The
// second has the number of responses that were whole after the server got the MAX_DATA.
import { lsquicFrameHeaderWaits } from "bun:internal-for-testing";
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFileSync, writeSync } from "node:fs";
import { connect, listen, type SessionOptions } from "node:quic";

const [keyPath, certPath, flight] = process.argv.slice(2);
if (flight !== "bodies" && flight !== "headers-and-bodies") throw new Error(`unknown flight: ${flight}`);
const headersEarly = flight === "bodies";
// More responses than the server's first flight holds: lsquic's first congestion window is about 54,000 bytes.
const streams = 170;
// The client's connection window. Half of it is more than that flight, so the client's ACKs for the flight come
// with no MAX_DATA.
const window = 136_000;
// No packet holds a whole number of these bodies, so the flight ends inside one of them. A response of the second
// flight is a header field of about this size and a small body: it fits into a stream's buffer in lsquic.
const bodySize = (i: number) => (headersEarly ? 380 + (i % 5) * 9 : 30);
const fieldSize = (i: number) => (headersEarly ? 0 : 480 + (i % 5) * 9);
const field = (i: number) => Buffer.alloc(fieldSize(i), "X").toString();
// "X" has an 8-bit Huffman code, so QPACK sends such a value as it is. The first size fits into a stream's buffer
// in lsquic next to nothing else. The second size does not fit into it.
const [trailers, trailersForAPacket] = [1100, 1400].map(size => ({ "x-filler": Buffer.alloc(size, "X").toString() }));

const responses: [stream: any, i: number][] = [];
const wantTrailers: any[] = [];
let creditIsUsedUp = false;
let serverSession: any;
// The request that the server answers when it has every other request.
let sync: any;
const answerSync = () => {
  if (sync && responses.length === streams) sync.sendHeaders({ ":status": "204" }, { terminal: true });
};
const staged = Promise.withResolvers<void>();
const server = await listen(
  session => {
    serverSession = session;
    session.onerror = () => {};
    session.closed.catch(() => {});
    session.onstream = (stream: any) => void stream.closed.catch(() => {});
  },
  {
    sni: { "*": { keys: [createPrivateKey(readFileSync(keyPath))], certs: [readFileSync(certPath)] } },
    // Without this, lsquic picks one of two congestion controllers by its first round-trip time. The numbers above
    // are for this one.
    cc: "cubic",
    transportParams: { maxIdleTimeout: 20, initialMaxStreamsBidi: 1000 },
    onheaders(this: any, headers: Record<string, string>) {
      const path = headers[":path"];
      if (path === "/sync") {
        sync = this;
        return answerSync();
      }
      if (path !== "/go") {
        if (headersEarly) this.sendHeaders({ ":status": "200" });
        responses.push([this, Number(path.slice(1))]);
        return answerSync();
      }
      // The client's last request. The client has every packet that the server sent, and this request's packet
      // acknowledged them. The relay keeps the flight from the client, so the congestion window fills and stays full.
      const { stats } = serverSession;
      const sentBefore = stats.bytesSent;
      const lostBefore = stats.pktLost;
      for (const [stream, i] of responses) {
        if (!headersEarly) stream.sendHeaders({ ":status": "200", "x-filler": field(i) });
        stream.writer.writeSync(Buffer.alloc(bodySize(i), "b"));
        stream.writer.endSync();
      }
      const useUpTheCredit = () => {
        // A machine that stalls for longer than the idle timeout loses the session.
        if (serverSession.destroyed) return staged.resolve();
        // The flight is over when its bytes fill the congestion window. Before that, lsquic's pacer can hold the
        // next packet back for a moment. lsquic also probes twice for a lost packet and then takes every packet for
        // lost. After that it holds the rest of the flight back, so the window does not fill on a machine that is
        // this slow.
        const flightIsOver = stats.bytesSent - sentBefore >= stats.cwnd || stats.pktLost - lostBefore > 2n;
        if (!flightIsOver) return void setImmediate(useUpTheCredit);
        const sent = wantTrailers.splice(0);
        // The last response of the flight has the end of its body in lsquic's buffer. In the second flight it has
        // its whole body there.
        const last = sent.pop();
        // lsquic keeps up to 10 packets for a connection that may not send. These trailers fill them.
        for (const stream of sent.splice(0, 16)) stream.sendTrailers(trailers);
        // Now there is no packet, and these trailers need one: they wait outside of the stream's buffer, while the
        // connection still has credit. The priority puts this stream first when the client's ACKs give packets.
        last?.setPriority({ level: "high" });
        last?.sendTrailers(trailersForAPacket);
        // The trailers of the other responses go to their streams' buffers and take all the credit that is left.
        for (const stream of sent) stream.sendTrailers(trailers);
        creditIsUsedUp = true;
        staged.resolve();
      };
      useUpTheCredit();
    },
    onwanttrailers(this: any) {
      if (creditIsUsedUp) this.sendTrailers(trailers);
      else wantTrailers.push(this);
    },
  },
);

// The relay. The client talks to `front`, and `upstream` is the client as the server sees it.
const front = createSocket("udp4");
const upstream = createSocket("udp4");
front.bind(0, "127.0.0.1");
upstream.bind(0, "127.0.0.1");
await Promise.all([once(front, "listening"), once(upstream, "listening")]);
let clientPort = 0;
// The server's packets wait here while the client may not see them.
let keptFromClient: Buffer[] | undefined;
// The client's packets wait here while the server may not see them.
let keptFromServer: Buffer[] | undefined;
let passedToClient = 0;
let lostWhenKept = 0n;
// Set at the end: the server may have the client's MAX_DATA.
let maxDataMayPass = false;
const toClient = (packet: Buffer) => {
  passedToClient += packet.length;
  front.send(packet, clientPort, "127.0.0.1");
  // The client sends MAX_DATA when it has read more than half of its window. It has less than that now, so no
  // MAX_DATA is on its way. From here on the server gets nothing from the client.
  if (creditIsUsedUp && !maxDataMayPass && !keptFromClient && !keptFromServer && passedToClient >= window / 2) {
    keptFromServer = [];
    lostWhenKept = serverSession.stats.pktLost;
  }
};
upstream.on("message", packet => {
  if (keptFromClient) keptFromClient.push(Buffer.from(packet));
  else toClient(packet);
});
front.on("message", (packet, from) => {
  clientPort = from.port;
  if (keptFromServer) keptFromServer.push(Buffer.from(packet));
  else upstream.send(packet, server.address!.port, "127.0.0.1");
});

const session = await connect(`127.0.0.1:${front.address().port}`, {
  servername: "localhost",
  verifyPeer: "manual",
  transportParams: { maxIdleTimeout: 20, initialMaxData: window },
  onerror() {},
} as SessionOptions);
session.closed.catch(() => {});
await session.opened;
const request = (path: string) => ({ ":method": "GET", ":path": path, ":scheme": "https", ":authority": "localhost" });
// The bytes of header fields, bodies and trailers.
let received = 0;
let responseHeaders = 0;
const everyResponseHeader = Promise.withResolvers<void>();
// If each response came whole.
const whole: Promise<boolean>[] = [];
for (let i = 0; i < streams; i++) {
  whole.push(
    (async () => {
      let fieldLength = -1;
      let body = 0;
      let trailers = 0;
      const stream: any = await session.createBidirectionalStream({
        headers: request(`/${i}`),
        onheaders(block: Record<string, string>) {
          fieldLength = block["x-filler"]?.length ?? 0;
          received += fieldLength;
          if (++responseHeaders === streams) everyResponseHeader.resolve();
        },
        ontrailers(block: Record<string, string>) {
          trailers = block["x-filler"].length;
          received += trailers;
        },
      } as any);
      stream.closed.catch(() => {});
      for await (const batch of stream) {
        for (const chunk of batch) {
          body += chunk.byteLength;
          received += chunk.byteLength;
        }
      }
      return fieldLength === fieldSize(i) && body === bodySize(i) && trailers > 0;
    })().catch(() => false),
  );
}
session.closed.then(everyResponseHeader.resolve, everyResponseHeader.resolve);
if (headersEarly) {
  await everyResponseHeader.promise;
} else {
  // The server answers this request when it has every other one.
  const synced = Promise.withResolvers<void>();
  const stream: any = await session.createBidirectionalStream({
    headers: request("/sync"),
    onheaders: () => synced.resolve(),
  } as any);
  stream.closed.catch(() => {});
  session.closed.then(synced.resolve, synced.resolve);
  await synced.promise;
}

// The server writes its flight and uses up the connection's credit. The relay keeps the flight, so no ACK follows.
keptFromClient = [];
const go: any = await session.createBidirectionalStream({ headers: request("/go") } as any);
go.closed.catch(() => {});
await staged.promise;
// The client gets the flight, which is less than half of its window, so its ACKs come with no MAX_DATA. They give
// the server packets: the flush of the last response of the flight must stop in front of the HEADERS frame of its
// trailers.
for (const packet of keptFromClient) toClient(packet);
keptFromClient = undefined;

// The server now sends what its congestion window and the client's connection window allow. Then it has nothing
// left that it may send, and no ACK comes. It probes twice and takes the packets in flight for lost.
await new Promise<void>(resolve => {
  const serverIsQuiet = () => {
    const done =
      received > window ||
      (keptFromServer && serverSession.stats.pktLost - lostWhenKept > 2n) ||
      serverSession.destroyed;
    if (done) resolve();
    else setImmediate(serverIsQuiet);
  };
  serverIsQuiet();
});
writeSync(1, JSON.stringify({ bytes: received, heldBack: lsquicFrameHeaderWaits.connection() }) + "\n");

// The server gets the client's MAX_DATA. It has to send the frame headers that it held back, and the rest of every
// response.
maxDataMayPass = true;
for (const packet of keptFromServer ?? []) upstream.send(packet, server.address!.port, "127.0.0.1");
keptFromServer = undefined;
const complete = (await Promise.all(whole)).filter(Boolean).length;
writeSync(1, JSON.stringify({ complete }) + "\n");
process.exit(0);
