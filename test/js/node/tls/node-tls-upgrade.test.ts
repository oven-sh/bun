import { expect, test } from "bun:test";
import { once } from "events";
import { tls as certs } from "harness";
import net from "net";
import tls from "tls";

test("should be able to upgrade a paused socket and also have backpressure on it #15438", async () => {
  // enought to trigger backpressure
  const payload = Buffer.alloc(16 * 1024 * 4, "b").toString("utf8");

  const server = tls.createServer(certs, socket => {
    // echo
    socket.on("data", data => {
      socket.write(data);
    });
  });

  await once(server.listen(0, "127.0.0.1"), "listening");

  const socket = net.connect({
    port: (server.address() as net.AddressInfo).port,
    host: "127.0.0.1",
  });
  await once(socket, "connect");

  // pause raw socket
  socket.pause();

  const tlsSocket = tls.connect({
    ca: certs.cert,
    servername: "localhost",
    socket,
  });
  await once(tlsSocket, "secureConnect");

  // do http request using tls socket
  async function doWrite(socket: net.Socket) {
    let downloadedBody = 0;
    const { promise, resolve, reject } = Promise.withResolvers();
    function onData(data: Buffer) {
      downloadedBody += data.byteLength;
      if (downloadedBody === payload.length * 2) {
        resolve();
      }
    }
    socket.pause();
    socket.write(payload);
    socket.write(payload, () => {
      socket.on("data", onData);
      socket.resume();
    });

    await promise;
    socket.off("data", onData);
  }
  for (let i = 0; i < 100; i++) {
    // upgrade the tlsSocket
    await doWrite(tlsSocket);
  }

  expect().pass();
});

// Once a TLS layer is put on top of a net.Socket (tls.connect({ socket }),
// new TLSSocket(socket, { isServer: true })) the bytes that socket keeps
// receiving belong to the TLS layer: none of them may surface as `data` on the
// wrapped socket or pile up in its readable buffer. Both upgrade paths are
// covered: fd adoption, and the stream-level engine that is used while the
// socket still has unflushed writes (and for Windows named pipes, see
// node-tls-namedpipes.test.ts).
// https://github.com/oven-sh/bun/issues/32239
// https://github.com/oven-sh/bun/issues/32242

const serverTLS = { key: certs.key, cert: certs.cert };
const clientTLS = { ca: certs.cert, servername: "localhost" };

async function listenTCP(onConnection: (socket: net.Socket) => void) {
  const server = net.createServer(onConnection);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: (server.address() as net.AddressInfo).port,
    [Symbol.dispose]: () => server.close(),
  };
}

// Bytes that reach the wrapped socket itself from now on, whether emitted as
// `data` or left sitting in its readable buffer.
function watchSurfacing(socket: net.Socket) {
  let emitted = 0;
  socket.on("data", chunk => (emitted += chunk.length));
  return () => ({ emitted, buffered: socket.readableLength });
}

// Client-side upgrade over `socket` plus a "ping" round trip through an echoing
// TLS peer. Resolves to the echoed text; every failure rejects.
function pingOverTLS(socket: net.Socket, reject: (err: Error) => void) {
  const { promise, resolve } = Promise.withResolvers<string>();
  const tlsSocket = tls.connect({ socket, ...clientTLS });
  tlsSocket.on("error", reject);
  tlsSocket.on("close", () => reject(new Error("TLS socket closed before the echo arrived")));
  tlsSocket.on("secureConnect", () => tlsSocket.write("ping"));
  tlsSocket.on("data", chunk => resolve(chunk.toString()));
  return promise;
}

function wrapAndEcho(accepted: net.Socket, reject: (err: Error) => void) {
  const secure = new tls.TLSSocket(accepted, { isServer: true, ...serverTLS });
  secure.on("error", reject);
  secure.on("data", chunk => secure.write(chunk));
}

