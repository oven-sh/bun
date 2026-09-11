// Shutdown shapes issued before a TLS handshake completes, as one report per
// mode. Runs on bun and on node, so node-tls-connect.test.ts can assert the
// same report for both. "duplex-end-established" is the one shape issued after
// the handshake: it shares the stream transport below.
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

// Accepts the TCP connection, reads, and never answers the ClientHello: a dead
// TLS backend, a plaintext service on a TLS port, a middlebox. allowHalfOpen
// keeps it from closing when our FIN arrives, so the client's event list stays
// independent of the peer's teardown.
async function stalledPeer() {
  const sawFin = Promise.withResolvers();
  const received = [];
  let accepted;
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    accepted = socket;
    socket.on("data", chunk => received.push(chunk));
    socket.on("error", () => {});
    socket.on("end", () => sawFin.resolve());
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    sawFin: sawFin.promise,
    // 0x16 is the TLS record type of a handshake message.
    sawHandshakeRecord: () => Buffer.concat(received)[0] === 0x16,
    close() {
      accepted?.destroy();
      server.close();
    },
  };
}

// A generic stream between the TLS socket and the TCP connection, so the TLS
// engine runs over a stream and not over an fd. Only final() sends a FIN while
// the stream stays open. destroy() closes the connection, as a real transport
// does.
function transportOver(raw) {
  const wrote = Promise.withResolvers();
  const received = Promise.withResolvers();
  const state = {
    finalCalled: false,
    // 0x16 is the TLS record type of a handshake message.
    wroteHandshakeRecord: false,
    wrote: wrote.promise,
    received: received.promise,
  };
  state.stream = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      state.wroteHandshakeRecord ||= chunk[0] === 0x16;
      wrote.resolve();
      raw.write(chunk, encoding, callback);
    },
    final(callback) {
      state.finalCalled = true;
      raw.end(callback);
    },
    destroy(error, callback) {
      raw.destroy();
      callback(error);
    },
  });
  state.stream.on("error", () => {});
  raw.on("data", chunk => {
    state.stream.push(chunk);
    received.resolve();
  });
  raw.on("end", () => state.stream.push(null));
  raw.on("error", () => {});
  return state;
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
} else if (mode === "duplex-end" || mode === "duplex-destroySoon") {
  // "same-turn": bun creates the engine for a stream transport on a later
  // event-loop turn, so this call arrives before the engine exists.
  // "after-first-flight": the engine wrote its ClientHello and waits for an
  // answer that never comes.
  const method = mode.slice("duplex-".length);
  const when = process.argv[3];
  const peer = await stalledPeer();
  const raw = net.connect(peer.port, "127.0.0.1");
  await once(raw, "connect");
  const transport = transportOver(raw);
  const client = tls.connect({ socket: transport.stream, rejectUnauthorized: false });
  for (const event of ["secureConnect", "finish", "error", "close"]) {
    client.on(event, arg => log.push(arg?.code ? `${event}:${arg.code}` : event));
  }
  if (when === "after-first-flight") await transport.wrote;
  log.push(`${method} secureConnecting=${client.secureConnecting}`);
  client[method]();

  await Promise.all([once(client, method === "end" ? "finish" : "close"), peer.sawFin]);

  const { writableFinished, readyState, destroyed } = client;
  client.destroy();
  raw.destroy();
  peer.close();
  report({
    transportFinalCalled: transport.finalCalled,
    peerSawFin: true,
    peerSawHandshakeRecord: peer.sawHandshakeRecord(),
    writableFinished,
    readyState,
    destroyed,
  });
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
} else if (mode === "duplex-end-live-server") {
  // The server is healthy. A FIN in the middle of the handshake must make it
  // give up: without the FIN the handshake completes and the session stays
  // open with nothing left to close it.
  const serverOutcome = Promise.withResolvers();
  const server = tls.createServer({ key: process.env.TLS_KEY, cert: process.env.TLS_CERT }, socket => {
    socket.on("error", () => {});
    serverOutcome.resolve("secureConnection");
  });
  server.on("tlsClientError", error => serverOutcome.resolve(`tlsClientError:${error.code}`));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  const raw = net.connect(server.address().port, "127.0.0.1");
  await once(raw, "connect");
  const transport = transportOver(raw);
  const client = tls.connect({ socket: transport.stream, rejectUnauthorized: false });
  // node's engine also completes its side of the handshake and then fails the
  // write of its last flight to the ended stream. Neither is part of this shape.
  client.on("error", () => {});
  const closed = Promise.withResolvers();
  client.on("close", () => closed.resolve());
  client.on("finish", () => log.push("finish"));
  log.push(`end secureConnecting=${client.secureConnecting}`);
  client.end();

  const outcome = await serverOutcome.promise;
  if (outcome !== "secureConnection") await closed.promise;

  const { destroyed } = client;
  client.destroy();
  raw.destroy();
  server.close();
  report({ transportFinalCalled: transport.finalCalled, server: outcome, destroyed });
} else if (mode === "duplex-end-established") {
  // After the handshake, against a server that reads the close_notify and
  // does not answer it (allowHalfOpen). The transport must be ended anyway.
  const serverSawCloseNotify = Promise.withResolvers();
  const server = tls.createServer(
    { key: process.env.TLS_KEY, cert: process.env.TLS_CERT, allowHalfOpen: true },
    socket => {
      socket.on("error", () => {});
      socket.on("end", () => serverSawCloseNotify.resolve());
      socket.resume();
    },
  );
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  const raw = net.connect(server.address().port, "127.0.0.1");
  await once(raw, "connect");
  const transport = transportOver(raw);
  const client = tls.connect({ socket: transport.stream, rejectUnauthorized: false, allowHalfOpen: true });
  for (const event of ["secureConnect", "finish", "close"]) client.on(event, () => log.push(event));
  client.on("error", error => log.push(`error:${error.code}`));
  await once(client, "secureConnect");
  client.end();
  await serverSawCloseNotify.promise;

  const { writableFinished, readyState, destroyed } = client;
  const transportFinalCalled = transport.finalCalled;
  client.destroy();
  raw.destroy();
  server.close();
  report({ transportFinalCalled, writableFinished, readyState, destroyed });
} else if (mode === "duplex-server-end") {
  // A server-side TLSSocket over a stream that ends in the turn that created it.
  // "same-turn": the client sends nothing.
  // "buffered-client-hello": the ClientHello already sits in the stream's
  // readable buffer, so the server's flight is due before the end().
  const when = process.argv[3];
  const clientSawFin = Promise.withResolvers();
  const serverFinished = Promise.withResolvers();
  let serverSocket;
  let transport;
  const server = net.createServer(async raw => {
    transport = transportOver(raw);
    if (when === "buffered-client-hello") await transport.received;
    const socket = (serverSocket = new TLSSocket(transport.stream, {
      isServer: true,
      key: process.env.TLS_KEY,
      cert: process.env.TLS_CERT,
    }));
    socket.on("error", () => {});
    socket.on("finish", () => {
      log.push("finish");
      serverFinished.resolve();
    });
    log.push(`end secureConnecting=${socket.secureConnecting}`);
    socket.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  const received = [];
  const raw = net.connect({ port: server.address().port, host: "127.0.0.1", allowHalfOpen: true });
  raw.on("data", chunk => received.push(chunk));
  raw.on("error", () => {});
  raw.on("end", () => clientSawFin.resolve());
  let client;
  if (when === "buffered-client-hello") {
    await once(raw, "connect");
    client = tls.connect({ socket: transportOver(raw).stream, rejectUnauthorized: false });
    client.on("error", () => {});
  }

  await Promise.all([clientSawFin.promise, serverFinished.promise]);

  client?.destroy();
  raw.destroy();
  serverSocket?.destroy();
  server.close();
  report({
    transportFinalCalled: transport.finalCalled,
    transportWroteHandshakeRecord: transport.wroteHandshakeRecord,
    clientSawFin: true,
    clientSawHandshakeRecord: Buffer.concat(received)[0] === 0x16,
  });
} else {
  throw new Error(`unknown mode ${mode}`);
}
