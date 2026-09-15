// Shutdown shapes issued before a TLS handshake completes, as one report per
// mode. Runs on bun and on node, so node-tls-connect.test.ts can assert the
// same report for both.
//
// The readable side's 'end' is not part of these shapes, so the log does not
// subscribe to it: bun emits an extra one after destroy() (pre-existing, it
// reproduces on a plain net.Socket, tracked separately).
import { once } from "node:events";
import net from "node:net";
import { Duplex } from "node:stream";
import tls, { TLSSocket } from "node:tls";

const mode = process.argv[2];
const log = [];

function report(extra) {
  console.log(JSON.stringify({ log, ...extra }));
  process.exit(0);
}

// Ends the run at once, also while a top-level await below is still pending.
process.on("uncaughtException", error => {
  console.error(error);
  process.exit(1);
});

// Accepts the TCP connection, reads, and never answers the ClientHello: a dead
// TLS backend, a plaintext service on a TLS port, a middlebox. allowHalfOpen
// keeps it from closing when our FIN arrives, so the client's event list stays
// independent of the peer's teardown.
async function stalledPeer(allowHalfOpen = true) {
  const sawFin = Promise.withResolvers();
  let accepted;
  const server = net.createServer({ allowHalfOpen }, socket => {
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
} else if (mode === "wrap") {
  // new TLSSocket(stream) without isServer: a client-side wrap that nothing
  // starts a handshake on. Shutting it down shuts the wrapped stream down. One
  // report per method, each on a wrap and a stream of its own.
  const transport = process.argv[3];
  // "peer-closes": the peer closes when the FIN arrives. "refused": nothing listens.
  // Both close the stream under the wrap, and the wrap closes with it.
  const peerCloses = transport === "peer-closes";
  const refused = transport === "refused";

  async function shutDown(method) {
    const log = [];
    const peer = transport.startsWith("duplex") || refused ? undefined : await stalledPeer(!peerCloses);

    let raw;
    if (refused) {
      const server = net.createServer();
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address();
      await new Promise(resolve => server.close(resolve));
      raw = net.connect(port, "127.0.0.1");
      raw.on("error", error => log.push(`transport error:${error.code}`));
    } else if (peer === undefined) {
      raw = new Duplex({
        read() {},
        write(chunk, encoding, callback) {
          callback();
        },
        final(callback) {
          log.push("transport final");
          callback();
        },
      });
      // A stream's own close() is not the close(callback) of a handle: an
      // http2 stream takes close(code, callback).
      if (transport === "duplex-with-close") raw.close = code => log.push(`transport close(${typeof code})`);
    } else if (transport === "unconnected") {
      raw = new net.Socket();
    } else {
      raw = net.connect(peer.port, "127.0.0.1");
      if (transport === "connected" || peerCloses) await once(raw, "connect");
    }
    raw.on("connect", () => log.push("transport connect"));

    const socket = new TLSSocket(raw, { rejectUnauthorized: false });
    socket.on("finish", () => log.push("finish"));
    socket.on("error", error => log.push(`error:${error.code ?? error.message}`));
    socket.on("close", () => log.push("close"));

    socket[method]();
    // Only the graceful shapes owe the peer a FIN, and destroy() leaves nothing to connect.
    const peerSawFin = peer !== undefined && method !== "destroy";
    if (transport === "unconnected" && peerSawFin) raw.connect(peer.port, "127.0.0.1");

    const settled = method === "end" && !peerCloses && !refused ? "finish" : "close";
    await Promise.all([once(socket, settled), peerSawFin && peer.sawFin]);

    const { writableFinished, readyState, destroyed } = socket;
    const result = { log: [...log], peerSawFin, writableFinished, readyState, destroyed, transportDestroyed: raw.destroyed };
    socket.destroy();
    raw.destroy();
    peer?.close();
    return result;
  }

  const [end, destroySoon, destroy] = await Promise.all(["end", "destroySoon", "destroy"].map(shutDown));
  console.log(JSON.stringify({ end, destroySoon, destroy }));
  process.exit(0);
} else {
  throw new Error(`unknown mode ${mode}`);
}
