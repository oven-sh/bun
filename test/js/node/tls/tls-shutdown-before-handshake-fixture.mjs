// Shutdown shapes issued before a TLS handshake completes, as one report per
// mode. Runs on bun and on node, so node-tls-connect.test.ts can assert the
// same report for both.
//
// The readable side's 'end' is not part of these shapes, so the log does not
// subscribe to it: bun emits an extra one after destroy() (pre-existing, it
// reproduces on a plain net.Socket, tracked separately).
import { once } from "node:events";
import net from "node:net";
import tls, { TLSSocket } from "node:tls";

const mode = process.argv[2];
const log = [];

function report(extra) {
  console.log(JSON.stringify({ log, ...extra }));
  process.exit(0);
}

// Accepts the TCP connection, reads, and never answers the ClientHello: a dead
// TLS backend, a plaintext service on a TLS port, a middlebox. allowHalfOpen
// keeps it from closing when our FIN arrives, so the client's event list stays
// independent of the peer's teardown.
async function stalledPeer() {
  const sawFin = Promise.withResolvers();
  let accepted;
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    accepted = socket;
    socket.on("data", () => {});
    socket.on("error", () => {});
    socket.on("end", () => sawFin.resolve());
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    sawFin: sawFin.promise,
    close() {
      accepted?.destroy();
      server.close();
    },
  };
}

if (mode === "end" || mode === "destroySoon") {
  const peer = await stalledPeer();
  const client = tls.connect({ port: peer.port, host: "127.0.0.1", rejectUnauthorized: false });
  for (const event of ["secureConnect", "finish", "error", "close"]) {
    client.on(event, arg => log.push(arg?.code ? `${event}:${arg.code}` : event));
  }
  // 'connect' is the TCP connection, so the handshake has not completed yet -
  // and with this peer it never will.
  client.on("connect", () => {
    log.push(`connect secureConnecting=${client.secureConnecting}`);
    client[mode]();
  });

  await Promise.all([once(client, mode === "end" ? "finish" : "close"), peer.sawFin]);

  const { writableFinished, readyState, destroyed } = client;
  client.destroy();
  peer.close();
  report({ peerSawFin: true, writableFinished, readyState, destroyed });
} else if (mode === "server-end" || mode === "server-end-same-tick") {
  const clientSawFin = Promise.withResolvers();
  let serverSocket;
  const server = net.createServer(raw => {
    const socket = (serverSocket = new TLSSocket(raw, {
      isServer: true,
      key: process.env.TLS_KEY,
      cert: process.env.TLS_CERT,
    }));
    socket.on("error", () => {});
    raw.on("error", () => {});
    socket.on("finish", () => log.push("finish"));
    const end = () => {
      log.push(`end secureConnecting=${socket.secureConnecting}`);
      socket.end();
    };
    // bun's wrap adopts the connection's handle on a later turn. end() from the
    // turn after the wrap finds the engine waiting for a client flight that
    // never arrives. end() in the wrap's own tick finds no handle yet.
    if (mode === "server-end") setImmediate(end);
    else end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  const client = net.connect({ port: server.address().port, host: "127.0.0.1", allowHalfOpen: true });
  client.on("data", () => {});
  client.on("error", () => {});
  client.on("end", () => clientSawFin.resolve());

  await clientSawFin.promise;

  client.destroy();
  serverSocket?.destroy();
  server.close();
  report({ clientSawFin: true });
} else if (mode === "end-over-connecting-socket") {
  // The zero-length chunk is parked until the wrapped socket connects. It then
  // reaches the engine ahead of the handshake, so the close_notify and the FIN
  // follow the handshake and the server sees a clean end.
  const serverSawEnd = Promise.withResolvers();
  const server = tls.createServer({ key: process.env.TLS_KEY, cert: process.env.TLS_CERT }, socket => {
    socket.on("error", () => {});
    socket.on("data", () => {});
    socket.on("end", () => serverSawEnd.resolve());
  });
  server.on("tlsClientError", serverSawEnd.reject);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  const raw = net.connect({ port: server.address().port, host: "127.0.0.1" });
  const client = tls.connect({ socket: raw, rejectUnauthorized: false });
  for (const event of ["secureConnect", "finish", "close"]) client.on(event, () => log.push(event));
  client.on("error", error => log.push(`error:${error.code}`));
  client.on("data", () => {});
  log.push(`end connecting=${client.connecting}`);
  client.end("");

  await Promise.all([once(client, "close"), serverSawEnd.promise]);

  server.close();
  report({ serverSawEnd: true });
} else {
  throw new Error(`unknown mode ${mode}`);
}
