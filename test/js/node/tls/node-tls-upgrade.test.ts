import { expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, tls as certs } from "harness";
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
// wrapped socket or pile up in its readable buffer. Covered: adopting the fd
// right away, adopting it once plaintext still queued on the socket has been
// flushed (like node, no TLS record may overtake it), and TLS over TLS, where
// the TLS engine runs over the outer stream (Windows named pipes, the other
// stream-level case, are in node-tls-namedpipes.test.ts).
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

// Server for clients that send "STARTTLS" and start the handshake right away:
// it wraps the accepted socket as soon as the command arrives and never writes
// anything in plaintext, so whatever the client's plaintext side sees after
// that is TLS traffic leaking through.
function listenOptimisticSTARTTLS(reject: (err: Error) => void) {
  return listenTCP(accepted => {
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
    "fd adoption behind a pending write",
    // STARTTLS is still corked when tls.connect runs: the handshake is held
    // until it has been flushed, so the ClientHello goes out behind it.
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
  using server = await listenOptimisticSTARTTLS(reject);

  const socket = net.connect(server.port, "127.0.0.1");
  try {
    socket.on("error", reject);
    await Promise.race([once(socket, "connect"), failure]);
    // The plaintext-phase listener stays attached, as in the issue.
    const surfaced = watchSurfacing(socket);
    const echoed = await Promise.race([sendSTARTTLSAndUpgrade(socket, () => pingOverTLS(socket, reject)), failure]);
    expect({ echoed, ...surfaced() }).toEqual({ echoed: "ping", emitted: 0, buffered: 0 });
  } finally {
    socket.destroy();
  }
});

test.concurrent("tls.connect({ socket }) behind a write under backpressure: the plaintext goes out first", async () => {
  // Not corked but genuinely stuck behind the kernel: the ClientHello must
  // still not overtake a single plaintext byte (node queues the TLS output
  // behind the previous owner's writes). The plaintext is all 0x61 and a TLS
  // record starts with 0x16, so the server takes plaintext up to the first
  // 0x16 and wraps there; a byte out of order shortens that count or breaks
  // the handshake.
  const { promise: failure, reject } = Promise.withResolvers<never>();
  const { promise: plaintextSeen, resolve: sawPlaintext } = Promise.withResolvers<number>();
  const CHUNK = 1024 * 1024;
  using server = await listenTCP(accepted => {
    accepted.on("error", reject);
    let seen = 0;
    accepted.on("readable", function onReadable() {
      let chunk: Buffer | null;
      while ((chunk = accepted.read()) !== null) {
        const end = chunk.indexOf(0x16);
        if (end === -1) {
          seen += chunk.length;
          continue;
        }
        seen += end;
        accepted.off("readable", onReadable);
        accepted.unshift(chunk.subarray(end));
        sawPlaintext(seen);
        wrapAndEcho(accepted, reject);
        return;
      }
    });
  });

  const socket = net.connect(server.port, "127.0.0.1");
  try {
    socket.on("error", reject);
    await Promise.race([once(socket, "connect"), failure]);
    // 1 MiB chunks until one does not go out synchronously (bounded).
    let chunks = 0;
    let backpressure = false;
    do {
      backpressure = !socket.write(Buffer.alloc(CHUNK, 0x61));
      chunks++;
    } while (!backpressure && chunks < 256);
    expect(backpressure).toBe(true);
    const echoed = await Promise.race([pingOverTLS(socket, reject), failure]);
    expect({ echoed, plaintext: await plaintextSeen }).toEqual({ echoed: "ping", plaintext: chunks * CHUNK });
  } finally {
    socket.destroy();
  }
});

test.concurrent(
  "new TLSSocket(accepted, { isServer: true }) behind a pending write keeps bytes that arrive meanwhile for the TLS layer",
  async () => {
    // The server wraps while PROCEED is still corked, in flowing mode with its
    // command listener attached; the client then sends a TLS record and, once
    // that write has completed, has the server uncork. So the record reaches
    // the server while its reads are held: it must wait in the kernel for the
    // TLS layer (which rejects it: it is garbage) rather than be emitted to the
    // command listener or dropped.
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const { promise: wrappedOnServer, resolve: wrapped } = Promise.withResolvers<() => void>();
    const { promise: outcome, resolve } = Promise.withResolvers<{
      tlsLayerSawIt: boolean;
      emitted: number;
      buffered: number;
    }>();
    using server = await listenTCP(accepted => {
      accepted.on("error", reject);
      accepted.on("data", function onCommand(command) {
        if (command.toString("latin1") !== "STARTTLS") {
          reject(new Error(`unexpected plaintext ${JSON.stringify(command.toString("latin1"))}`));
          return;
        }
        accepted.off("data", onCommand);
        accepted.cork();
        accepted.write("PROCEED");
        const secure = new tls.TLSSocket(accepted, { isServer: true, ...serverTLS });
        const surfaced = watchSurfacing(accepted);
        secure.on("error", () => resolve({ tlsLayerSawIt: true, ...surfaced() }));
        wrapped(() => accepted.uncork());
      });
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.on("error", reject);
      await Promise.race([once(socket, "connect"), failure]);
      socket.write("STARTTLS");
      const uncorkServer = await Promise.race([wrappedOnServer, failure]);
      // A TLS-record-shaped blob no server accepts. Loopback: once the write
      // has completed the bytes are in the server's receive queue.
      await new Promise<void>(done =>
        socket.write(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x04, 0xde, 0xad, 0xbe, 0xef]), () => done()),
      );
      uncorkServer();
      expect(await Promise.race([outcome, failure])).toEqual({ tlsLayerSawIt: true, emitted: 0, buffered: 0 });
    } finally {
      socket.destroy();
    }
  },
);

