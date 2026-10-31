// Node peer for the "pooled socket that is mid-renegotiation" test in
// fetch.tls.test.ts. It has to be Node: BoringSSL cannot start a renegotiation
// from the server side, so a Bun server cannot send a HelloRequest.
//
//   origin:  a TLS 1.2 keep-alive https server
//   relay:   a TCP proxy in front of the origin that can hold the client's bytes
//   control: a plain http server through which the client fixture drives both
//
// The first line on stdout is "<relayPort> <controlPort>".
import http from "node:http";
import https from "node:https";
import net from "node:net";

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

// One entry per TLS connection: did the client resume a cached session?
// A renegotiation adds no entry, it runs on the connection it belongs to.
const resumed = [];
let lastSecure;
const origin = https.createServer(
  { key: process.env.SERVER_KEY, cert: process.env.SERVER_CERT, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" },
  (req, res) => res.end("ok"),
);
// The idle connection has to stay open however slow the machine is.
origin.keepAliveTimeout = 0;
origin.on("secureConnection", socket => {
  lastSecure = socket;
  resumed.push(socket.isSessionReused());
  socket.on("error", () => {});
});
origin.on("tlsClientError", () => {});
const originPort = await listen(origin);

let holding = false;
let onHeld;
const releases = [];
const relay = net.createServer(client => {
  const upstream = net.connect(originPort, "127.0.0.1");
  const held = [];
  releases.push(() => {
    for (const chunk of held.splice(0)) upstream.write(chunk);
  });
  client.on("data", chunk => {
    if (!holding) return void upstream.write(chunk);
    held.push(chunk);
    // The connection is idle, so the first held chunk is the client's
    // renegotiation ClientHello. Its first byte is the TLS record type.
    onHeld?.(chunk[0]);
    onHeld = undefined;
  });
  upstream.on("data", chunk => client.write(chunk));
  for (const socket of [client, upstream]) {
    socket.on("error", () => {});
    socket.on("close", () => {
      client.destroy();
      upstream.destroy();
    });
  }
});
const relayPort = await listen(relay);

const control = http.createServer((req, res) => {
  switch (req.url) {
    case "/renegotiate": {
      // Answers once the relay holds the client's ClientHello. From then on
      // the client's SSL is mid-handshake, until "/release".
      holding = true;
      onHeld = recordType => res.end(String(recordType));
      // A renegotiation that does not start must not leave the client waiting.
      const fail = reason => void (res.writableEnded || res.end("no renegotiation: " + reason));
      lastSecure.once("close", () => fail("the connection closed"));
      if (!lastSecure.renegotiate({}, error => error && fail(error.code))) fail("refused");
      return;
    }
    case "/release":
      holding = false;
      for (const release of releases) release();
      return void res.end("released");
    case "/resumed":
      return void res.end(JSON.stringify(resumed));
    default:
      return void res.end("pong");
  }
});
const controlPort = await listen(control);
console.log(relayPort, controlPort);
