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
} else if (mode === "pending-transport") {
  // tls.connect({ socket }) over a net.Socket that is not connected yet, shut
  // down in the same tick: the FIN has to wait for the transport. One report
  // per method and transport, each on a socket and a peer of its own.
  async function shutDown(method, transport) {
    const log = [];
    const peer = await stalledPeer();
    const raw = transport === "connecting" ? net.connect(peer.port, "127.0.0.1") : new net.Socket();
    raw.on("connect", () => log.push("transport connect"));

    const client = tls.connect({ socket: raw, rejectUnauthorized: false });
    for (const event of ["secureConnect", "finish", "error", "close"]) {
      client.on(event, arg => log.push(arg?.code ? `${event}:${arg.code}` : event));
    }
    client[method]();
    if (transport === "unconnected") raw.connect(peer.port, "127.0.0.1");

    await Promise.all([once(client, method === "end" ? "finish" : "close"), peer.sawFin]);

    const { writableFinished, readyState, destroyed } = client;
    const result = { log: [...log], peerSawFin: true, writableFinished, readyState, destroyed };
    client.destroy();
    raw.destroy();
    peer.close();
    return result;
  }

  const reports = {};
  await Promise.all(
    ["end", "destroySoon"].flatMap(method =>
      ["connecting", "unconnected"].map(async transport => {
        reports[`${method} ${transport}`] = await shutDown(method, transport);
      }),
    ),
  );
  console.log(JSON.stringify(reports));
  process.exit(0);
} else if (mode === "closed-transport") {
  // The same shapes over a net.Socket that closes before it connects. There is
  // nothing to shut down: the TLS socket closes with its transport. Node also
  // reports a refused connect as the TLS socket's 'error'. That report is not
  // part of these shapes, so the log does not subscribe to it.
  async function shutDown(method, transport) {
    const log = [];
    const peer = await stalledPeer();
    // The local port of a live connection refuses connections: nothing listens
    // on it, and no listen(0) can be handed it while the connection is open.
    const holder = net.connect(peer.port, "127.0.0.1");
    await once(holder, "connect");

    const raw = net.connect(transport === "refused" ? holder.localPort : peer.port, "127.0.0.1");
    raw.on("error", () => {});
    const client = tls.connect({ socket: raw, rejectUnauthorized: false });
    client.on("error", () => {});
    for (const event of ["finish", "close"]) client.on(event, () => log.push(event));
    client[method]();
    if (transport === "destroyed") raw.destroy();

    // events.once() rejects on the 'error' that node emits first.
    await new Promise(resolve => client.once("close", resolve));

    const { writableFinished, readyState, destroyed } = client;
    holder.destroy();
    raw.destroy();
    peer.close();
    return { log, writableFinished, readyState, destroyed };
  }

  const reports = {};
  await Promise.all(
    ["end", "destroySoon"].flatMap(method =>
      ["refused", "destroyed"].map(async transport => {
        reports[`${method} ${transport}`] = await shutDown(method, transport);
      }),
    ),
  );
  console.log(JSON.stringify(reports));
  process.exit(0);
} else if (mode === "server-same-tick") {
  // new TLSSocket(socket, { isServer: true }) shut down in the tick that wraps
  // it. One report per method, each on a server and a connection of its own.
  async function shutDown(method) {
    const log = [];
    const clientSawFin = Promise.withResolvers();
    const wrapped = Promise.withResolvers();
    const server = net.createServer(raw => {
      const socket = new TLSSocket(raw, {
        isServer: true,
        key: process.env.TLS_KEY,
        cert: process.env.TLS_CERT,
      });
      socket.on("error", () => {});
      raw.on("error", () => {});
      for (const event of ["finish", "close"]) socket.on(event, () => log.push(event));
      wrapped.resolve({ socket, done: once(socket, method === "end" ? "finish" : "close") });
      socket[method]();
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

    const client = net.connect({ port: server.address().port, host: "127.0.0.1", allowHalfOpen: true });
    client.on("data", () => {});
    client.on("error", () => {});
    client.on("end", () => clientSawFin.resolve());

    const { socket, done } = await wrapped.promise;
    await Promise.all([done, clientSawFin.promise]);

    const { writableFinished, destroyed } = socket;
    const result = { log: [...log], clientSawFin: true, writableFinished, destroyed };
    client.destroy();
    socket.destroy();
    server.close();
    return result;
  }

  const [end, destroySoon] = await Promise.all(["end", "destroySoon"].map(shutDown));
  console.log(JSON.stringify({ end, destroySoon }));
  process.exit(0);
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