test.concurrent(
  "new TLSSocket(accepted, { isServer: true }) hands over a ClientHello buffered in several chunks",
  async () => {
    // Protocol sniffing: peek at the first byte with read(1) and unshift it back,
    // which leaves the ClientHello in the readable buffer as two chunks. Both
    // belong to the TLS layer (node's initRead drains the whole buffer).
    const { promise: failure, reject } = Promise.withResolvers<never>();
    using server = await listenTCP(accepted => {
      accepted.on("error", reject);
      accepted.once("readable", () => {
        const first = accepted.read(1);
        accepted.unshift(first);
        if (first[0] !== 0x16) {
          reject(new Error(`not a TLS record: ${first[0]}`));
          return;
        }
        wrapAndEcho(accepted, reject);
      });
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.on("error", reject);
      await Promise.race([once(socket, "connect"), failure]);
      expect(await Promise.race([pingOverTLS(socket, reject), failure])).toBe("ping");
    } finally {
      socket.destroy();
    }
  },
);

test.concurrent(
  "destroying the TLS socket while the wrapped socket is still flushing closes both, TLS unsent",
  async () => {
    // While plaintext is still queued the handshake is held; a destroy() in that
    // window must tear both sockets down (node destroys the wrapped socket with
    // the TLS one) and must not put a ClientHello — or anything else of TLS —
    // on the wire behind whatever plaintext made it out.
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const { promise: peerSaw, resolve } = Promise.withResolvers<Buffer>();
    using server = await listenTCP(accepted => {
      accepted.on("error", () => {});
      const chunks: Buffer[] = [];
      accepted.on("data", chunk => chunks.push(chunk));
      accepted.on("close", () => resolve(Buffer.concat(chunks)));
    });
    const socket = net.connect(server.port, "127.0.0.1");
    socket.on("error", reject);
    await Promise.race([once(socket, "connect"), failure]);
    socket.cork();
    socket.write("plaintext");
    const tlsSocket = tls.connect({ socket, ...clientTLS });
    tlsSocket.on("error", () => {});
    tlsSocket.destroy();
    socket.uncork();
    await Promise.race([once(socket, "close"), failure]);
    const seen = await Promise.race([peerSaw, failure]);
    // Whatever arrived is a prefix of the plaintext (0x16 would start a record).
    expect({ destroyed: socket.destroyed, onlyPlaintext: "plaintext".startsWith(seen.toString("latin1")) }).toEqual({
      destroyed: true,
      onlyPlaintext: true,
    });
  },
);

test.concurrent("tls.connect({ socket }) over a not-yet-connected net.Socket upgrades once it connects", async () => {
  const { promise: failure, reject } = Promise.withResolvers<never>();
  using server = await listenTCP(accepted => wrapAndEcho(accepted, reject));
  const socket = new net.Socket();
  try {
    const tlsSocket = tls.connect({ socket, ...clientTLS });
    tlsSocket.on("error", reject);
    socket.on("error", reject);
    socket.connect(server.port, "127.0.0.1");
    await Promise.race([once(tlsSocket, "secureConnect"), failure]);
    tlsSocket.write("hello");
    const [reply] = await Promise.race([once(tlsSocket, "data"), failure]);
    expect(reply.toString()).toBe("hello");
  } finally {
    socket.destroy();
  }
});

test.concurrent("reconnecting a socket whose fd a TLS layer took over fails with EISCONN", async () => {
  // The wrapped socket keeps its handle, but the fd is the TLS layer's now:
  // connect() on it fails (EISCONN, what connect(2) says about that fd) rather
  // than pulling the fd out from under the TLS layer.
  const { promise: failure, reject } = Promise.withResolvers<never>();
  using server = await listenTCP(accepted => wrapAndEcho(accepted, reject));
  const socket = net.connect(server.port, "127.0.0.1");
  try {
    socket.on("error", () => {});
    await Promise.race([once(socket, "connect"), failure]);
    const tlsSocket = tls.connect({ socket, ...clientTLS });
    tlsSocket.on("error", reject);
    await Promise.race([once(tlsSocket, "secureConnect"), failure]);
    // The wrapped socket's error takes the TLS socket down with it (node too).
    tlsSocket.off("error", reject).on("error", () => {});
    const [err] = await Promise.race([once(socket.connect(server.port, "127.0.0.1"), "error"), failure]);
    expect((err as NodeJS.ErrnoException).code).toBe("EISCONN");
  } finally {
    socket.destroy();
  }
});

test.concurrent("end() right after new TLSSocket(accepted, { isServer: true }) still reaches the peer", async () => {
  // The server-side wrap adopts the fd a tick later; an end() before that must
  // wait for it (handshake, close_notify, FIN) instead of finishing as if there
  // were nothing to close.
  const { promise: failure, reject } = Promise.withResolvers<never>();
  using server = await listenTCP(accepted => {
    accepted.on("error", reject);
    const secure = new tls.TLSSocket(accepted, { isServer: true, ...serverTLS });
    secure.on("error", reject);
    secure.end();
  });
  const tlsSocket = tls.connect({ port: server.port, host: "127.0.0.1", ...clientTLS });
  try {
    tlsSocket.on("error", reject);
    tlsSocket.resume();
    await Promise.race([once(tlsSocket, "end"), failure]);
    expect(tlsSocket.destroyed || tlsSocket.readableEnded).toBe(true);
  } finally {
    tlsSocket.destroy();
  }
});

test.concurrent("end() right after tls.connect({ socket }) over a flushing socket still reaches the peer", async () => {
  // The handshake is held while the wrapped socket flushes; end() must wait
  // for it (handshake, close_notify, FIN) instead of cutting the plaintext or
  // the handshake short.
  const { promise: failure, reject } = Promise.withResolvers<never>();
  const { promise: serverSawEnd, resolve } = Promise.withResolvers<string>();
  using server = await listenTCP(accepted => {
    accepted.on("error", reject);
    accepted.once("data", plaintext => {
      accepted.pause();
      if (plaintext.length > 9) accepted.unshift(plaintext.subarray(9));
      const secure = new tls.TLSSocket(accepted, { isServer: true, ...serverTLS });
      secure.on("error", reject);
      secure.resume();
      secure.on("end", () => resolve(plaintext.toString("latin1", 0, 9)));
    });
  });
  const socket = net.connect(server.port, "127.0.0.1");
  try {
    socket.on("error", reject);
    await Promise.race([once(socket, "connect"), failure]);
    socket.cork();
    socket.write("plaintext");
    const tlsSocket = tls.connect({ socket, ...clientTLS });
    tlsSocket.on("error", reject);
    tlsSocket.end();
    socket.uncork();
    expect(await Promise.race([serverSawEnd, failure])).toBe("plaintext");
  } finally {
    socket.destroy();
  }
});

test.concurrent("a peer that closes while the handshake is held behind stuck plaintext is noticed", async () => {
  // The peer never reads (so the client's plaintext never flushes and the
  // handshake never starts) and then half-closes. The TLS socket must still
  // hear about it — reads stay on during the hold, as under node's TLSWrap —
  // instead of both sockets hanging forever.
  const { promise: failure, reject } = Promise.withResolvers<never>();
  const { promise: outcome, resolve } = Promise.withResolvers<string[]>();
  using server = await listenTCP(accepted => {
    accepted.on("error", () => {});
    accepted.pause();
    accepted.end();
  });
  const socket = net.connect(server.port, "127.0.0.1");
  socket.on("error", () => {});
  await Promise.race([once(socket, "connect"), failure]);
  let backpressure = false;
  for (let i = 0; i < 64 && !backpressure; i++) backpressure = !socket.write(Buffer.alloc(1024 * 1024, 0x61));
  expect(backpressure).toBe(true);
  const events: string[] = [];
  const tlsSocket = tls.connect({ socket, ...clientTLS });
  tlsSocket.on("error", err => events.push((err as NodeJS.ErrnoException).code ?? err.message));
  tlsSocket.on("close", () => {
    events.push("close");
    resolve(events);
  });
  expect(await Promise.race([outcome, failure])).toEqual(["ECONNRESET", "close"]);
});

test.concurrent(
  "a peer that sends garbage while the handshake is held behind stuck plaintext is rejected at once",
  async () => {
    // Only TLS *output* is held (node's has_active_write_issued_by_prev_listener_);
    // input still reaches the TLS layer. So a peer that never drains our
    // plaintext (the hold never ends) but sends something that is not TLS gets
    // the same immediate protocol error as without a hold, instead of being
    // buffered or ignored.
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const { promise: outcome, resolve } = Promise.withResolvers<string>();
    using server = await listenTCP(accepted => {
      accepted.on("error", () => {});
      accepted.pause();
      accepted.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    });
    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await Promise.race([once(socket, "connect"), failure]);
      socket.cork();
      socket.write("STARTTLS"); // stays queued: the handshake output is held for good
      const tlsSocket = tls.connect({ socket, ...clientTLS });
      tlsSocket.on("error", err => resolve((err as NodeJS.ErrnoException).code ?? err.message));
      tlsSocket.on("secureConnect", () => resolve("secureConnect"));
      expect(await Promise.race([outcome, failure])).toMatch(/^ERR_SSL_|WRONG_VERSION_NUMBER/);
    } finally {
      socket.destroy();
    }
  },
);

