// Regression fixture: an HTTP/3 client gives up on a request whose response
// arrived with a gap in it.
//
// The UDP relay below keeps back the one server packet that carries the
// response headers and delivers the body and the QUIC FIN. The client stream
// then has the FIN with a gap before it, so the HTTP/3 layer can never reach
// the FIN and lsquic keeps the stream alive. The client's own FIN is
// acknowledged by then, so ending the read side leaves the stream closed both
// ways with nothing outstanding: lsquic finishes it and frees it in the next
// engine pass.
//
// A RESET_STREAM queued on the stream in that state used to leave a frame
// record pointing at freed memory, and the peer's acknowledgement read it back
// (heap-use-after-free in lsquic_stream_acked). The original report reached
// the state by chance, with 12 % packet loss on the path. The relay makes it
// exact.
//
// argv: <mode> <key.pem> <cert.pem>. The mode picks what the client does:
//   gap-stop-reset  stopSending() then resetStream()
//   gap-destroy     destroy() alone, on a request that has a body
//   ss-finished     stopSending() then resetStream(), after the peer's own
//                   STOP_SENDING reached the client
import { createPrivateKey, randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { connect, listen } from "node:quic";

const [mode, keyPath, certPath] = process.argv.slice(2);
const key = createPrivateKey(readFileSync(keyPath));
const cert = readFileSync(certPath);
const decode = (payload: Uint8Array) => new TextDecoder().decode(payload);
const encode = (text: string) => new TextEncoder().encode(text);
// A sanitizer build under load needs more than the 10 s default for the
// handshake. lsquic's server cap is a little over 16 s.
const budget = { handshakeTimeout: 15_000, transportParams: { maxIdleTimeout: 30 } };

// The relay tells packets apart by size: the padded response headers, and a
// retransmission of them, are larger than anything else on this connection.
// Random bytes keep QPACK from compressing the pad away.
const PAD = randomBytes(768).toString("base64");
const BIG = 450;
let holdBigToClient = false;
let holdAllToServer = false;
const toServer: Buffer[] = [];
const headersHeld = Promise.withResolvers<void>();
const requestEndHeld = Promise.withResolvers<void>();

const streamOnServer = Promise.withResolvers<any>();
let serverSession: any;
const server = await listen(
  (session: any) => {
    serverSession = session;
    session.onerror = () => {};
    session.closed.catch(() => {});
    session.ondatagram = (payload: Uint8Array) => {
      if (decode(payload) === "ping") session.sendDatagram("pong").catch(() => {});
    };
    session.onstream = (stream: any) => {
      stream.closed.catch(() => {});
      streamOnServer.resolve(stream);
    };
  },
  { alpn: ["h3"], sni: { "*": { keys: [key], certs: [cert] } }, ...budget },
);

const relay = createSocket("udp4");
await new Promise<void>(resolve => relay.bind(0, "127.0.0.1", resolve));
let upstream: ReturnType<typeof createSocket> | undefined;
let clientPort = 0;
relay.on("message", (msg, from) => {
  clientPort = from.port;
  if (!upstream) {
    upstream = createSocket("udp4");
    upstream.on("message", back => {
      if (!holdBigToClient || back.length <= BIG) return relay.send(back, clientPort, "127.0.0.1");
      headersHeld.resolve();
    });
  }
  if (!holdAllToServer) return upstream.send(msg, server.address!.port, "127.0.0.1");
  // Copy: the read buffer is reused for the next datagram.
  toServer.push(Buffer.from(msg));
  requestEndHeld.resolve();
});

let stream: any;
let pong = Promise.withResolvers<void>();
const peerStopArrived = Promise.withResolvers<void>();
const cancelled = Promise.withResolvers<void>();
const cancel = (
  {
    "gap-stop-reset": () => (stream.stopSending(5n), stream.resetStream(5n)),
    "gap-destroy": () => stream.destroy(),
    "ss-finished": () => (stream.stopSending(5n), stream.resetStream(5n)),
  } as Record<string, () => void>
)[mode];
const session: any = await connect(
  // A plain { address, port }, which connect() takes and its types do not.
  { address: "127.0.0.1", port: relay.address().port } as any,
  {
    alpn: "h3",
    servername: "localhost",
    verifyPeer: "manual",
    ...budget,
    onerror() {},
    ondatagram(payload: Uint8Array) {
      const text = decode(payload);
      if (text === "pong") return pong.resolve();
      if (text === "peer-stop") return peerStopArrived.resolve();
      if (text !== "cancel") return;
      // Session callbacks run inside the endpoint's send scope, so no engine
      // pass can run between the calls `cancel` makes.
      cancel();
      cancelled.resolve();
    },
  } as any,
);
session.closed.catch(() => {});
await session.opened;

// Everything either side sent before the round trip is processed, and
// acknowledged, when it returns.
async function roundTrip() {
  pong = Promise.withResolvers();
  await session.sendDatagram("ping");
  await pong.promise;
}

const post = { ":method": "POST", ":path": "/", ":scheme": "https", ":authority": "localhost" };
if (mode === "ss-finished") {
  // The request ends while the relay keeps the client's packets from the
  // server, so the server's stopSending() still puts a STOP_SENDING on the
  // wire. It reaches the client after the client's FIN left. The FIN is
  // acknowledged once the relay lets it through.
  stream = await session.createBidirectionalStream({});
  stream.sendHeaders(post);
  const serverStream = await streamOnServer.promise;
  await roundTrip();
  holdAllToServer = true;
  stream.writer.writeSync(encode("ask"));
  stream.writer.endSync();
  await requestEndHeld.promise;
  serverStream.stopSending(77n);
  await serverSession.sendDatagram("peer-stop");
  await peerStopArrived.promise;
  holdAllToServer = false;
  for (const msg of toServer) upstream!.send(msg, server.address!.port, "127.0.0.1");
} else if (mode === "gap-destroy") {
  stream = await session.createBidirectionalStream({ headers: post, body: Buffer.from("ask") });
} else {
  // A headers-only GET: the client's send side carries a FIN.
  stream = await session.createBidirectionalStream({
    headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
  });
}
stream.closed.catch(() => {});
const serverStream = await streamOnServer.promise;
// The client stream has no unacknowledged frames left after this.
await roundTrip();

// The relay keeps the response headers back. The body and the QUIC FIN reach
// the client, the bytes before them do not.
holdBigToClient = true;
serverStream.sendHeaders({ ":status": "200", "x-pad": PAD });
await headersHeld.promise;
serverStream.writer.writeSync(encode("answer"));
serverStream.writer.endSync();

// One datagram behind the FIN packet. The relay is one socket pair, so its
// arrival in the client proves the FIN packet was processed.
await serverSession.sendDatagram("cancel");
await cancelled.promise;

// The gap has done its work. Let the retransmitted headers through, so the
// server's loss recovery does not hold up what follows.
holdBigToClient = false;

// The engine runs the pass the cancel scheduled, and the peer acknowledges
// whatever that pass put on the wire, before this returns.
await roundTrip();

// The stream ends without the missing packet.
await stream.closed.catch(() => {});
console.log("done");
process.exit(0);
