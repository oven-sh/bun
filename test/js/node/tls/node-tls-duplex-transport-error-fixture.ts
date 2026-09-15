// Wraps a Duplex in a TLS socket and destroys the Duplex with an error.
// SIDE=client wraps it with tls.connect(), SIDE=server with
// new tls.TLSSocket(transport, { isServer: true }), and SIDE=https gives the
// tls.connect() socket to https.request().
// WHEN=early destroys the Duplex in the tick of the wrap, before the TLS engine
// exists. WHEN=late destroys it once the engine runs: after the ClientHello for
// a client, one event-loop turn after the wrap for a server.
// Prints the events that the TLS socket, or the request, emitted.
import { tls as certs } from "harness";
import https from "node:https";
import { Duplex } from "node:stream";
import tls from "node:tls";

const { SIDE: side, WHEN: when } = process.env;
const seen: string[] = [];
process.on("exit", () => console.log(seen.join("|")));

let started = false;
const transport = new Duplex({
  read() {},
  write(_chunk, _encoding, callback) {
    callback();
    if (started) return;
    started = true;
    if (when === "late") process.nextTick(kill);
  },
});

function kill() {
  transport.destroy(new Error("transport failed"));
}

function record(socket: tls.TLSSocket) {
  socket.on("_tlsError", err => seen.push(`_tlsError:${err.message}`));
  socket.on("error", err => seen.push(`error:${err.message}`));
  socket.on("close", hadError => seen.push(`close:${hadError}`));
}

if (side === "server") {
  record(new tls.TLSSocket(transport, { isServer: true, key: certs.key, cert: certs.cert }));
  // A server writes nothing until its peer does. The task that creates the
  // engine is queued ahead of this one.
  if (when === "late") setImmediate(kill);
} else if (side === "https") {
  const req = https.request({
    host: "localhost",
    path: "/",
    createConnection: () => tls.connect({ socket: transport, rejectUnauthorized: false }),
  });
  req.on("error", err => seen.push(`req.error:${err.message}`));
  req.on("close", () => seen.push(`req.close:${req.destroyed}`));
  req.end();
} else {
  record(tls.connect({ socket: transport, rejectUnauthorized: false }));
}

if (when === "early") kill();