test.concurrent("tls.connect over a generic Duplex with a write still pending is not held up", async () => {
  // A plain Duplex transport orders our records behind its own pending writes
  // by itself; nothing must wait for a release that never comes.
  const { promise: failure, reject } = Promise.withResolvers<never>();
  const server = tls.createServer(serverTLS, secure => {
    secure.on("error", reject);
    secure.on("data", d => secure.write(d));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const raw = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  try {
    raw.on("error", reject);
    await Promise.race([once(raw, "connect"), failure]);
    const { Duplex } = require("node:stream");
    const duplex = new Duplex({
      read() {},
      write(chunk, _enc, cb) {
        raw.write(chunk, cb); // async completion: writableLength > 0 meanwhile
      },
      final(cb) {
        raw.end(cb);
      },
    });
    raw.on("data", chunk => duplex.push(chunk));
    raw.on("end", () => duplex.push(null));
    duplex.write(Buffer.alloc(0)); // a write in flight when the wrap happens
    const echoed = await Promise.race([pingOverTLS(duplex as unknown as net.Socket, reject), failure]);
    expect(echoed).toBe("ping");
  } finally {
    raw.destroy();
    server.close();
  }
});

test.concurrent("TLS over TLS: ending right after a large inner write still delivers all of it", async () => {
  // The inner layer's ciphertext goes into the outer socket natively; an
  // end() on the outer stream must queue its FIN behind what is still parked
  // there rather than cut it off.
  const TOTAL = 4 * 1024 * 1024;
  const { promise: failure, reject } = Promise.withResolvers<never>();
  const { promise: received, resolve } = Promise.withResolvers<number>();
  const outerServer = tls.createServer(serverTLS, outer => {
    outer.on("error", reject);
    const inner = new tls.TLSSocket(outer, { isServer: true, ...serverTLS });
    inner.on("error", reject);
    let got = 0;
    inner.on("data", chunk => (got += chunk.length));
    inner.on("end", () => resolve(got));
  });
  outerServer.listen(0, "127.0.0.1");
  await once(outerServer, "listening");
  const outer = tls.connect({ port: (outerServer.address() as net.AddressInfo).port, host: "127.0.0.1", ...clientTLS });
  try {
    outer.on("error", reject);
    await Promise.race([once(outer, "secureConnect"), failure]);
    const inner = tls.connect({ socket: outer, ...clientTLS });
    inner.on("error", reject);
    await Promise.race([once(inner, "secureConnect"), failure]);
    inner.end(Buffer.alloc(TOTAL, 0x61), () => outer.end());
    expect(await Promise.race([received, failure])).toBe(TOTAL);
  } finally {
    outer.destroy();
    outerServer.close();
  }
});

test.concurrent("TLS over TLS behind a pending outer write: the inner ClientHello goes out after it", async () => {
  // Stream-level engine with native output: the inner layer's records must
  // queue behind plaintext the outer TLS socket still has in its Writable, as
  // node's inner TLSWrap does over the outer one.
  const { promise: failure, reject } = Promise.withResolvers<never>();
  const outerServer = tls.createServer(serverTLS, outer => {
    outer.on("error", reject);
    outer.once("data", chunk => {
      // STARTTLS first; the ClientHello may ride in the same chunk behind it.
      if (chunk.toString("latin1", 0, 8) !== "STARTTLS") {
        reject(new Error(`unexpected plaintext ${JSON.stringify(chunk.toString("latin1"))}`));
        return;
      }
      outer.pause();
      if (chunk.length > 8) outer.unshift(chunk.subarray(8));
      wrapAndEcho(outer, reject);
    });
  });
  outerServer.listen(0, "127.0.0.1");
  await once(outerServer, "listening");
  const outer = tls.connect({ port: (outerServer.address() as net.AddressInfo).port, host: "127.0.0.1", ...clientTLS });
  try {
    outer.on("error", reject);
    await Promise.race([once(outer, "secureConnect"), failure]);
    outer.cork();
    outer.write("STARTTLS");
    const echoed = pingOverTLS(outer as unknown as net.Socket, reject);
    outer.uncork();
    expect(await Promise.race([echoed, failure])).toBe("ping");
  } finally {
    outer.destroy();
    outerServer.close();
  }
});

test.concurrent(
  "a socket sniffed with once('data') + unshift() still hands its ClientHello to a stream-level TLS layer",
  async () => {
    // The wrapped socket is left flowing with no 'data' listener and the
    // ClientHello unshifted back into it; the hand-over must get those bytes
    // before flow() throws them away. (TLS over TLS here, so the stream-level
    // engine is used off Windows too.)
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const outerServer = tls.createServer(serverTLS, outer => {
      outer.on("error", reject);
      outer.once("data", chunk => {
        outer.unshift(chunk);
        const inner = new tls.TLSSocket(outer, { isServer: true, ...serverTLS });
        inner.on("error", reject);
        inner.on("data", d => inner.write(d));
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
      expect(await Promise.race([pingOverTLS(outer, reject), failure])).toBe("ping");
    } finally {
      outer.destroy();
      outerServer.close();
    }
  },
);

test.concurrent(
  "server side: a peer that closes while the handshake is held closes the wrapped socket too",
  async () => {
    // The accepted socket still has plaintext queued the peer will never read;
    // the peer half-closes. Both the TLS socket and the accepted socket must
    // finish (node: EPIPE/ECONNRESET, then close on both), not leave the accepted
    // socket with its queued writes forever.
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const { promise: outcome, resolve } = Promise.withResolvers<{ secureClosed: boolean; acceptedClosed: boolean }>();
    using server = await listenTCP(accepted => {
      accepted.on("error", () => {});
      let backpressure = false;
      for (let i = 0; i < 64 && !backpressure; i++) backpressure = !accepted.write(Buffer.alloc(1024 * 1024, 0x62));
      const secure = new tls.TLSSocket(accepted, { isServer: true, ...serverTLS });
      secure.on("error", () => {});
      let secureClosed = false;
      secure.on("close", () => (secureClosed = true));
      accepted.on("close", () => resolve({ secureClosed, acceptedClosed: true }));
    });
    const socket = net.connect(server.port, "127.0.0.1");
    socket.on("error", () => {});
    await Promise.race([once(socket, "connect"), failure]);
    socket.pause();
    socket.end();
    expect(await Promise.race([outcome, failure])).toEqual({ secureClosed: true, acceptedClosed: true });
    socket.destroy();
  },
);

test.concurrent("unref() on the wrapped socket lets the process exit while the handshake is held", async () => {
  // node: one uv handle under both sockets, so unref() on the wrapped socket
  // counts even though the TLS layer is what reads now.
  using server = await listenTCP(accepted => {
    accepted.on("error", () => {});
    accepted.pause();
  });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const net = require("net"), tls = require("tls");
       const socket = net.connect(${server.port}, "127.0.0.1", () => {
         socket.cork();
         socket.write("STARTTLS");
         tls.connect({ socket, rejectUnauthorized: false }).on("error", () => {});
         socket.unref();
       });`,
    ],
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
  });
  expect(await proc.exited).toBe(0);
});

test.concurrent(
  "the peer ending its side does not cut off what an fd-adopted TLS socket is still writing",
  async () => {
    // allowHalfOpen server reads one chunk and ends its side; the client is in
    // the middle of an 8 MiB write. The TLS socket's readable side ending must
    // not tear the connection down under the write (node delivers all of it).
    const TOTAL = 8 * 1024 * 1024;
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const { promise: received, resolve } = Promise.withResolvers<number>();
    const server = tls.createServer({ ...serverTLS, allowHalfOpen: true }, secure => {
      secure.on("error", reject);
      let got = 0;
      secure.on("data", chunk => {
        if (got === 0) secure.end("bye");
        got += chunk.length;
      });
      secure.on("end", () => resolve(got));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    try {
      socket.on("error", reject);
      await Promise.race([once(socket, "connect"), failure]);
      const tlsSocket = tls.connect({ socket, ...clientTLS, allowHalfOpen: true });
      tlsSocket.on("error", reject);
      tlsSocket.resume();
      await Promise.race([once(tlsSocket, "secureConnect"), failure]);
      const writeResult = new Promise<Error | null | undefined>(r => tlsSocket.write(Buffer.alloc(TOTAL, 0x61), r));
      tlsSocket.end();
      expect({
        writeErr: await Promise.race([writeResult, failure]),
        received: await Promise.race([received, failure]),
      }).toEqual({ writeErr: null, received: TOTAL });
    } finally {
      socket.destroy();
      server.close();
    }
  },
);

test.concurrent("TLS over TLS: the peer closing the outer connection closes both layers cleanly", async () => {
  // The outer TLS socket's EOF reaches the inner engine natively, from inside
  // the outer socket's own end dispatch; the inner layer tearing both down from
  // there must not trip the outer dispatch up.
  const { promise: failure, reject } = Promise.withResolvers<never>();
  const outerServer = tls.createServer(serverTLS, outer => {
    outer.on("error", () => {});
    const inner = new tls.TLSSocket(outer, { isServer: true, ...serverTLS });
    inner.on("error", () => {});
    inner.once("data", () => outer.destroy());
  });
  outerServer.listen(0, "127.0.0.1");
  await once(outerServer, "listening");
  try {
    const outer = tls.connect({
      port: (outerServer.address() as net.AddressInfo).port,
      host: "127.0.0.1",
      ...clientTLS,
    });
    outer.on("error", () => {});
    await Promise.race([once(outer, "secureConnect"), failure]);
    const inner = tls.connect({ socket: outer, ...clientTLS });
    inner.on("error", () => {});
    await Promise.race([once(inner, "secureConnect"), failure]);
    inner.write("ping");
    await Promise.race([Promise.all([once(inner, "close"), once(outer, "close")]), failure]);
    expect([inner.destroyed, outer.destroyed]).toEqual([true, true]);
  } finally {
    outerServer.close();
  }
});

test.concurrent(
  "TLS over TLS: reconnecting the outer socket while the inner layer is live fails with EISCONN",
  async () => {
    // Same rule as for an fd-adopted socket: the outer socket is the inner
    // layer's transport now, and connect() must not swap the connection out from
    // under it (which would leave the inner socket with no close and its records
    // going to an unrelated peer).
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const outerServer = tls.createServer(serverTLS, outer => {
      outer.on("error", () => {});
      const inner = new tls.TLSSocket(outer, { isServer: true, ...serverTLS });
      inner.on("error", () => {});
      inner.on("data", chunk => inner.write(chunk));
    });
    outerServer.listen(0, "127.0.0.1");
    await once(outerServer, "listening");
    const port = (outerServer.address() as net.AddressInfo).port;
    try {
      const outer = tls.connect({ port, host: "127.0.0.1", ...clientTLS });
      outer.on("error", () => {});
      await Promise.race([once(outer, "secureConnect"), failure]);
      const inner = tls.connect({ socket: outer, ...clientTLS });
      inner.on("error", reject);
      await Promise.race([once(inner, "secureConnect"), failure]);
      inner.off("error", reject).on("error", () => {});
      const [err] = await Promise.race([once(outer.connect(port, "127.0.0.1"), "error"), failure]);
      expect((err as NodeJS.ErrnoException).code).toBe("EISCONN");
      await Promise.race([once(inner, "close"), failure]);
      expect(inner.destroyed).toBe(true);
    } finally {
      outerServer.close();
    }
  },
);

test.concurrent("ref() on the wrapped socket still holds the event loop after the upgrade", async () => {
  // node: the wrapped socket and the TLS socket share one uv handle, so
  // ref()/unref() on either counts. A client that parks its plain socket with
  // unref() and refs it again once it has a request in flight must get the
  // reply rather than exit.
  using server = await listenTCP(accepted => {
    const secure = new tls.TLSSocket(accepted, { isServer: true, ...serverTLS });
    secure.on("error", () => {});
    // The condition under test is that the child stays alive while *nothing*
    // happens on its side, so the reply has to come after a stretch of idle
    // loop; there is no event to key it on. A child that lost its ref exits
    // within that window and prints nothing.
    secure.on("data", () => setTimeout(() => secure.end("late reply"), 200));
  });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const net = require("net"), tls = require("tls");
       const socket = net.connect(${server.port}, "127.0.0.1", () => {
         socket.unref();
         const keep = setTimeout(() => {}, 10_000);
         const t = tls.connect({ socket, rejectUnauthorized: false }, () => {
           socket.ref();
           clearTimeout(keep);
           t.write("ping");
         });
         t.on("data", d => console.log("reply: " + d));
       });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "reply: late reply", exitCode: 0 });
});

test.concurrent("unref() on the wrapped socket releases the event loop after the upgrade", async () => {
  // The other direction of the test above: once the TLS layer is up, unref()
  // on the wrapped socket alone must let the process exit (node: one handle).
  using server = await listenTCP(accepted => {
    const secure = new tls.TLSSocket(accepted, { isServer: true, ...serverTLS });
    secure.on("error", () => {});
  });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const net = require("net"), tls = require("tls");
       const socket = net.connect(${server.port}, "127.0.0.1", () => {
         const t = tls.connect({ socket, rejectUnauthorized: false }, () => {
           t.on("data", () => {});
           console.log("secured");
           socket.unref();
         });
       });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "secured", exitCode: 0 });
});

test.concurrent("upgrading a setEncoding() socket with buffered input reports ERR_STREAM_WRAP", async () => {
  // What the socket already buffered has to be handed to the TLS layer, and on
  // a setEncoding() socket that is a string: not bytes anymore. Node's
  // JSStreamSocket code for this is ERR_STREAM_WRAP; it must reach the TLS
  // socket's listeners rather than stall the handshake or throw out of band.
  const { promise: outcome, resolve } = Promise.withResolvers<string>();
  using server = await listenTCP(accepted => {
    accepted.on("error", () => {});
    accepted.write("greeting");
  });

  const socket = net.connect(server.port, "127.0.0.1");
  try {
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    await once(socket, "readable");
    expect(socket.readableLength).toBeGreaterThan(0);
    socket.cork();
    socket.write("STARTTLS");
    const tlsSocket = tls.connect({ socket, ...clientTLS });
    tlsSocket.on("error", err => resolve((err as NodeJS.ErrnoException)?.code ?? String(err)));
    tlsSocket.on("secureConnect", () => resolve("secureConnect"));
    socket.uncork();
    expect(await outcome).toBe("ERR_STREAM_WRAP");
  } finally {
    socket.destroy();
  }
});

test.concurrent("tls.connect({ socket }) takes over a client socket that uses the onread option", async () => {
  // onread sockets deliver through their own handler table, straight into the
  // user's callback, so that table has to stop delivering as well.
  const { promise: failure, reject } = Promise.withResolvers<never>();
  using server = await listenOptimisticSTARTTLS(reject);

  let upgraded = false;
  let deliveredAfterUpgrade = 0;
  const socket = net.connect({
    port: server.port,
    host: "127.0.0.1",
    onread: {
      buffer: Buffer.alloc(64 * 1024),
      callback(nread: number) {
        if (upgraded) deliveredAfterUpgrade += nread;
        return true;
      },
    },
  });
  try {
    socket.on("error", reject);
    await Promise.race([once(socket, "connect"), failure]);
    const flushed = new Promise<void>(resolve => socket.write("STARTTLS", () => resolve()));
    await Promise.race([flushed, failure]);
    upgraded = true;
    const echoed = await Promise.race([pingOverTLS(socket, reject), failure]);
    expect({ echoed, deliveredAfterUpgrade }).toEqual({ echoed: "ping", deliveredAfterUpgrade: 0 });
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
    "fd adoption behind a pending write",
    // PROCEED is still corked when the wrap runs: the handshake is held until
    // it has been flushed.
    (accepted: net.Socket, wrap: () => void) => {
      accepted.cork();
      accepted.write("PROCEED");
      wrap();
      accepted.uncork();
    },
  ],
  [
    "fd adoption behind a write issued right after the wrap",
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
  "new TLSSocket(accepted, { isServer: true }) hands an already buffered ClientHello over once",
  async () => {
    // Paused-mode STARTTLS: the ClientHello that PROCEED triggers is sitting in
    // the accepted socket's readable buffer when the wrap runs, so the wrap has
    // to take it from there. Like node's initRead that hand-over read()s the
    // buffer, so a `data` listener attached by then sees those bytes once — and
    // nothing after them (pre-fix they were also pushed back into the buffer, and
    // the rest of the session followed).
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const { promise: serverSide, resolve } = Promise.withResolvers<{
      handedOver: number;
      emitted: number;
      buffered: number;
    }>();
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
          const handedOver = accepted.readableLength;
          const secure = new tls.TLSSocket(accepted, { isServer: true, ...serverTLS });
          secure.on("error", reject);
          const surfaced = watchSurfacing(accepted);
          secure.once("data", () => resolve({ handedOver, ...surfaced() }));
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
      const tlsSocket = tls.connect({ socket, ...clientTLS });
      tlsSocket.on("error", reject);
      tlsSocket.on("secureConnect", () => tlsSocket.write("ping"));
      const result = await Promise.race([serverSide, failure]);
      expect(result.handedOver).toBeGreaterThan(0);
      expect(result).toEqual({ handedOver: result.handedOver, emitted: result.handedOver, buffered: 0 });
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
    // and has to be handed over from there. Like node's initRead, that hand-over
    // read()s the buffer, which also emits those (and only those) bytes to a
    // `data` listener that is already attached; everything received afterwards
    // must stay with the inner TLS layer.
    const { promise: failure, reject } = Promise.withResolvers<never>();
    const { promise: serverSide, resolve: innerSecured } =
      Promise.withResolvers<() => { handedOver: number; emitted: number; buffered: number }>();
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
          const handedOver = outer.readableLength;
          const inner = new tls.TLSSocket(outer, { isServer: true, ...serverTLS });
          inner.on("error", reject);
          inner.on("data", chunk => inner.write(chunk));
          const surfaced = watchSurfacing(outer);
          inner.on("secure", () => innerSecured(() => ({ handedOver, ...surfaced() })));
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
      // Sampled once the echo is back, i.e. after the server side has finished
      // dispatching everything the client sent.
      const server = (await Promise.race([serverSide, failure]))();
      expect(server.handedOver).toBeGreaterThan(0);
      expect({ echoed, client: clientSurfaced(), server }).toEqual({
        echoed: "ping",
        client: { emitted: 0, buffered: 0 },
        server: { handedOver: server.handedOver, emitted: server.handedOver, buffered: 0 },
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

test.concurrent("TLS traffic keeps the wrapped socket's idle timeout alive, as in node", async () => {
  // Node links the TLSSocket to the net.Socket it wraps (`_parent`) and
  // refreshes both idle timers on activity; the wrapped socket itself no
  // longer sees any bytes, so without that link it times out mid-session no
  // matter how busy the TLS layer is.
  const IDLE = 1000;
  const { promise: failure, reject } = Promise.withResolvers<never>();
  using server = await listenTCP(accepted => wrapAndEcho(accepted, reject));
  const socket = net.connect(server.port, "127.0.0.1");
  try {
    socket.on("error", reject);
    await Promise.race([once(socket, "connect"), failure]);
    const tlsSocket = tls.connect({ socket, ...clientTLS });
    tlsSocket.on("error", reject);
    expect(tlsSocket._parent).toBe(socket);
    await Promise.race([once(tlsSocket, "secureConnect"), failure]);
    let parentTimedOut = false;
    socket.setTimeout(IDLE, () => (parentTimedOut = true));
    // Back-to-back ping/echo round trips (each far shorter than IDLE) until
    // well past IDLE since the timer was armed.
    const started = Date.now();
    tlsSocket.write("ping");
    await Promise.race([
      new Promise<void>(resolve => {
        tlsSocket.on("data", () => {
          if (Date.now() - started > IDLE * 2.5) resolve();
          else tlsSocket.write("ping");
        });
      }),
      failure,
    ]);
    expect(parentTimedOut).toBe(false);
  } finally {
    socket.setTimeout(0);
    socket.destroy();
  }
});
