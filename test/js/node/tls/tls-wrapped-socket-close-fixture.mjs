// The close of a connection under a TLS socket and the net.Socket it wraps, as
// one ordered log of the events of both sockets per cell. Runs on bun and on
// node, so node-tls-upgrade.test.ts can assert the same log for both.
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";

const [cell, ...args] = process.argv.slice(2);
const key = process.env.TLS_KEY;
const cert = process.env.TLS_CERT;
const events = [];
const closed = [];

function observe(name, socket) {
  const { promise, resolve } = Promise.withResolvers();
  closed.push(promise);
  socket.on("end", () => events.push(`${name} end`));
  socket.on("finish", () => events.push(`${name} finish`));
  socket.on("error", err => events.push(`${name} error ${err.code}`));
  socket.on("close", hadError => {
    events.push(`${name} close hadError=${hadError}`);
    resolve();
  });
}

async function listen(server) {
  await once(server.listen(0, "127.0.0.1"), "listening");
  return server.address().port;
}

// `new tls.TLSSocket(socket, { isServer: true })` over an accepted socket. Both are observed.
async function serverSideWrap(connectPeer, onWrap) {
  const wrapped = Promise.withResolvers();
  const server = net.createServer(raw => {
    const tlsSocket = new tls.TLSSocket(raw, { isServer: true, key, cert });
    observe("raw", raw);
    observe("tls", tlsSocket);
    onWrap(tlsSocket);
    wrapped.resolve();
  });
  const peer = connectPeer(await listen(server));
  // A TLS peer whose handshake is cut short reports ECONNRESET.
  peer.on("error", () => {});
  await wrapped.promise;
  await Promise.all(closed);
  peer.destroy();
  server.close();
}

// `tls.connect({ socket })` over a connected socket. Both are observed.
async function clientSideWrap(server, onWrap) {
  const raw = net.connect(await listen(server), "127.0.0.1");
  await once(raw, "connect");
  const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
  observe("raw", raw);
  observe("tls", tlsSocket);
  onWrap(tlsSocket);
  await Promise.all(closed);
  server.close();
}

// The TLS socket has sent its FIN, so the peer's FIN closes the connection under
// both sockets at once, with no TLS-level EOF ahead of it.
if (cell === "end-before-handshake") {
  const [peerKind, when] = args;
  await serverSideWrap(
    port => {
      const peer =
        peerKind === "tls"
          ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
          : net.connect(port, "127.0.0.1");
      return peer.resume();
    },
    tlsSocket =>
      when === "setImmediate" ? setImmediate(() => tlsSocket.end()) : process.nextTick(() => tlsSocket.end()),
  );
} else if (cell === "end-after-handshake") {
  await serverSideWrap(
    port => {
      const peer = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, allowHalfOpen: true });
      // No close_notify: the connection just closes.
      peer.on("end", () => peer.destroy());
      return peer.resume();
    },
    tlsSocket => tlsSocket.on("secure", () => tlsSocket.end()),
  );
} else if (cell === "client-end-after-handshake") {
  await clientSideWrap(
    tls.createServer({ key, cert, allowHalfOpen: true }, peer => {
      peer.on("error", () => {});
      // No close_notify: the connection just closes.
      peer.on("end", () => peer.destroy());
      peer.resume();
    }),
    tlsSocket => tlsSocket.on("secureConnect", () => tlsSocket.end()),
  );
} else if (cell === "unread-data") {
  // The peer answers 'end' with its last bytes, then closes. Nothing reads the TLS
  // socket until the connection has closed under it.
  await serverSideWrap(
    port => {
      const peer = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, allowHalfOpen: true });
      peer.on("end", () => peer.write("late", () => peer.destroy()));
      return peer.resume();
    },
    tlsSocket => {
      tlsSocket.on("secure", () => tlsSocket.end());
      (function readOnceTheConnectionClosed() {
        if (!tlsSocket._readableState.ended && !tlsSocket.destroyed) return setImmediate(readOnceTheConnectionClosed);
        events.push(`connection closed, unread=${tlsSocket.readableLength}`);
        tlsSocket.on("data", data => events.push(`tls data ${data}`));
      })();
    },
  );
}
// The peer resets the connection. The read error is the TLS socket's to report.
else if (cell === "reset-before-handshake") {
  let peer;
  await serverSideWrap(
    port => (peer = net.connect(port, "127.0.0.1")),
    // bun's wrap adopts the connection's handle on the tick after it is made.
    () => setImmediate(() => peer.resetAndDestroy()),
  );
} else if (cell === "reset-after-handshake") {
  let peerRaw;
  await serverSideWrap(
    port => {
      peerRaw = net.connect(port, "127.0.0.1");
      const peer = tls.connect({ socket: peerRaw, rejectUnauthorized: false }, () => peer.write("hi"));
      peer.on("error", () => {});
      return peerRaw;
    },
    tlsSocket => tlsSocket.on("data", () => setImmediate(() => peerRaw.resetAndDestroy())),
  );
} else if (cell === "client-reset-after-handshake") {
  await clientSideWrap(
    net.createServer(peerRaw => {
      const peer = new tls.TLSSocket(peerRaw, { isServer: true, key, cert });
      peer.on("error", () => {});
      peerRaw.on("error", () => {});
      peer.on("data", () => setImmediate(() => peerRaw.resetAndDestroy()));
    }),
    tlsSocket => tlsSocket.on("secureConnect", () => tlsSocket.write("hi")),
  );
} else if (cell === "tls-server-reset-before-handshake") {
  // The TLS socket that a tls.Server makes over an injected socket is only reachable from 'tlsClientError'.
  const tlsServer = tls.createServer({ key, cert });
  tlsServer.on("tlsClientError", (err, tlsSocket) => {
    events.push(`tlsClientError ${err.code}`);
    observe("tls", tlsSocket);
  });
  const injected = Promise.withResolvers();
  const server = net.createServer(raw => {
    observe("raw", raw);
    tlsServer.emit("connection", raw);
    setImmediate(injected.resolve);
  });
  const peer = net.connect(await listen(server), "127.0.0.1");
  peer.on("error", () => {});
  await injected.promise;
  peer.resetAndDestroy();
  // 'tlsClientError' comes ahead of the 'close' of the wrapped socket. Without it there is no TLS socket to wait for.
  await closed[0];
  await Promise.all(closed);
  server.close();
} else {
  throw new Error(`unknown cell ${cell}`);
}

console.log(JSON.stringify(events));
process.exit(0);