test.concurrent(
  "tls.connect({ socket }) does not re-emit post-upgrade bytes on the original socket (STARTTLS) #32239",
  async () => {
    // The issue's shape: the plaintext handler upgrades on the first chunk after
    // the greeting. Pre-fix the TLS bytes that followed re-entered it as `data`,
    // so it upgraded a second time and that attempt threw "Invalid socket".
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const { promise: outcome, resolve } = Promise.withResolvers<{ upgrades: number; invalidSocket: boolean }>();
    using server = await listenTCP(serverSocket => {
      serverSocket.on("error", () => {});
      serverSocket.write("SERVER_GREETING");
      serverSocket.on("data", () => serverSocket.write(Buffer.alloc(50, 0x16)));
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.on("error", reject);
      let upgrades = 0;
      socket.on("data", chunk => {
        if (upgrades === 0 && chunk.toString("latin1") === "SERVER_GREETING") {
          socket.write("STARTTLS");
          return;
        }
        upgrades++;
        const tlsSocket = tls.connect({ socket, rejectUnauthorized: false });
        tlsSocket.on("error", err => resolve({ upgrades, invalidSocket: err.message.includes("Invalid socket") }));
        tlsSocket.on("secureConnect", () => reject(new Error("handshake against the mock bytes succeeded")));
      });
      expect(await Promise.race([outcome, failure])).toEqual({ upgrades: 1, invalidSocket: false });
    } finally {
      socket.destroy();
    }
  },
);

test.concurrent.each([
  [
    "fd adoption",
    // STARTTLS has been flushed by the time tls.connect runs, so the fd is adopted.
    (socket: net.Socket, upgrade: () => Promise<string>) =>
      new Promise<string>(resolve => socket.write("STARTTLS", () => resolve(upgrade()))),
  ],
  [
    "stream-level engine",
    // STARTTLS is still corked when tls.connect runs (an unflushed write), which
    // selects the stream-level engine; its ClientHello queues up behind it.
    (socket: net.Socket, upgrade: () => Promise<string>) => {
      socket.cork();
      socket.write("STARTTLS");
      const echoed = upgrade();
      socket.uncork();
      return echoed;
    },
  ],
])("tls.connect({ socket }) takes the client socket over: %s", async (_, sendSTARTTLSAndUpgrade) => {
  const { promise: failure, reject } = Promise.withResolvers<never>();
  using server = await listenTCP(accepted => {
    accepted.on("error", reject);
    accepted.once("data", chunk => {
      if (chunk.toString("latin1", 0, 8) !== "STARTTLS") {
        reject(new Error(`unexpected plaintext ${JSON.stringify(chunk.toString("latin1"))}`));
        return;
      }
      // The ClientHello may already be in this chunk or arrive before the wrap
      // lands; keep it buffered for the wrap to hand over.
      accepted.pause();
      if (chunk.length > 8) accepted.unshift(chunk.subarray(8));
      wrapAndEcho(accepted, reject);
    });
  });

  const socket = net.connect(server.port, "127.0.0.1");
  try {
    socket.on("error", reject);
    await Promise.race([once(socket, "connect"), failure]);
    // The plaintext-phase listener stays attached, as in the issue. This server
    // never writes plaintext, so whatever it sees is TLS traffic leaking through.
    const surfaced = watchSurfacing(socket);
    const echoed = await Promise.race([sendSTARTTLSAndUpgrade(socket, () => pingOverTLS(socket, reject)), failure]);
    expect({ echoed, ...surfaced() }).toEqual({ echoed: "ping", emitted: 0, buffered: 0 });
  } finally {
    socket.destroy();
  }
});

test.concurrent.each([
  [
    "fd adoption",
    // PROCEED has been flushed when the wrap runs, so the fd is adopted. The
    // handle is paused first so that a ClientHello racing in stays in the
    // kernel until the wrap takes the fd over.
    (accepted: net.Socket, wrap: () => void) => {
      accepted.pause();
      accepted.write("PROCEED", () => wrap());
    },
  ],
  [
    "stream-level engine",
    // PROCEED is still corked when the wrap runs (an unflushed write), which
    // selects the stream-level engine right away.
    (accepted: net.Socket, wrap: () => void) => {
      accepted.cork();
      accepted.write("PROCEED");
      wrap();
      accepted.uncork();
    },
  ],
  [
    "stream-level engine selected a tick after the wrap",
    // Nothing is pending when the wrap runs; the write queued right behind it
    // is what the wrap's deferred step finds. Uncorked once that step has run.
    (accepted: net.Socket, wrap: () => void) => {
      wrap();
      accepted.cork();
      accepted.write("PROCEED");
      setImmediate(() => accepted.uncork());
    },
  ],
])("new TLSSocket(accepted, { isServer: true }) takes the accepted socket over: %s", async (_, proceedAndWrap) => {
  const { promise: failure, reject } = Promise.withResolvers<never>();
  const { promise: surfacing, resolve: wrapped } = Promise.withResolvers<ReturnType<typeof watchSurfacing>>();
  using server = await listenTCP(accepted => {
    accepted.on("error", reject);
    accepted.once("data", command => {
      if (command.toString("latin1") !== "STARTTLS") {
        reject(new Error(`unexpected plaintext ${JSON.stringify(command.toString("latin1"))}`));
        return;
      }
      proceedAndWrap(accepted, () => wrapAndEcho(accepted, reject));
      wrapped(watchSurfacing(accepted));
    });
  });

  const socket = net.connect(server.port, "127.0.0.1");
  try {
    socket.on("error", reject);
    await Promise.race([once(socket, "connect"), failure]);
    socket.write("STARTTLS");
    const [proceed] = await Promise.race([once(socket, "data"), failure]);
    expect(proceed.toString("latin1")).toBe("PROCEED");
    const echoed = await Promise.race([pingOverTLS(socket, reject), failure]);
    const surfaced = await surfacing;
    expect({ echoed, ...surfaced() }).toEqual({ echoed: "ping", emitted: 0, buffered: 0 });
  } finally {
    socket.destroy();
  }
});

test.concurrent(
  "new TLSSocket(accepted, { isServer: true }) does not put an already buffered ClientHello back",
  async () => {
    // Paused-mode STARTTLS: the ClientHello that PROCEED triggers is sitting in
    // the accepted socket's readable buffer when the wrap runs, so the wrap has
    // to take it from there. Pre-fix it was handed to TLS and pushed back.
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const { promise: buffered, resolve } = Promise.withResolvers<number>();
    using server = await listenTCP(accepted => {
      accepted.on("error", reject);
      accepted.once("data", command => {
        if (command.toString("latin1") !== "STARTTLS") {
          reject(new Error(`unexpected plaintext ${JSON.stringify(command.toString("latin1"))}`));
          return;
        }
        accepted.pause();
        accepted.write("PROCEED");
        accepted.once("readable", () => {
          const secure = new tls.TLSSocket(accepted, { isServer: true, ...serverTLS });
          secure.on("error", reject);
          secure.on("secure", () => resolve(accepted.readableLength));
        });
      });
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.on("error", reject);
      await Promise.race([once(socket, "connect"), failure]);
      socket.write("STARTTLS");
      const [proceed] = await Promise.race([once(socket, "data"), failure]);
      expect(proceed.toString("latin1")).toBe("PROCEED");
      tls.connect({ socket, ...clientTLS }).on("error", reject);
      expect(await Promise.race([buffered, failure])).toBe(0);
    } finally {
      socket.destroy();
    }
  },
);

test.concurrent(
  "TLS over TLS takes the outer TLSSocket over on both ends, including bytes it had already buffered",
  async () => {
    // A TLSSocket used as the transport always goes through the stream-level
    // engine. The server wraps in paused mode, so the inner ClientHello is
    // already sitting in the outer socket's readable buffer when the wrap runs
    // and has to be handed over from there (node's initRead does the same).
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const { promise: serverSide, resolve: innerSecured } = Promise.withResolvers<ReturnType<typeof watchSurfacing>>();
    const outerServer = tls.createServer(serverTLS, outer => {
      outer.on("error", reject);
      outer.once("data", command => {
        if (command.toString("latin1") !== "STARTTLS") {
          reject(new Error(`unexpected command ${JSON.stringify(command.toString("latin1"))}`));
          return;
        }
        outer.pause();
        outer.write("PROCEED");
        outer.once("readable", () => {
          const inner = new tls.TLSSocket(outer, { isServer: true, ...serverTLS });
          inner.on("error", reject);
          inner.on("data", chunk => inner.write(chunk));
          const surfaced = watchSurfacing(outer);
          inner.on("secure", () => innerSecured(surfaced));
        });
      });
    });
    outerServer.listen(0, "127.0.0.1");
    await once(outerServer, "listening");

    const outer = tls.connect({
      port: (outerServer.address() as net.AddressInfo).port,
      host: "127.0.0.1",
      ...clientTLS,
    });
    try {
      outer.on("error", reject);
      await Promise.race([once(outer, "secureConnect"), failure]);
      outer.write("STARTTLS");
      const [proceed] = await Promise.race([once(outer, "data"), failure]);
      expect(proceed.toString("latin1")).toBe("PROCEED");
      const clientSurfaced = watchSurfacing(outer);
      const echoed = await Promise.race([pingOverTLS(outer, reject), failure]);
      const serverSurfaced = await Promise.race([serverSide, failure]);
      expect({ echoed, client: clientSurfaced(), server: serverSurfaced() }).toEqual({
        echoed: "ping",
        client: { emitted: 0, buffered: 0 },
        server: { emitted: 0, buffered: 0 },
      });
    } finally {
      outer.destroy();
      outerServer.close();
    }
  },
);

test.concurrent(
  "tls.connect({ socket }) does not retain the TLS traffic in the original socket's readable buffer",
  async () => {
    // Nothing listens on the wrapped socket and it is not flowing (postgres.js
    // drops its plaintext listeners before upgrading): pre-fix every byte the
    // connection received was also pushed into that buffer and kept there for
    // the life of the connection.
    const TOTAL = 512 * 1024;
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const server = tls.createServer(serverTLS, secure => {
      secure.on("error", reject);
      for (let sent = 0; sent < TOTAL; sent += chunk.length) secure.write(chunk);
      secure.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    try {
      socket.on("error", reject);
      const tlsSocket = tls.connect({ socket, ...clientTLS });
      tlsSocket.on("error", reject);
      let received = 0;
      tlsSocket.on("data", data => (received += data.length));
      await Promise.race([once(tlsSocket, "end"), failure]);
      expect({ received, buffered: socket.readableLength }).toEqual({ received: TOTAL, buffered: 0 });
    } finally {
      socket.destroy();
      server.close();
    }
  },
);

test.concurrent("a socket whose TLS session is over can reconnect as a plain socket", async () => {
  // The second connection must see exactly its own data: nothing retained from
  // the TLS session that used the socket before, and nothing still diverted to
  // that TLS layer.
  const { promise: failure, reject } = Promise.withResolvers<never>();
  const secureServer = tls.createServer(serverTLS, secure => {
    secure.on("error", () => {});
    secure.end();
  });
  secureServer.listen(0, "127.0.0.1");
  await once(secureServer, "listening");
  using plainServer = await listenTCP(accepted => {
    accepted.on("error", reject);
    accepted.on("data", data => accepted.end(data));
  });

  const socket = net.connect((secureServer.address() as net.AddressInfo).port, "127.0.0.1");
  try {
    socket.on("error", reject);
    tls.connect({ socket, ...clientTLS }).on("error", reject);
    // The peer ending the TLS session tears the wrapped socket down with it.
    await Promise.race([once(socket, "close"), failure]);

    socket.connect(plainServer.port, "127.0.0.1");
    await Promise.race([once(socket, "connect"), failure]);
    let received = "";
    socket.on("data", data => (received += data));
    socket.write("plain again");
    await Promise.race([once(socket, "end"), failure]);
    expect(received).toBe("plain again");
  } finally {
    socket.destroy();
    secureServer.close();
  }
});
