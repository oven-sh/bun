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
} else if (mode === "server-end") {
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
    // bun's wrap adopts the connection's handle on a later turn, so end() from
    // the turn after the wrap is the reported shape: the engine runs and waits
    // for a client flight that never arrives.
    setImmediate(() => {
      log.push(`end secureConnecting=${socket.secureConnecting}`);
      socket.end();
    });
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
} else {
  throw new Error(`unknown mode ${mode}`);
}
