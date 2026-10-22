/**
 * The close of a connection under a TLS socket and the net.Socket it wraps
 * (`new tls.TLSSocket(socket, { isServer: true })`, `tls.connect({ socket })`).
 *
 * TLSWrap owns the reads of the handle it wraps, so the EOF or the read error is the TLS socket's to report:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L723-L727
 * The wrapped socket only closes, from TLSWrap.close(), after the 'error' of the TLS socket and before its 'close':
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L676-L688
 *
 * Each test logs the events of both sockets in order. The expected logs are what Node.js v26.3.0 prints.
 *
 * Works with both:
 *   bun bd test test/js/node/tls/node-tls-wrapped-socket-close.test.ts
 *   node --test test/js/node/tls/node-tls-wrapped-socket-close.test.ts
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fstatSync, readFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";
import { Duplex } from "node:stream";
import { describe, test } from "node:test";
import tls from "node:tls";

const fixtures = join(import.meta.dirname, "fixtures");
const key = readFileSync(join(fixtures, "agent1-key.pem"));
const cert = readFileSync(join(fixtures, "agent1-cert.pem"));

// One ordered log of the events of the observed sockets. `closed` holds one promise per socket.
function eventLog() {
  const events: string[] = [];
  const closed: Promise<void>[] = [];
  function observe(name: string, socket: net.Socket) {
    const { promise, resolve } = Promise.withResolvers<void>();
    closed.push(promise);
    socket.on("end", () => events.push(`${name} end`));
    socket.on("finish", () => events.push(`${name} finish`));
    socket.on("error", (err: NodeJS.ErrnoException) => events.push(`${name} error ${err.code}`));
    socket.on("close", hadError => {
      events.push(`${name} close hadError=${hadError}`);
      resolve();
    });
  }
  return { events, closed, observe };
}

async function listen(server: net.Server) {
  await once(server.listen(0, "127.0.0.1"), "listening");
  return (server.address() as net.AddressInfo).port;
}

// `new tls.TLSSocket(socket, { isServer: true })` over an accepted socket. Both are observed.
async function serverSideWrap(
  connectPeer: (port: number) => net.Socket,
  onWrap: (tlsSocket: tls.TLSSocket, events: string[]) => void,
) {
  const { events, closed, observe } = eventLog();
  const wrapped = Promise.withResolvers<void>();
  const server = net.createServer(raw => {
    const tlsSocket = new tls.TLSSocket(raw, { isServer: true, key, cert });
    observe("raw", raw);
    observe("tls", tlsSocket);
    onWrap(tlsSocket, events);
    wrapped.resolve();
  });
  const peer = connectPeer(await listen(server));
  // A TLS peer whose handshake is cut short reports ECONNRESET.
  peer.on("error", () => {});
  try {
    await wrapped.promise;
    await Promise.all(closed);
    return events;
  } finally {
    peer.destroy();
    server.close();
  }
}

// `tls.connect({ socket })` over a connected socket. Both are observed.
async function clientSideWrap(server: net.Server, onWrap: (tlsSocket: tls.TLSSocket) => void) {
  const { events, closed, observe } = eventLog();
  const raw = net.connect(await listen(server), "127.0.0.1");
  try {
    await once(raw, "connect");
    const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
    observe("raw", raw);
    observe("tls", tlsSocket);
    onWrap(tlsSocket);
    await Promise.all(closed);
    return events;
  } finally {
    raw.destroy();
    server.close();
  }
}

// @types/node does not list allowHalfOpen for tls.connect(). Node passes it on to the socket.
function halfOpenTLSPeer(port: number) {
  return tls.connect({
    port,
    host: "127.0.0.1",
    rejectUnauthorized: false,
    allowHalfOpen: true,
  } as tls.ConnectionOptions);
}

function ownerError() {
  return Object.assign(new Error("destroyed by its owner"), { code: "OWNER_DESTROY" });
}

// The TLS socket has sent its FIN, so the peer's FIN closes the connection under
// both sockets at once, with no TLS-level EOF ahead of it.
describe("the TLS socket end()s, then the peer closes the connection with no close_notify", () => {
  const eof = ["tls finish", "tls end", "raw close hadError=false", "tls close hadError=false"];

  for (const peerKind of ["tls", "net"]) {
    for (const when of ["process.nextTick", "setImmediate"]) {
      test(`new TLSSocket(socket, { isServer }) end()s before the handshake completes, ${peerKind} peer, from ${when}`, async () => {
        const events = await serverSideWrap(
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
        assert.deepStrictEqual(events, eof);
      });
    }
  }

  test("new TLSSocket(socket, { isServer }) end()s after the handshake, the peer answers 'end' with destroy()", async () => {
    const events = await serverSideWrap(
      port => {
        const peer = halfOpenTLSPeer(port);
        peer.on("end", () => peer.destroy());
        return peer.resume();
      },
      tlsSocket => tlsSocket.on("secure", () => tlsSocket.end()),
    );
    assert.deepStrictEqual(events, eof);
  });

  test("tls.connect({ socket }) end()s after the handshake, the peer answers 'end' with destroy()", async () => {
    const events = await clientSideWrap(
      tls.createServer({ key, cert, allowHalfOpen: true }, peer => {
        peer.on("error", () => {});
        peer.on("end", () => peer.destroy());
        peer.resume();
      }),
      tlsSocket => tlsSocket.on("secureConnect", () => tlsSocket.end()),
    );
    assert.deepStrictEqual(events, eof);
  });

  test("data that nothing read before the connection closed is still delivered", async () => {
    // The peer answers 'end' with its last bytes, then closes. Nothing reads the TLS
    // socket until the connection has closed under it.
    const events = await serverSideWrap(
      port => {
        const peer = halfOpenTLSPeer(port);
        peer.on("end", () => peer.write("late", () => peer.destroy()));
        return peer.resume();
      },
      (tlsSocket, events) => {
        tlsSocket.on("secure", () => tlsSocket.end());
        (function readOnceTheConnectionClosed() {
          const { ended } = (tlsSocket as unknown as { _readableState: { ended: boolean } })._readableState;
          if (!ended && !tlsSocket.destroyed) return setImmediate(readOnceTheConnectionClosed);
          events.push(`connection closed, unread=${tlsSocket.readableLength}`);
          tlsSocket.on("data", data => events.push(`tls data ${data}`));
        })();
      },
    );
    assert.deepStrictEqual(events, [
      "tls finish",
      "connection closed, unread=4",
      "tls data late",
      "tls end",
      "raw close hadError=false",
      "tls close hadError=false",
    ]);
  });
});

describe("the peer resets the connection", () => {
  const reset = ["tls error ECONNRESET", "raw close hadError=false", "tls close hadError=true"];

  test("new TLSSocket(socket, { isServer }), before the handshake completes", async () => {
    let peer: net.Socket;
    const events = await serverSideWrap(
      port => (peer = net.connect(port, "127.0.0.1")),
      // bun's wrap adopts the connection's handle on the tick after it is made.
      () => setImmediate(() => peer.resetAndDestroy()),
    );
    assert.deepStrictEqual(events, reset);
  });

  test("new TLSSocket(socket, { isServer }), after the handshake", async () => {
    let peerRaw: net.Socket;
    const events = await serverSideWrap(
      port => {
        peerRaw = net.connect(port, "127.0.0.1");
        const peer = tls.connect({ socket: peerRaw, rejectUnauthorized: false }, () => peer.write("hi"));
        peer.on("error", () => {});
        return peerRaw;
      },
      tlsSocket => tlsSocket.on("data", () => setImmediate(() => peerRaw.resetAndDestroy())),
    );
    assert.deepStrictEqual(events, reset);
  });

  test("tls.connect({ socket }), after the handshake", async () => {
    const events = await clientSideWrap(
      net.createServer(peerRaw => {
        const peer = new tls.TLSSocket(peerRaw, { isServer: true, key, cert });
        peer.on("error", () => {});
        peerRaw.on("error", () => {});
        peer.on("data", () => setImmediate(() => peerRaw.resetAndDestroy()));
      }),
      tlsSocket => tlsSocket.on("secureConnect", () => tlsSocket.write("hi")),
    );
    assert.deepStrictEqual(events, reset);
  });

  test("a socket injected into a tls.Server, before the handshake completes: 'tlsClientError'", async () => {
    // The TLS socket that a tls.Server makes over an injected socket is only reachable from 'tlsClientError'.
    const { events, closed, observe } = eventLog();
    const tlsServer = tls.createServer({ key, cert });
    tlsServer.on("tlsClientError", (err: NodeJS.ErrnoException, tlsSocket) => {
      events.push(`tlsClientError ${err.code}`);
      observe("tls", tlsSocket);
    });
    const injected = Promise.withResolvers<void>();
    const server = net.createServer(raw => {
      observe("raw", raw);
      tlsServer.emit("connection", raw);
      setImmediate(injected.resolve);
    });
    const peer = net.connect(await listen(server), "127.0.0.1");
    peer.on("error", () => {});
    try {
      await injected.promise;
      peer.resetAndDestroy();
      // 'tlsClientError' comes ahead of the 'close' of the wrapped socket. Without it there is no TLS socket to wait for.
      await closed[0];
      await Promise.all(closed);
      assert.deepStrictEqual(events, [
        "tlsClientError ECONNRESET",
        "raw close hadError=false",
        "tls close hadError=true",
      ]);
    } finally {
      peer.destroy();
      server.close();
    }
  });
});

describe("the owner destroys the TLS socket with an error", () => {
  const destroyed = ["tls error OWNER_DESTROY", "raw close hadError=false", "tls close hadError=true"];

  test("new TLSSocket(socket, { isServer }), before the handshake completes", async () => {
    const events = await serverSideWrap(
      port => net.connect(port, "127.0.0.1"),
      // bun's wrap adopts the connection's handle on the tick after it is made.
      tlsSocket => setImmediate(() => tlsSocket.destroy(ownerError())),
    );
    assert.deepStrictEqual(events, destroyed);
  });

  test("new TLSSocket(socket, { isServer }), after the handshake", async () => {
    const events = await serverSideWrap(
      port => tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }).resume(),
      tlsSocket => tlsSocket.on("secure", () => tlsSocket.destroy(ownerError())),
    );
    assert.deepStrictEqual(events, destroyed);
  });

  test("tls.connect({ socket }), after the handshake", async () => {
    const events = await clientSideWrap(
      tls.createServer({ key, cert }, peer => peer.on("error", () => {}).resume()),
      tlsSocket => tlsSocket.on("secureConnect", () => tlsSocket.destroy(ownerError())),
    );
    assert.deepStrictEqual(events, destroyed);
  });
});

// 'error' and 'close' only, and no 'close' argument for the wrapped socket: node passes none when it never had a handle.
function lifecycleLog() {
  const events: string[] = [];
  const closed: Promise<void>[] = [];
  function observe(name: string, socket: Duplex, onError = true) {
    const { promise, resolve } = Promise.withResolvers<void>();
    closed.push(promise);
    if (onError) socket.on("error", (err: NodeJS.ErrnoException) => events.push(`${name} error ${err.code}`));
    socket.on("close", hadError => {
      events.push(name === "tls" ? `tls close hadError=${hadError}` : `${name} close`);
      resolve();
    });
  }
  return { events, closed, observe };
}

// The local port of a live connection: nothing listens on it, and no concurrent listen(0) can be handed it.
async function refusedPort() {
  const sink = net.createServer();
  const holder = net.connect(await listen(sink), "127.0.0.1");
  const [[accepted]] = await Promise.all([once(sink, "connection"), once(holder, "connect")]);
  return {
    port: (holder.address() as net.AddressInfo).port,
    async [Symbol.asyncDispose]() {
      holder.destroy();
      accepted.destroy();
      sink.close();
      await once(sink, "close");
    },
  };
}

const wraps: [string, (raw: Duplex) => tls.TLSSocket][] = [
  ["tls.connect({ socket })", raw => tls.connect({ socket: raw, rejectUnauthorized: false })],
  ["new TLSSocket(socket)", raw => new tls.TLSSocket(raw as net.Socket, { rejectUnauthorized: false })],
  ["new TLSSocket(socket, { isServer })", raw => new tls.TLSSocket(raw as net.Socket, { isServer: true, key, cert })],
];

// destroy() of the wrapped socket closes its handle at once: https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L346-L358
// The TLS socket hears of it from the 'close' of that socket, at the end of that loop turn: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L739-L741
describe("the owner destroys the wrapped socket: the TLS socket does no more I/O", () => {
  // What libuv fails a write on a handle that closes with.
  const closingHandle = process.platform === "win32" ? "EPIPE" : "EBADF";
  const big = Buffer.alloc(16 * 1024 * 1024, "a");
  // For a row that passes in Node.js and not yet in Bun: what Bun does.
  const differs = (how: string) => ({ todo: typeof Bun !== "undefined" && how });
  // Node's TLSWrap closes at once over a handle that its owner closed. So a destroy() of the TLS socket after that one
  // emits the 'close' of the TLS socket in the call, ahead of the 'error' that it was called with. Bun emits that 'close'
  // with the 'close' of the wrapped socket, right ahead of it: node:http destroys a socket under its parser, and an
  // agent under a loop over its pool, and neither expects the 'close' in the call.
  const inNode = typeof Bun === "undefined";
  const closeAndError = (code: string) =>
    inNode ? ["tls close hadError=true", `tls error ${code}`] : [`tls error ${code}`, "tls close hadError=true"];
  const closeInTheCall = (returned: string) =>
    inNode ? ["tls close hadError=false", returned] : [returned, "tls close hadError=false"];
  // Node destroys the TLS socket in its listener for the 'close' of the wrapped socket. So a 'close' listener that the
  // wrapped socket had before the wrap runs ahead of what that destroy() emits. Bun destroys the TLS socket ahead of
  // that 'close', and emits the 'close' of the TLS socket ahead of it too, as it did before the fd closed in the call:
  // a listener of either 'close' can then connect either socket again.
  const rawCloseFirst = (...ofTheTLSSocket: string[]) =>
    inNode ? ["raw close hadError=false", ...ofTheTLSSocket] : [...ofTheTLSSocket, "raw close hadError=false"];
  const isOpen = (fd: number) => {
    try {
      return fstatSync(fd).isSocket();
    } catch {
      return false;
    }
  };

  // `pair` is the ordered log of the wrapped socket and its TLS socket. `peer` is the one of the other end: what it
  // reads, and its errors where the platform is known to report none for a write after the FIN.
  function ioLog() {
    const pair: string[] = [];
    const peer: string[] = [];
    const closed: Promise<void>[] = [];
    function observe(name: string, socket: net.Socket) {
      socket.on("data", data => pair.push(`${name} data ${data}`));
      socket.on("end", () => pair.push(`${name} end`));
      socket.on("finish", () => pair.push(`${name} finish`));
      socket.on("error", (err: NodeJS.ErrnoException) => pair.push(`${name} error ${err.code}`));
      closed.push(
        new Promise<void>(resolve =>
          socket.on("close", hadError => (pair.push(`${name} close hadError=${hadError}`), resolve())),
        ),
      );
    }
    function observePeer(socket: net.Socket, reads = true) {
      if (reads) socket.on("data", data => peer.push(`data ${data}`));
      socket.on("error", (err: NodeJS.ErrnoException) => {
        if (process.platform === "linux") peer.push(`error ${err.code}`);
      });
      return new Promise<void>(resolve => socket.on("close", () => resolve()));
    }
    const written = (name: string) => (err?: Error | null) => pair.push(`${name}: ${err ? err.message : "ok"}`);
    return { pair, peer, closed, observe, observePeer, written };
  }

  type Session = { raw: net.Socket; tlsSocket: tls.TLSSocket; peer: tls.TLSSocket; close: () => void };

  // One established session for each wrap that takes over the fd of `raw`. `peer` is the TLS socket at the other end.
  const sessions: [string, (allowHalfOpen?: boolean) => Promise<Session>][] = [
    [
      "a socket injected into a tls.Server",
      async allowHalfOpen => {
        const { promise, resolve } = Promise.withResolvers<Session>();
        let raw: net.Socket;
        const close = () => (raw?.destroy(), peer.destroy(), server.close());
        const tlsServer = tls.createServer({ key, cert }, tlsSocket => resolve({ raw, tlsSocket, peer, close }));
        const server = net.createServer({ allowHalfOpen }, accepted => tlsServer.emit("connection", (raw = accepted)));
        const peer = tls.connect({ port: await listen(server), host: "127.0.0.1", rejectUnauthorized: false });
        return promise;
      },
    ],
    [
      "new TLSSocket(socket, { isServer })",
      async allowHalfOpen => {
        const { promise, resolve } = Promise.withResolvers<Session>();
        const server = net.createServer({ allowHalfOpen }, raw => {
          const tlsSocket = new tls.TLSSocket(raw, { isServer: true, key, cert });
          const close = () => (raw.destroy(), peer.destroy(), server.close());
          tlsSocket.on("secure", () => resolve({ raw, tlsSocket, peer, close }));
        });
        const peer = tls.connect({ port: await listen(server), host: "127.0.0.1", rejectUnauthorized: false });
        return promise;
      },
    ],
    [
      "tls.connect({ socket })",
      async allowHalfOpen => {
        const accepted = Promise.withResolvers<tls.TLSSocket>();
        const server = tls.createServer({ key, cert }, accepted.resolve);
        const raw = net.connect({ port: await listen(server), host: "127.0.0.1", allowHalfOpen });
        await once(raw, "connect");
        const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
        const [peer] = await Promise.all([accepted.promise, once(tlsSocket, "secureConnect")]);
        return { raw, tlsSocket, peer, close: () => (raw.destroy(), peer.destroy(), server.close()) };
      },
    ],
    [
      "new TLSSocket(socket)",
      async allowHalfOpen => {
        const accepted = Promise.withResolvers<tls.TLSSocket>();
        const server = tls.createServer({ key, cert }, accepted.resolve);
        const raw = net.connect({ port: await listen(server), host: "127.0.0.1", allowHalfOpen });
        await once(raw, "connect");
        const tlsSocket = new tls.TLSSocket(raw, { rejectUnauthorized: false });
        // What the mysql driver calls: node sends the ClientHello of this wrap here.
        (tlsSocket as unknown as { _start(): void })._start();
        const [peer] = await Promise.all([accepted.promise, once(tlsSocket, "secure")]);
        return { raw, tlsSocket, peer, close: () => (raw.destroy(), peer.destroy(), server.close()) };
      },
    ],
  ];
  const clientWraps = ["tls.connect({ socket })", "new TLSSocket(socket)"];

  // Runs `act` in the 'data' of the TLS socket for the "ping" of the peer, and waits for the three sockets to close.
  async function inData(
    establish: () => Promise<Session>,
    act: (session: Session, log: ReturnType<typeof ioLog>) => void | Promise<void>[],
  ) {
    const log = ioLog();
    const session = await establish();
    try {
      log.observe("raw", session.raw);
      log.observe("tls", session.tlsSocket);
      // The peer reads the FIN or the reset.
      log.closed.push(log.observePeer(session.peer));
      session.tlsSocket.once("data", () => log.closed.push(...(act(session, log) ?? [])));
      session.peer.write("ping");
      // `act` can add to `closed`.
      for (let seen = 0; seen < log.closed.length;) await log.closed[seen++];
      return { pair: log.pair, peer: log.peer };
    } finally {
      session.close();
    }
  }

  for (const [name, establish] of sessions) {
    for (const verb of ["destroy", "resetAndDestroy"] as const) {
      const reset = verb === "resetAndDestroy" && process.platform === "linux" ? ["error ECONNRESET"] : [];

      test(`${name}, ${verb}() in 'data': the peer gets no answer and the write fails`, async () => {
        const result = await inData(establish, ({ raw, tlsSocket }, { pair, written }) => {
          raw[verb]();
          pair.push(`write() returned ${tlsSocket.write("pong", written("tls write"))}`);
        });
        assert.deepStrictEqual(result, {
          pair: [
            "tls data ping",
            "write() returned false",
            `tls write: write ${closingHandle}`,
            ...closeAndError(closingHandle),
            "raw close hadError=false",
          ],
          peer: reset,
        });
      });

      // TLSWrap encrypts nothing for them, so they do not reach the closed handle.
      test(`${name}, ${verb}() in 'data': writes of no data complete, and so does end()`, async () => {
        const result = await inData(establish, ({ raw, tlsSocket }, { pair, written }) => {
          raw[verb]();
          pair.push(`write() returned ${tlsSocket.write("", written("tls write of a string"))}`);
          tlsSocket.cork();
          tlsSocket.write(Buffer.alloc(0), written("tls write of a buffer"));
          tlsSocket.write("", written("tls write of a string, corked"));
          tlsSocket.uncork();
          tlsSocket.end(Buffer.alloc(0));
        });
        assert.deepStrictEqual(result, {
          pair: [
            "tls data ping",
            "write() returned true",
            "tls write of a string: ok",
            "tls write of a buffer: ok",
            "tls write of a string, corked: ok",
            "tls finish",
            "tls close hadError=false",
            "raw close hadError=false",
          ],
          peer: reset,
        });
      });

      // libuv runs the close callback of the handle past the immediates of the loop turn, and node destroys the TLS
      // socket from it.
      test(`${name}, ${verb}() in a timer: 'close' listeners that an immediate adds hear both`, async () => {
        const session = await establish();
        try {
          for (const socket of [session.raw, session.tlsSocket, session.peer]) socket.on("error", () => {});
          const heard = await new Promise<string[]>(resolve => {
            setTimeout(() => {
              session.raw[verb]();
              setImmediate(() => {
                const log: string[] = [];
                session.tlsSocket.on("close", () => log.push("tls close"));
                session.raw.on("close", () => (log.push("raw close"), resolve(log)));
              });
            }, 1);
          });
          assert.deepStrictEqual(heard, ["tls close", "raw close"]);
        } finally {
          session.close();
        }
      });

      test(`${name}, ${verb}() in a timer: end() of the TLS socket in an immediate of that loop turn finishes it`, async () => {
        const { pair, closed, observe, written } = ioLog();
        const session = await establish();
        try {
          observe("raw", session.raw);
          observe("tls", session.tlsSocket);
          session.peer.on("error", () => {});
          setTimeout(() => {
            session.raw[verb]();
            setImmediate(() => session.tlsSocket.end(written("end")));
          }, 1);
          await Promise.all(closed);
          assert.deepStrictEqual(pair, [
            "end: ok",
            "tls finish",
            "tls close hadError=false",
            "raw close hadError=false",
          ]);
        } finally {
          session.close();
        }
      });
    }

    test(`${name}: a write in flight is cancelled`, async () => {
      const { pair, closed, observe, observePeer, written } = ioLog();
      const session = await establish();
      try {
        // Out of the callback of the handshake: a write from there fails with another error in newer node.
        await new Promise(resolve => setImmediate(resolve));
        observe("raw", session.raw);
        observe("tls", session.tlsSocket);
        // It reads nothing, so the kernel does not take all of `big`.
        observePeer(session.peer.pause(), false);
        session.tlsSocket.write(big, written("tls write"));
        session.tlsSocket.write("tail", written("tls queued write"));
        session.raw.destroy();
        await Promise.all(closed);
        assert.deepStrictEqual(
          { pair, bytesWritten: session.tlsSocket.bytesWritten },
          {
            pair: [
              "tls write: write ECANCELED",
              "tls queued write: write ECANCELED",
              ...closeAndError("ECANCELED"),
              "raw close hadError=false",
            ],
            bytesWritten: big.length,
          },
        );
      } finally {
        session.close();
      }
    });

    // Bun only: node hands a write to the handle in the call and completes it in the check phase. So what its destroy()
    // finds behind that write depends on the phase of the loop: it fails on a handle that closes, or it is cancelled.
    // Here the Writable hands over one write in a tick, and the destroy() hands over the rest.
    for (const behind of [1, 2]) {
      test(
        `${name}: ${behind} of the writes that the TLS socket took ahead of the destroy() waited behind the first: all reach the peer, and report no error`,
        { skip: typeof Bun === "undefined" },
        async () => {
          const { pair, closed, observe, written } = ioLog();
          const session = await establish();
          try {
            observe("raw", session.raw);
            observe("tls", session.tlsSocket);
            let received = "";
            session.peer.on("error", () => {}).on("data", data => (received += data));
            closed.push(new Promise<void>(resolve => session.peer.on("close", () => resolve())));
            let bytesWrittenAtClose: number | undefined;
            session.tlsSocket.on("close", () => (bytesWrittenAtClose = session.tlsSocket.bytesWritten));
            session.tlsSocket.write("first ", written("first write"));
            if (behind === 2) session.tlsSocket.write("second ", written("second write"));
            session.tlsSocket.end("third", written("end"));
            session.raw.destroy();
            // The Writable holds the first write until its callback, and no longer what the destroy() handed over.
            const held = session.tlsSocket.writableLength;
            await Promise.all(closed);
            const sent = behind === 2 ? "first second third" : "first third";
            assert.deepStrictEqual(
              { pair, received, held, bytesWrittenAtClose },
              {
                pair: [
                  "first write: ok",
                  ...(behind === 2 ? ["second write: ok"] : []),
                  "end: ok",
                  "tls finish",
                  "tls close hadError=false",
                  "raw close hadError=false",
                ],
                received: sent,
                held: "first ".length,
                bytesWrittenAtClose: sent.length,
              },
            );
          } finally {
            session.close();
          }
        },
      );
    }

    // Bun only, as the row above. The handle gets these writes as the one write that the Writable makes of them.
    test(
      `${name}: strings that the TLS socket took ahead of the destroy() reach the peer in their encoding`,
      { skip: typeof Bun === "undefined" },
      async () => {
        const session = await establish();
        try {
          for (const socket of [session.raw, session.tlsSocket]) socket.on("error", () => {});
          const received: Buffer[] = [];
          session.peer.on("error", () => {}).on("data", data => received.push(data));
          const peerClosed = new Promise<void>(resolve => session.peer.on("close", () => resolve()));
          const written: string[] = [];
          const callback = (name: string) => (err?: Error | null) =>
            written.push(`${name}: ${err ? err.message : "ok"}`);
          session.tlsSocket.cork();
          session.tlsSocket.write("1", callback("utf8"));
          session.tlsSocket.write("h\u00e9llo", "utf-16le", callback("utf-16le"));
          session.tlsSocket.write("6869", "hex", callback("hex"));
          session.tlsSocket.write(Buffer.from("3"), callback("buffer"));
          session.raw.destroy();
          session.tlsSocket.uncork();
          await peerClosed;
          const expected = Buffer.concat([
            Buffer.from("1"),
            Buffer.from("h\u00e9llo", "utf-16le"),
            Buffer.from("6869", "hex"),
            Buffer.from("3"),
          ]);
          assert.deepStrictEqual(
            { written, received: Buffer.concat(received).toString("hex") },
            { written: ["utf8: ok", "utf-16le: ok", "hex: ok", "buffer: ok"], received: expected.toString("hex") },
          );
        } finally {
          session.close();
        }
      },
    );

    // The Writable of the TLS socket holds the write of no data when the destroy() comes. So the write behind it is not
    // handed to the closed handle: it fails when the TLS socket is destroyed.
    test(`${name}: a write behind a write of no data that the TLS socket holds at the destroy() raises no 'error'`, async () => {
      const { pair, closed, observe } = ioLog();
      const session = await establish();
      try {
        observe("raw", session.raw);
        observe("tls", session.tlsSocket);
        session.peer.on("error", () => {});
        const results: string[] = [];
        const failed = Promise.withResolvers<void>();
        // In the check phase of the loop, where node completes a write of no data.
        setImmediate(() => {
          session.tlsSocket.write("", err => results.push(`no data: ${err ? err.message : "ok"}`));
          session.raw.destroy();
          session.tlsSocket.write("later", err => {
            results.push(`later: ${err ? err.message : "ok"}`);
            failed.resolve();
          });
        });
        await Promise.all([...closed, failed.promise]);
        assert.deepStrictEqual(
          { pair, results },
          {
            pair: ["tls close hadError=false", "raw close hadError=false"],
            results: ["no data: ok", "later: Cannot call write after a stream was destroyed"],
          },
        );
      } finally {
        session.close();
      }
    });

    // The kernel does not take all of a write that waited in the TLS socket, so the destroy() cuts it and it fails.
    test(`${name}: no 'drain' reports a write that the destroy() cut as flushed`, async () => {
      const session = await establish();
      try {
        for (const socket of [session.raw, session.tlsSocket]) socket.on("error", () => {});
        // It reads nothing.
        session.peer.on("error", () => {}).pause();
        // Out of the callback of the handshake: a write from there fails with another error in newer node.
        await new Promise(resolve => setImmediate(resolve));
        let drains = 0;
        session.tlsSocket.on("drain", () => drains++);
        const failed = Promise.withResolvers<boolean>();
        session.tlsSocket.write("head");
        const needsDrain = !session.tlsSocket.write(big, err => failed.resolve(!!err));
        session.raw.destroy();
        const [bigFailed] = await Promise.all([failed.promise, once(session.tlsSocket, "close")]);
        assert.deepStrictEqual({ needsDrain, bigFailed, drains }, { needsDrain: true, bigFailed: true, drains: 0 });
      } finally {
        session.close();
      }
    });

    test(`${name}: destroy() of the TLS socket right after the destroy() emits one 'close', ahead of the other`, async () => {
      const result = await inData(establish, ({ raw, tlsSocket }, { pair }) => {
        raw.destroy();
        tlsSocket.destroy();
        pair.push("tls destroy() returned");
      });
      assert.deepStrictEqual(result, {
        pair: ["tls data ping", ...closeInTheCall("tls destroy() returned"), "raw close hadError=false"],
        peer: [],
      });
    });

    test(`${name}: unread data behind the EOF of the peer does not keep the TLS socket open`, async () => {
      const { pair, closed, observePeer } = ioLog();
      const session = await establish();
      try {
        session.raw.on("error", () => {});
        session.tlsSocket.on("error", () => {});
        observePeer(session.peer);
        session.peer.end("late");
        // Nothing reads the TLS socket: its 'end' waits for a reader.
        const { _readableState: readable } = session.tlsSocket as unknown as { _readableState: { ended: boolean } };
        while (!readable.ended) await new Promise(resolve => setImmediate(resolve));
        for (const [socketName, socket] of [
          ["tls", session.tlsSocket],
          ["raw", session.raw],
        ] as const) {
          closed.push(
            new Promise<void>(resolve => socket.on("close", () => (pair.push(`${socketName} close`), resolve()))),
          );
        }
        pair.push(`unread=${session.tlsSocket.readableLength}`);
        session.raw.destroy();
        await Promise.all(closed);
        assert.deepStrictEqual(pair, ["unread=4", "tls close", "raw close"]);
      } finally {
        session.close();
      }
    });

    test(`${name}: destroy() closes the fd in the call`, { skip: process.platform === "win32" }, async () => {
      const session = await establish();
      try {
        for (const socket of [session.raw, session.tlsSocket, session.peer]) socket.on("error", () => {});
        const { fd } = (session.raw as unknown as { _handle: { fd: number } })._handle;
        const before = isOpen(fd);
        session.raw.destroy();
        assert.deepStrictEqual({ before, after: isOpen(fd) }, { before: true, after: false });
      } finally {
        session.close();
      }
    });

    // A handle that has closed takes no write: https://github.com/nodejs/node/blob/v26.3.0/src/stream_base.cc#L657-L666
    test(
      `${name}: a write in a 'close' listener of the wrapped socket that runs ahead of the TLS socket's`,
      differs("the TLS socket is destroyed ahead of the 'close' of the wrapped socket, as it was before"),
      async () => {
        const result = await inData(establish, ({ raw, tlsSocket }, { pair, written }) => {
          raw.prependListener("close", () => {
            pair.push(`write() returned ${tlsSocket.write("pong", written("tls write"))}`);
          });
          raw.destroy();
        });
        assert.deepStrictEqual(result, {
          pair: [
            "tls data ping",
            "write() returned false",
            "tls close hadError=false",
            "raw close hadError=false",
            "tls write: write EINVAL",
          ],
          peer: [],
        });
      },
    );

    // libuv runs the close callbacks at the end of the loop turn of the destroy(), and node destroys the TLS socket from
    // them. So a write from a later loop turn finds a destroyed stream. In Bun a timer or an I/O callback can still run
    // ahead of that close, and its write then fails in the same way when the TLS socket is destroyed. So the log of the
    // two sockets does not hold the write.
    const failsAsDestroyed = {
      pair: ["tls data ping", "tls close hadError=false", "raw close hadError=false"],
      peer: [],
      write: "Cannot call write after a stream was destroyed",
    };
    test(`${name}: a write from the next I/O callback fails as on a destroyed stream, with no 'error'`, async () => {
      let relayed = () => {};
      const relay = net.createServer(far => far.once("data", () => relayed()));
      const near = net.connect(await listen(relay), "127.0.0.1");
      try {
        await once(near, "connect");
        const late = Promise.withResolvers<string>();
        const result = await inData(establish, ({ raw, tlsSocket }) => {
          relayed = () => tlsSocket.write("pong", err => late.resolve(err ? err.message : "ok"));
          raw.destroy();
          near.write("go");
        });
        assert.deepStrictEqual({ ...result, write: await late.promise }, failsAsDestroyed);
      } finally {
        near.destroy();
        relay.close();
      }
    });

    test(`${name}: a write from a timer fails as on a destroyed stream, with no 'error'`, async () => {
      const late = Promise.withResolvers<string>();
      const result = await inData(establish, ({ raw, tlsSocket }) => {
        raw.destroy();
        setTimeout(() => tlsSocket.write("pong", err => late.resolve(err ? err.message : "ok")), 1);
      });
      assert.deepStrictEqual({ ...result, write: await late.promise }, failsAsDestroyed);
    });

    // Until the end of that loop turn node fails a write as on a handle that closes.
    test(
      `${name}: a write from an immediate that was made at the destroy() fails as on a handle that closes`,
      differs("a write after the tick of the destroy() fails as on a destroyed stream, with no 'error'"),
      async () => {
        const result = await inData(establish, ({ raw, tlsSocket }, { pair, written }) => {
          const late = Promise.withResolvers<void>();
          raw.destroy();
          setImmediate(() => {
            pair.push(
              `write() returned ${tlsSocket.write("pong", err => (written("tls write")(err), late.resolve()))}`,
            );
          });
          return [late.promise];
        });
        assert.deepStrictEqual(result, {
          pair: [
            "tls data ping",
            "write() returned false",
            `tls write: write ${closingHandle}`,
            ...closeAndError(closingHandle),
            "raw close hadError=false",
          ],
          peer: [],
        });
      },
    );

    // Code that wraps close() of a handle sees the calls that node makes: on the handle of the wrapped socket in the
    // destroy(), and on the handle of the TLS socket at the 'close' of the wrapped socket.
    test(`${name}: destroy() calls close() on the handle of the wrapped socket, and its 'close' does on the other`, async () => {
      const result = await inData(establish, ({ raw, tlsSocket }, { pair }) => {
        for (const [socketName, socket] of [
          ["raw", raw],
          ["tls", tlsSocket],
        ] as const) {
          const handle = (socket as unknown as { _handle: { close(cb?: unknown): unknown } })._handle;
          const close = handle.close;
          handle.close = function (cb) {
            pair.push(`${socketName} handle close(${typeof cb})`);
            return close.call(this, cb);
          };
        }
        raw.destroy();
        pair.push("destroy() returned");
      });
      assert.deepStrictEqual(result, {
        pair: [
          "tls data ping",
          "raw handle close(function)",
          "destroy() returned",
          "tls handle close(function)",
          "tls close hadError=false",
          "raw close hadError=false",
        ],
        peer: [],
      });
    });

    // TLSWrap keeps its SSL until the 'close' of the wrapped socket destroys the TLS socket.
    test(
      `${name}: the TLS socket answers for its session until the 'close' of the wrapped socket`,
      differs("getCipher(), getProtocol(), getSession() and getPeerCertificate() answer nothing after the destroy()"),
      async () => {
        const session = await establish();
        try {
          for (const socket of [session.raw, session.tlsSocket, session.peer]) socket.on("error", () => {});
          const { tlsSocket } = session;
          const answers = () => ({
            cipher: typeof tlsSocket.getCipher()?.name,
            protocol: tlsSocket.getProtocol(),
            session: !!tlsSocket.getSession(),
            peerCertificate: tlsSocket.getPeerCertificate()?.subject?.CN ?? "none asked for",
          });
          // From a timer: its immediate runs ahead of the close callbacks of that loop turn.
          const seen = await new Promise<object>(resolve => {
            setTimeout(() => {
              session.raw.destroy();
              const afterDestroy = answers();
              setImmediate(() => resolve({ afterDestroy, atImmediate: answers() }));
            }, 1);
          });
          const established = {
            cipher: "string",
            protocol: "TLSv1.3",
            session: true,
            peerCertificate: clientWraps.includes(name) ? "agent1" : "none asked for",
          };
          assert.deepStrictEqual(seen, { afterDestroy: established, atImmediate: established });
        } finally {
          session.close();
        }
      },
    );

    // uv_close() closes the fd, and the kernel keeps sending what it took.
    test(
      `${name}: destroy() closes the fd in the call with a write that the kernel has not taken all of`,
      { skip: process.platform === "win32", ...differs("ciphertext that the kernel refused keeps the fd open") },
      async () => {
        const session = await establish();
        try {
          for (const socket of [session.raw, session.tlsSocket, session.peer]) socket.on("error", () => {});
          session.peer.pause();
          session.tlsSocket.write(big);
          const { fd } = (session.raw as unknown as { _handle: { fd: number } })._handle;
          const before = isOpen(fd);
          session.raw.destroy();
          assert.deepStrictEqual({ before, after: isOpen(fd) }, { before: true, after: false });
        } finally {
          session.close();
        }
      },
    );

    // Bun only: node resets the connection here. A close over input that the kernel still holds is a reset, and a reset
    // drops what the kernel has not sent yet. The TLS socket reported that as written, so the destroy() first takes
    // the input.
    const answer = Buffer.alloc(256 * 1024, "r");
    const afterTheWrite: [string, (tlsSocket: tls.TLSSocket, act: () => void) => void][] = [
      ["in the callback of the write", (tlsSocket, act) => void tlsSocket.write(answer, act)],
      ["in 'finish'", (tlsSocket, act) => void tlsSocket.on("finish", act).end(answer)],
      ["in an immediate after the write", (tlsSocket, act) => (tlsSocket.write(answer), void setImmediate(act))],
    ];
    for (const [when, write] of afterTheWrite) {
      test(
        `${name}, destroy() ${when} with input of the peer unread: the peer still gets the whole write, and an 'end'`,
        { skip: inNode },
        async () => {
          const session = await establish();
          try {
            for (const socket of [session.raw, session.tlsSocket]) socket.on("error", () => {});
            const peer: string[] = [];
            let received = 0;
            session.peer.on("data", data => (received += data.length));
            session.peer.on("end", () => peer.push("end"));
            session.peer.on("error", (err: NodeJS.ErrnoException) => peer.push(`error ${err.code}`));
            const peerClosed = new Promise<void>(resolve => session.peer.on("close", () => resolve()));
            write(session.tlsSocket, () => {
              // It is in the kernel on this side when the destroy() comes.
              session.peer.write("late");
              session.raw.destroy();
            });
            await peerClosed;
            assert.deepStrictEqual({ received, peer }, { received: answer.length, peer: ["end"] });
          } finally {
            session.close();
          }
        },
      );
    }
  }

  // The server side of a handshake that has not completed: a socket injected into a tls.Server hands over no TLS
  // socket yet, and reports the close as 'tlsClientError'.
  type ServerOptions = (raw: net.Socket) => tls.TlsOptions;
  const serverWraps: [
    string,
    (raw: net.Socket, pair: string[], options: tls.TlsOptions) => Promise<void>[],
    string[],
  ][] = [
    [
      "a socket injected into a tls.Server",
      (raw, pair, options) => {
        const hungUp = Promise.withResolvers<void>();
        const tlsServer = tls.createServer({ key, cert, ...options }, () => pair.push("secureConnection"));
        // The 'close' of a TLS socket that the server has not handed over yet.
        tlsServer.on("tlsClientError", (err: NodeJS.ErrnoException) => {
          pair.push(`tlsClientError ${err.code}`);
          hungUp.resolve();
        });
        tlsServer.emit("connection", raw);
        return [hungUp.promise];
      },
      rawCloseFirst("tlsClientError ECONNRESET"),
    ],
    [
      "new TLSSocket(socket, { isServer })",
      (raw, pair, options) => {
        const tlsSocket = new tls.TLSSocket(raw, { isServer: true, key, cert, ...options });
        tlsSocket.on("secure", () => pair.push("tls secure"));
        tlsSocket.on("data", data => pair.push(`tls data ${data}`));
        tlsSocket.on("error", (err: NodeJS.ErrnoException) => pair.push(`tls error ${err.code}`));
        return [
          new Promise<void>(resolve =>
            tlsSocket.on("close", hadError => (pair.push(`tls close hadError=${hadError}`), resolve())),
          ),
        ];
      },
      rawCloseFirst("tls close hadError=false"),
    ],
  ];
  async function destroyedBeforeTheHandshakeCompletes(
    wrap: (typeof serverWraps)[number][1],
    options?: ServerOptions,
    version?: tls.SecureVersion,
  ) {
    const { pair, closed, observe } = ioLog();
    const peer: string[] = [];
    let raw: net.Socket | undefined;
    const server = net.createServer(accepted => {
      raw = accepted;
      observe("raw", accepted);
      closed.push(...wrap(accepted, pair, { minVersion: version, maxVersion: version, ...options?.(accepted) }));
    });
    const client = tls.connect({
      port: await listen(server),
      host: "127.0.0.1",
      servername: "localhost",
      ALPNProtocols: ["x"],
      rejectUnauthorized: false,
    });
    client.on("data", data => peer.push(`data ${data}`));
    client.on("error", (err: NodeJS.ErrnoException) => {
      // After its own 'secureConnect', what the client reports for its write depends on the platform.
      if (process.platform === "linux" || !peer.includes("secureConnect")) peer.push(`error ${err.code}`);
    });
    const clientClosed = new Promise<void>(resolve => client.on("close", () => resolve()));
    client.on("secureConnect", () => {
      peer.push("secureConnect");
      if (!options) raw!.destroy();
      client.write("ping");
    });
    try {
      await clientClosed;
      await Promise.all(closed);
      return { pair, peer };
    } finally {
      client.destroy();
      raw?.destroy();
      server.close();
    }
  }

  const context = () => tls.createSecureContext({ key, cert });
  // Callbacks that run inside the handshake of the server side.
  const insideTheHandshake: [string, ServerOptions][] = [
    ["ALPNCallback", raw => ({ ALPNCallback: () => (raw.destroy(), "x") })],
    ["SNICallback", raw => ({ SNICallback: (_name, cb) => (raw.destroy(), cb(null, context())) })],
    [
      "an asynchronous SNICallback",
      raw => ({ SNICallback: (_name, cb) => void setImmediate(() => (raw.destroy(), cb(null, context()))) }),
    ],
  ];
  const callbackBug = () => Object.assign(new Error("thrown by the callback"), { code: "CALLBACK_BUG" });
  // Callbacks that destroy the wrapped socket and then report an error.
  const reportedByTheCallback: [string, ServerOptions][] = [
    [
      "an SNICallback that throws",
      raw => ({
        SNICallback: () => {
          raw.destroy();
          throw callbackBug();
        },
      }),
    ],
    [
      "an SNICallback that answers with an error",
      raw => ({ SNICallback: (_name, cb) => (raw.destroy(), cb(callbackBug())) }),
    ],
    [
      "an ALPNCallback that throws",
      raw => ({
        ALPNCallback: () => {
          raw.destroy();
          throw callbackBug();
        },
      }),
    ],
  ];

  for (const [name, wrap, pair] of serverWraps) {
    test(`${name}, before the handshake completes: the server side reports no session`, async () => {
      // The FIN reaches a client that has completed its own handshake.
      assert.deepStrictEqual(await destroyedBeforeTheHandshakeCompletes(wrap), { pair, peer: ["secureConnect"] });
    });

    for (const [where, options] of insideTheHandshake) {
      test(`${name}, destroy() in ${where}: nothing more is sent and the handshake fails`, async () => {
        assert.deepStrictEqual(await destroyedBeforeTheHandshakeCompletes(wrap, options), {
          pair,
          peer: ["error ECONNRESET"],
        });
      });
    }

    // Bun only: node aborts in some runs of these. The native layer reports no handshake for a socket that its owner
    // destroyed, so the TLS socket is destroyed with what the callback reported.
    for (const [where, options] of reportedByTheCallback) {
      test(
        `${name}, destroy() in ${where}: the error of the callback is the error of the handshake`,
        { skip: inNode },
        async () => {
          assert.deepStrictEqual(await destroyedBeforeTheHandshakeCompletes(wrap, options), {
            pair: name.startsWith("new")
              ? ["tls error CALLBACK_BUG", "tls close hadError=true", "raw close hadError=false"]
              : ["tlsClientError CALLBACK_BUG", "raw close hadError=false"],
            peer: ["error ECONNRESET"],
          });
        },
      );
    }

    // The Finished of the server is the last message of a full TLS 1.2 handshake. It is not sent either.
    const [event, secure] = name.startsWith("new")
      ? ["secure", "tls secure"]
      : ["secureConnection", "secureConnection"];
    test(`${name}, destroy() in '${event}' of a TLS 1.2 handshake: the peer does not complete it`, async () => {
      const log: string[] = [];
      const closed: Promise<void>[] = [];
      const untilClosed = (socketName: string, socket: net.Socket) =>
        closed.push(
          new Promise<void>(resolve =>
            socket.on("close", hadError => (log.push(`${socketName} close hadError=${hadError}`), resolve())),
          ),
        );
      const onSecure = (raw: net.Socket, tlsSocket: tls.TLSSocket) => {
        log.push(secure);
        tlsSocket.on("error", () => {});
        untilClosed("tls", tlsSocket);
        raw.destroy();
      };
      const options = { key, cert, maxVersion: "TLSv1.2" } as const;
      const server = net.createServer(raw => {
        untilClosed("raw", raw);
        if (event === "secure") {
          const tlsSocket = new tls.TLSSocket(raw, { isServer: true, ...options });
          tlsSocket.on("secure", () => onSecure(raw, tlsSocket));
        } else {
          tls.createServer(options, tlsSocket => onSecure(raw, tlsSocket)).emit("connection", raw);
        }
      });
      const peer: string[] = [];
      const client = tls.connect({ port: await listen(server), host: "127.0.0.1", rejectUnauthorized: false });
      client.on("secureConnect", () => peer.push("secureConnect"));
      client.on("error", (err: NodeJS.ErrnoException) => peer.push(`error ${err.code}`));
      try {
        await new Promise(resolve => client.on("close", resolve));
        await Promise.all(closed);
        assert.deepStrictEqual(
          { log, peer },
          { log: [secure, ...rawCloseFirst("tls close hadError=false")], peer: ["error ECONNRESET"] },
        );
      } finally {
        client.destroy();
        server.close();
      }
    });

    // TLSWrap hears nothing of the destroy(), so what it read with the Finished of the peer still comes out.
    test(
      `${name}, destroy() in '${event}': the data that came with the Finished of the peer is still emitted`,
      differs("input that was read before the destroy() is dropped"),
      async () => {
        const log: string[] = [];
        const closed: Promise<void>[] = [];
        const untilClosed = (socketName: string, socket: net.Socket) =>
          closed.push(
            new Promise<void>(resolve => socket.on("close", () => (log.push(`${socketName} close`), resolve()))),
          );
        const wrapped = Promise.withResolvers<void>();
        const onSecure = (raw: net.Socket, tlsSocket: tls.TLSSocket) => {
          log.push(secure);
          tlsSocket.on("error", () => {});
          tlsSocket.on("data", data => log.push(`tls data ${data}`));
          untilClosed("tls", tlsSocket);
          untilClosed("raw", raw);
          raw.destroy();
          wrapped.resolve();
        };
        const server = net.createServer(raw => {
          raw.on("error", () => {});
          if (event === "secure") {
            const tlsSocket = new tls.TLSSocket(raw, { isServer: true, key, cert });
            tlsSocket.on("secure", () => onSecure(raw, tlsSocket));
          } else {
            const tlsServer = tls.createServer({ key, cert }, tlsSocket => onSecure(raw, tlsSocket));
            tlsServer.on("tlsClientError", () => {});
            tlsServer.emit("connection", raw);
          }
        });
        const client = tls.connect({ port: await listen(server), host: "127.0.0.1", rejectUnauthorized: false });
        client.on("error", () => {});
        // One flight: the write joins the Finished.
        client.on("secureConnect", () => client.write("ping"));
        try {
          await wrapped.promise;
          await Promise.all(closed);
          assert.deepStrictEqual(log, [secure, "tls data ping", "tls close", "raw close"]);
        } finally {
          client.destroy();
          server.close();
        }
      },
    );

    // That data arrives in the read that completes the handshake. Node then cancels the write with the error of a TLS
    // socket that is destroyed, and here it fails as on a destroyed stream. Neither is an 'error'.
    test(`${name}, destroy() in the 'data' that came with the Finished of the peer: a write from an immediate fails with no 'error'`, async () => {
      const log: string[] = [];
      const closed: Promise<void>[] = [];
      const untilClosed = (socketName: string, socket: net.Socket) =>
        closed.push(
          new Promise<void>(resolve =>
            socket.on("close", hadError => (log.push(`${socketName} close hadError=${hadError}`), resolve())),
          ),
        );
      const wrote = Promise.withResolvers<boolean>();
      const onSecure = (raw: net.Socket, tlsSocket: tls.TLSSocket) => {
        tlsSocket.on("error", (err: NodeJS.ErrnoException) => log.push(`tls error ${err.code}`));
        untilClosed("tls", tlsSocket);
        tlsSocket.once("data", data => {
          log.push(`tls data ${data}`);
          raw.destroy();
          setImmediate(() => log.push(`write() returned ${tlsSocket.write("pong", err => wrote.resolve(!!err))}`));
        });
      };
      const server = net.createServer(raw => {
        untilClosed("raw", raw);
        if (event === "secure") {
          const tlsSocket = new tls.TLSSocket(raw, { isServer: true, key, cert });
          onSecure(raw, tlsSocket);
        } else {
          tls.createServer({ key, cert }, tlsSocket => onSecure(raw, tlsSocket)).emit("connection", raw);
        }
      });
      const client = tls.connect({ port: await listen(server), host: "127.0.0.1", rejectUnauthorized: false });
      client.on("error", () => {});
      // One flight: the write joins the Finished.
      client.on("secureConnect", () => client.write("ping"));
      try {
        const failed = await wrote.promise;
        await Promise.all(closed);
        assert.deepStrictEqual(
          { log, failed },
          {
            log: ["tls data ping", "write() returned true", ...rawCloseFirst("tls close hadError=false")],
            failed: true,
          },
        );
      } finally {
        client.destroy();
        server.close();
      }
    });
  }

  for (const [name, wrap] of wraps) {
    // `early` is written to a TLS socket that has taken the fd over.
    for (const when of ["before", "after"]) {
      test(`${name}: a write made ${when} the destroy() waits for the handshake and is cancelled with no 'error'`, async () => {
        const { pair, closed, observe, written } = ioLog();
        // It never answers the handshake.
        const server = net.createServer(peer => peer.on("error", () => {}).resume());
        const raw = net.connect(await listen(server), "127.0.0.1");
        try {
          await once(raw, "connect");
          observe("raw", raw);
          const tlsSocket = wrap(raw);
          observe("tls", tlsSocket);
          const write = () => {
            tlsSocket.write("early", written("tls write"));
            tlsSocket.write("tail", written("tls queued write"));
          };
          setImmediate(() => {
            if (when === "before") write();
            raw.destroy();
            if (when === "after") write();
          });
          await Promise.all(closed);
          assert.deepStrictEqual(
            { pair, bytesWritten: tlsSocket.bytesWritten },
            {
              pair: rawCloseFirst(
                "tls write: write ECANCELED Canceled because of SSL destruction",
                "tls queued write: write ECANCELED Canceled because of SSL destruction",
                "tls close hadError=false",
              ),
              // Bun does not count a write that it never handed to the TLS engine.
              bytesWritten: when === "after" && typeof Bun !== "undefined" ? 0 : "early".length,
            },
          );
        } finally {
          raw.destroy();
          server.close();
        }
      });
    }

    // Bun only: node takes resetAndDestroy() from a socket over a TCP handle alone.
    for (const verb of ["destroy", "resetAndDestroy"] as const) {
      test(
        `${name}: ${verb}() of the TLS socket after the destroy() cancels a write that waits for the handshake`,
        { skip: verb === "resetAndDestroy" && typeof Bun === "undefined" },
        async () => {
          const { pair, closed, observe, written } = ioLog();
          const server = net.createServer(peer => peer.on("error", () => {}).resume());
          const raw = net.connect(await listen(server), "127.0.0.1");
          try {
            await once(raw, "connect");
            observe("raw", raw);
            const tlsSocket = wrap(raw);
            observe("tls", tlsSocket);
            setImmediate(() => {
              tlsSocket.write("early", written("tls write"));
              tlsSocket.write("tail", written("tls queued write"));
              raw.destroy();
              tlsSocket[verb]();
              pair.push(`tls ${verb}() returned`);
            });
            await Promise.all(closed);
            assert.deepStrictEqual(pair, [
              "tls write: write ECANCELED Canceled because of SSL destruction",
              "tls queued write: write ECANCELED Canceled because of SSL destruction",
              ...closeInTheCall(`tls ${verb}() returned`),
              "raw close hadError=false",
            ]);
          } finally {
            raw.destroy();
            server.close();
          }
        },
      );
    }
  }

  // The close of the TLS socket waits for the callback of the handshake that it runs under, and the destroy() of the
  // wrapped socket takes the connection from it. The write that waits for the handshake is still cancelled.
  for (const where of ["SNICallback", "ALPNCallback"] as const) {
    for (const verb of ["destroy", "resetAndDestroy"] as const) {
      test(`new TLSSocket(socket, { isServer }): destroy() of the TLS socket, then ${verb}(), in ${where} cancel a write that waits for the handshake`, async () => {
        const log: string[] = [];
        const closed: Promise<void>[] = [];
        const untilClosed = (socket: net.Socket) =>
          closed.push(new Promise<void>(resolve => socket.on("error", () => {}).on("close", () => resolve())));
        const server = net.createServer(raw => {
          const act = () => (tlsSocket.destroy(), raw[verb]());
          const tlsSocket: tls.TLSSocket = new tls.TLSSocket(raw, {
            isServer: true,
            key,
            cert,
            ...(where === "SNICallback"
              ? { SNICallback: (_name, cb) => (act(), cb(null, tls.createSecureContext({ key, cert }))) }
              : { ALPNCallback: ({ protocols }) => (act(), protocols[0]) }),
          });
          untilClosed(raw);
          untilClosed(tlsSocket);
          tlsSocket.write("early", err => log.push(`tls write: ${err ? err.message : "ok"}`));
        });
        const peer = tls.connect({
          port: await listen(server),
          host: "127.0.0.1",
          servername: "localhost",
          ALPNProtocols: ["x"],
          rejectUnauthorized: false,
        });
        untilClosed(peer);
        try {
          for (let seen = 0; seen < closed.length;) await closed[seen++];
          // Past a callback that is still queued.
          await new Promise(resolve => setImmediate(resolve));
          assert.deepStrictEqual(log, ["tls write: write ECANCELED Canceled because of SSL destruction"]);
        } finally {
          peer.destroy();
          server.close();
        }
      });
    }
  }

  // The peer speaks no TLS, and the owner destroys both sockets in the report of that, as socks-proxy-agent does.
  // TLSWrap.close() completes at once over a handle that its owner closed, so the 'close' of the TLS socket comes ahead
  // of an immediate that the report makes.
  describe("destroy() in the report of a handshake that failed", () => {
    type Report = (tlsSocket: tls.TLSSocket) => void;
    const reports: [string, (raw: net.Socket, onReport: Report) => void][] = [
      [
        "a socket injected into a tls.Server, in 'tlsClientError'",
        (raw, onReport) => {
          const tlsServer = tls.createServer({ key, cert });
          tlsServer.on("tlsClientError", (_err, tlsSocket: tls.TLSSocket) => onReport(tlsSocket));
          tlsServer.emit("connection", raw);
        },
      ],
      [
        "new TLSSocket(socket, { isServer }), in 'error'",
        (raw, onReport) => {
          const tlsSocket = new tls.TLSSocket(raw, { isServer: true, key, cert });
          tlsSocket.on("error", () => onReport(tlsSocket));
        },
      ],
    ];
    for (const [name, wrap] of reports) {
      test(name, async () => {
        const log: string[] = [];
        const closed: Promise<void>[] = [];
        const server = net.createServer(raw => {
          closed.push(
            new Promise<void>(resolve =>
              raw
                .on("error", () => {})
                .on("close", hadError => (log.push(`raw close hadError=${hadError}`), resolve())),
            ),
          );
          wrap(raw, tlsSocket => {
            log.push("report");
            closed.push(
              new Promise<void>(resolve =>
                tlsSocket.on("close", hadError => (log.push(`tls close hadError=${hadError}`), resolve())),
              ),
              new Promise<void>(resolve => setImmediate(() => (log.push("immediate"), resolve()))),
            );
            raw.destroy();
            tlsSocket.destroy();
          });
        });
        const peer = net.connect(await listen(server), "127.0.0.1");
        peer.on("error", () => {});
        try {
          peer.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
          await once(peer, "close");
          for (let seen = 0; seen < closed.length;) await closed[seen++];
          assert.deepStrictEqual(log, ["report", "tls close hadError=true", "immediate", "raw close hadError=false"]);
        } finally {
          peer.destroy();
          server.close();
        }
      });
    }
  });

  test("tls.connect({ socket }), destroy() in 'secureConnect' of a TLS 1.3 handshake: the peer does not complete it", async () => {
    const peerLog: string[] = [];
    const server = tls.createServer({ key, cert }, () => peerLog.push("secureConnection"));
    const peerClosed = new Promise<void>(resolve =>
      server.on(
        "tlsClientError",
        (err: NodeJS.ErrnoException) => (peerLog.push(`tlsClientError ${err.code}`), resolve()),
      ),
    );
    const raw = net.connect(await listen(server), "127.0.0.1");
    try {
      await once(raw, "connect");
      const log: string[] = [];
      // Ahead of the listener that the wrap adds.
      const rawClosed = new Promise<void>(resolve =>
        raw.on("close", hadError => (log.push(`raw close hadError=${hadError}`), resolve())),
      );
      const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false, minVersion: "TLSv1.3" });
      tlsSocket.on("error", (err: NodeJS.ErrnoException) => log.push(`tls error ${err.code}`));
      const tlsClosed = new Promise<void>(resolve =>
        tlsSocket.on("close", hadError => (log.push(`tls close hadError=${hadError}`), resolve())),
      );
      tlsSocket.on("secureConnect", () => (log.push("secureConnect"), raw.destroy()));
      await Promise.all([rawClosed, tlsClosed, peerClosed]);
      assert.deepStrictEqual(
        { log, peer: peerLog },
        {
          log: ["secureConnect", ...rawCloseFirst("tls close hadError=false")],
          peer: ["tlsClientError ECONNRESET"],
        },
      );
    } finally {
      raw.destroy();
      server.close();
    }
  });

  // The write in flight on the socket in the middle is a record of the TLS socket above it.
  test("a TLS socket over tls.connect({ socket }) with a write in flight: the socket in the middle reports no error", async () => {
    const server = tls.createServer({ key, cert }, middlePeer => {
      middlePeer.on("error", () => {});
      const topPeer = new tls.TLSSocket(middlePeer, { isServer: true, key, cert });
      topPeer.on("error", () => {});
      // It reads nothing after that, so the kernel does not take all of `big`.
      topPeer.on("secure", () => topPeer.write("ping", () => middlePeer.pause()));
    });
    server.on("tlsClientError", () => {});
    const raw = net.connect(await listen(server), "127.0.0.1");
    try {
      await once(raw, "connect");
      const middle = tls.connect({ socket: raw, rejectUnauthorized: false });
      await once(middle, "secureConnect");
      const top = tls.connect({ socket: middle, rejectUnauthorized: false });
      const log: string[] = [];
      middle.on("error", (err: NodeJS.ErrnoException) => log.push(`middle error ${err.code}`));
      top.on("error", () => {});
      const closed = [raw, middle].map(socket => new Promise<void>(resolve => socket.on("close", () => resolve())));
      middle.on("close", hadError => log.push(`middle close hadError=${hadError}`));
      top.once("data", () => {
        top.write(big);
        // The write is in flight on the socket in the middle.
        setImmediate(() => raw.destroy());
      });
      await Promise.all(closed);
      // Past an 'error' that is still queued.
      for (let turn = 0; turn < 2; turn++) await new Promise(resolve => setImmediate(resolve));
      assert.deepStrictEqual(log, ["middle close hadError=false"]);
    } finally {
      raw.destroy();
      server.close();
    }
  });

  test("an http2 server session over a socket injected into a tls.Server reports no error for its answer", async () => {
    const log: string[] = [];
    const h2 = http2.createServer();
    h2.on("sessionError", (err: NodeJS.ErrnoException) => log.push(`sessionError ${err.code}`));
    const tlsClosed = Promise.withResolvers<void>();
    let raw: net.Socket | undefined;
    const tlsServer = tls.createServer({ key, cert, ALPNProtocols: ["h2"] }, tlsSocket => {
      tlsSocket.on("error", (err: NodeJS.ErrnoException) => log.push(`tls error ${err.code}`));
      tlsSocket.on("close", hadError => (log.push(`tls close hadError=${hadError}`), tlsClosed.resolve()));
      h2.emit("connection", tlsSocket);
    });
    h2.on("stream", stream => {
      stream.on("error", (err: NodeJS.ErrnoException) => log.push(`stream error ${err.code}`));
      raw!.destroy();
      stream.respond({ ":status": 200 });
      stream.end("answer");
    });
    const server = net.createServer(accepted => tlsServer.emit("connection", (raw = accepted)));
    const client = http2.connect(`https://127.0.0.1:${await listen(server)}`, { rejectUnauthorized: false });
    try {
      client.on("error", () => {});
      const request = client.request({ ":path": "/" });
      request.on("response", () => log.push("client response"));
      request.on("error", () => {});
      request.end();
      await Promise.all([once(client, "close"), tlsClosed.promise]);
      assert.deepStrictEqual(log, ["tls close hadError=false"]);
    } finally {
      client.destroy();
      raw?.destroy();
      server.close();
    }
  });

  // The session reported the answer as written, so it still leaves with the close.
  test("an http2 server session over a socket injected into a tls.Server delivers an answer whose end() callback destroys the socket", async () => {
    const h2 = http2.createServer();
    h2.on("sessionError", () => {});
    let raw: net.Socket | undefined;
    const tlsServer = tls.createServer({ key, cert, ALPNProtocols: ["h2"] }, tlsSocket => {
      tlsSocket.on("error", () => {});
      h2.emit("connection", tlsSocket);
    });
    h2.on("stream", stream => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.end("answer", () => raw!.destroy());
    });
    const server = net.createServer(accepted => tlsServer.emit("connection", (raw = accepted)));
    const client = http2.connect(`https://127.0.0.1:${await listen(server)}`, { rejectUnauthorized: false });
    try {
      client.on("error", () => {});
      const request = client.request({ ":path": "/" });
      let status: unknown;
      let body = "";
      request.on("response", headers => (status = headers[":status"]));
      request.on("data", chunk => (body += chunk));
      request.on("error", () => {});
      request.end();
      await once(client, "close");
      assert.deepStrictEqual({ status, body }, { status: 200, body: "answer" });
    } finally {
      client.destroy();
      raw?.destroy();
      server.close();
    }
  });

  // A session is connecting until it is ready, and reports a socket that closes before that.
  for (const verb of ["destroy", "resetAndDestroy"] as const) {
    test(`an http2 client session over tls.connect({ socket }): ${verb}() before the session has connected is its 'error'`, async () => {
      // It never answers the handshake.
      const server = net.createServer(peer => peer.on("error", () => {}).resume());
      const port = await listen(server);
      const raw = net.connect(port, "127.0.0.1");
      try {
        raw.on("error", () => {});
        await once(raw, "connect");
        const createConnection = () => tls.connect({ socket: raw, ALPNProtocols: ["h2"], rejectUnauthorized: false });
        const session = http2.connect(`https://127.0.0.1:${port}`, { createConnection });
        const log: string[] = [];
        session.on("connect", () => log.push("connect"));
        session.on("error", (err: NodeJS.ErrnoException) => log.push(`error ${err.code}`));
        const closed = new Promise<void>(resolve => session.on("close", () => resolve()));
        setImmediate(() => raw[verb]());
        await closed;
        assert.deepStrictEqual(log, ["error ERR_SOCKET_CLOSED"]);
      } finally {
        raw.destroy();
        server.close();
      }
    });
  }

  describe("node:http over a socket injected into a tls.Server, whose owner destroys it in a request handler", () => {
    type Handler = (raw: net.Socket, req: http.IncomingMessage, res: http.ServerResponse, log: string[]) => void;
    // Serves `requests` requests of one client over one connection, each with `handlers[n] ?? handlers[0]`.
    async function serve(handlers: Handler[], requests = 1) {
      const log: string[] = [];
      let raw: net.Socket | undefined;
      let count = 0;
      const tlsClosed = Promise.withResolvers<void>();
      const httpServer = http.createServer((req, res) => {
        const nth = ++count;
        req.on("aborted", () => log.push(`req${nth} aborted`));
        res.on("finish", () => log.push(`res${nth} finish`));
        res.on("close", () => log.push(`res${nth} close finished=${res.writableFinished}`));
        (handlers[nth - 1] ?? handlers[0])(raw!, req, res, log);
      });
      httpServer.on("clientError", (err: NodeJS.ErrnoException, socket) => {
        log.push(`clientError ${err.code}`);
        socket.destroy();
      });
      const tlsServer = tls.createServer({ key, cert }, tlsSocket => {
        tlsSocket.on("close", hadError => (log.push(`tls close hadError=${hadError}`), tlsClosed.resolve()));
        httpServer.emit("connection", tlsSocket);
      });
      const front = net.createServer(accepted => tlsServer.emit("connection", (raw = accepted)));
      const port = await listen(front);
      const agent = new https.Agent({ keepAlive: requests > 1, maxSockets: 1 });
      const client: string[] = [];
      try {
        for (let nth = 1; nth <= requests; nth++) {
          const req = https.request({ port, host: "127.0.0.1", rejectUnauthorized: false, agent });
          req.on("response", res => {
            let length = 0;
            res.on("data", chunk => (length += chunk.length));
            res.on("end", () => client.push(`response ${res.statusCode} ${length}`));
          });
          req.on("error", (err: NodeJS.ErrnoException) => client.push(`error ${err.code}`));
          req.end();
          await new Promise(resolve => req.on("close", resolve));
        }
        await tlsClosed.promise;
        // Past an 'error' that is still queued.
        await new Promise(resolve => setImmediate(resolve));
        return { log, client };
      } finally {
        agent.destroy();
        raw?.destroy();
        front.close();
      }
    }
    // The events of the request and of the response for a failed answer differ between the versions of node.
    const ofTheSocket = ({ log, client }: { log: string[]; client: string[] }) => ({
      log: log.filter(line => !/^re[qs]\d /.test(line)),
      client,
    });

    test("an answer in the call fails as on a handle that closes: 'clientError'", async () => {
      const result = await serve([(raw, _req, res) => (raw.destroy(), res.end("answer"))]);
      // Node reports the 'error' of the socket as 'clientError'.
      const log = ["tls close hadError=true", `clientError ${closingHandle}`];
      assert.deepStrictEqual(ofTheSocket(result), {
        log: inNode ? log : log.reverse(),
        client: ["error ECONNRESET"],
      });
    });

    // Node ignores what a socket reports after its first 'clientError': here the 'error' of the answer.
    test("a 'clientError' listener that destroys the wrapped socket and then answers runs once", async () => {
      const errors: string[] = [];
      let raw: net.Socket | undefined;
      const httpServer = http.createServer((_req, res) => void res.end("ok"));
      httpServer.on("clientError", (err: NodeJS.ErrnoException, socket) => {
        errors.push(String(err.code));
        raw!.destroy();
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      });
      const tlsClosed = Promise.withResolvers<void>();
      const tlsServer = tls.createServer({ key, cert }, tlsSocket => {
        tlsSocket.on("close", () => tlsClosed.resolve());
        httpServer.emit("connection", tlsSocket);
      });
      const front = net.createServer(accepted => tlsServer.emit("connection", (raw = accepted)));
      const client = tls.connect({ port: await listen(front), host: "127.0.0.1", rejectUnauthorized: false });
      try {
        client.on("error", () => {});
        await once(client, "secureConnect");
        client.write("GARBAGE\r\n\r\n");
        await Promise.all([once(client, "close"), tlsClosed.promise]);
        // Past an 'error' that is still queued.
        await new Promise(resolve => setImmediate(resolve));
        assert.deepStrictEqual(errors, ["HPE_INVALID_METHOD"]);
      } finally {
        client.destroy();
        raw?.destroy();
        front.close();
      }
    });

    // The TLS socket took the answer ahead of the destroy(), so it still leaves with the close. Node's http hands the
    // head and the body to the handle in one write.
    const body = Buffer.alloc(64 * 1024, "a");
    const answersFirst: [string, Handler][] = [
      ["end(body)", (raw, _req, res) => (res.end(body), raw.destroy())],
      ["write(body), then end()", (raw, _req, res) => (res.write(body), res.end(), raw.destroy())],
    ];
    for (const [name, handler] of answersFirst) {
      test(`an answer ahead of the destroy() still leaves: ${name}`, async () => {
        const result = await serve([handler]);
        assert.deepStrictEqual(ofTheSocket(result), {
          log: ["tls close hadError=false"],
          client: [`response 200 ${body.length}`],
        });
      });
    }

    // What mockttp does to reset a connection.
    test(
      "resetAndDestroy(), then destroy() of the TLS socket: the request is aborted in the call",
      differs("the 'close' of the TLS socket comes with the 'close' of the wrapped socket"),
      async () => {
        const result = await serve([
          (raw, req, res, log) => {
            raw.resetAndDestroy();
            req.socket.destroy();
            log.push("the handler returns");
            res.end("answer");
          },
        ]);
        assert.deepStrictEqual(result, {
          log: ["tls close hadError=false", "req1 aborted", "res1 close finished=false", "the handler returns"],
          client: ["error ECONNRESET"],
        });
      },
    );
  });

  test("a write callback that throws when its write is cancelled does not stop the close", async () => {
    const log = await logOfChild(`
      process.on("uncaughtException", err => log.push("uncaught: " + err.message));
      const server = tls.createServer({ key, cert }, peer => {
        peer.on("error", () => {}).pause();
        peer.write("ping");
      });
      server.listen(0, "127.0.0.1", () => {
        const raw = net.connect(server.address().port, "127.0.0.1", () => {
          const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
          tlsSocket.on("error", err => log.push("tls error " + err.code));
          tlsSocket.on("close", hadError => log.push("tls close hadError=" + hadError));
          raw.on("close", () => (log.push("raw close"), process.exit(0)));
          tlsSocket.once("data", () => {
            // The peer reads nothing, so the kernel does not take all of it.
            tlsSocket.write(Buffer.alloc(16 * 1024 * 1024, "a"), () => {
              throw new Error("thrown by the write callback");
            });
            raw.destroy();
          });
        });
      });
    `);
    assert.deepStrictEqual(log, ["uncaught: thrown by the write callback", "tls close hadError=false", "raw close"]);
  });

  // TLSWrap cancels a write that waits for the handshake inside the destroy() of the TLS socket, which reports what the
  // callback throws as its 'error', and emits no 'close' after it.
  test("a write callback that throws when a write that waits for the handshake is cancelled: the TLS socket reports it", async () => {
    const log = await logOfChild(`
      process.on("uncaughtException", err => log.push("uncaught: " + err.message));
      // It never answers the handshake.
      const server = net.createServer(peer => peer.on("error", () => {}).resume());
      server.listen(0, "127.0.0.1", async () => {
        for (const alsoTheTLSSocket of [false, true]) {
          await new Promise(done => {
            const raw = net.connect(server.address().port, "127.0.0.1", () => {
              const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
              tlsSocket.on("error", err => log.push("tls error " + err.message));
              tlsSocket.on("close", () => log.push("tls close"));
              raw.on("close", () => (log.push("raw close"), setImmediate(done)));
              setImmediate(() => {
                tlsSocket.write("early", () => {
                  throw new Error("thrown by the write callback");
                });
                raw.destroy();
                if (alsoTheTLSSocket) tlsSocket.destroy();
              });
            });
          });
        }
        server.close();
      });
    `);
    // Node destroys the TLS socket in its listener for the 'close', and Bun a tick ahead of that 'close'.
    const each = ["tls error thrown by the write callback", "raw close"];
    assert.deepStrictEqual(log, typeof Bun === "undefined" ? [...each.toReversed(), ...each] : [...each, ...each]);
  });

  // A caller that passes a callback to write() and has no 'error' listener. An 'error' here would end the process.
  test("a write from a timer after the destroy(), with no 'error' listener on either socket", async () => {
    const log = await logOfChild(`
      const server = tls.createServer({ key, cert }, peer => {
        peer.on("error", () => {});
        peer.write("ping");
      });
      server.listen(0, "127.0.0.1", () => {
        const raw = net.connect(server.address().port, "127.0.0.1", () => {
          const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
          tlsSocket.once("data", () => {
            raw.destroy();
            setTimeout(() => {
              tlsSocket.write("pong", err => (log.push("write: " + (err ? err.message : "ok")), server.close()));
            }, 1);
          });
        });
      });
    `);
    assert.deepStrictEqual(log, ["write: Cannot call write after a stream was destroyed"]);
  });

  // Bun only: node fails this write when it is made, with an 'error'. Here it fails when the TLS socket is destroyed.
  test(
    "a callback that throws for a write that is made after the tick of the destroy() does not stop the close",
    { skip: typeof Bun === "undefined" },
    async () => {
      const log = await logOfChild(`
        process.on("uncaughtException", err => log.push("uncaught: " + err.code));
        const server = tls.createServer({ key, cert }, peer => {
          peer.on("error", () => {});
          peer.write("ping");
        });
        server.listen(0, "127.0.0.1", () => {
          const raw = net.connect(server.address().port, "127.0.0.1", () => {
            const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
            tlsSocket.on("close", hadError => log.push("tls close hadError=" + hadError));
            raw.on("close", () => (log.push("raw close"), server.close()));
            tlsSocket.once("data", () => {
              raw.destroy();
              setImmediate(() => {
                tlsSocket.write("pong", err => {
                  if (err) throw err;
                });
              });
            });
          });
        });
      `);
      assert.deepStrictEqual(log, ["uncaught: ERR_STREAM_DESTROYED", "tls close hadError=false", "raw close"]);
    },
  );

  // Bun only: node leaves a TLS socket open when its listener for the 'close' of the wrapped socket does not run.
  for (const [name, establish] of sessions) {
    test(
      `${name}: the TLS socket closes when its listener for the 'close' is gone`,
      { skip: typeof Bun === "undefined" },
      async () => {
        const session = await establish();
        try {
          for (const socket of [session.raw, session.tlsSocket, session.peer]) socket.on("error", () => {});
          session.raw.removeAllListeners("close");
          session.raw.destroy();
          const [hadError] = await once(session.tlsSocket, "close");
          assert.strictEqual(hadError, false);
        } finally {
          session.close();
        }
      },
    );
  }
  test(
    "the TLS socket closes when a 'close' listener of the wrapped socket throws ahead of its own",
    { skip: typeof Bun === "undefined" },
    async () => {
      const log = await logOfChild(`
        process.on("uncaughtException", err => log.push("uncaught: " + err.message));
        const server = tls.createServer({ key, cert }, peer => {
          peer.on("error", () => {});
          peer.write("ping");
        });
        server.listen(0, "127.0.0.1", () => {
          const raw = net.connect(server.address().port, "127.0.0.1", () => {
            raw.on("close", () => {
              throw new Error("thrown by a 'close' listener");
            });
            const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
            tlsSocket.on("close", hadError => (log.push("tls close hadError=" + hadError), server.close()));
            tlsSocket.once("data", () => raw.destroy());
          });
        });
      `);
      assert.deepStrictEqual(log, ["tls close hadError=false", "uncaught: thrown by a 'close' listener"]);
    },
  );

  // Node reports what a 'close' listener of the TLS socket throws as the 'error' of that socket.
  test("what a 'close' listener of the TLS socket throws does not keep the 'close' from the wrapped socket", async () => {
    const log = await logOfChild(`
      process.on("uncaughtException", err => log.push("reported: " + err.message));
      const server = tls.createServer({ key, cert }, peer => {
        peer.on("error", () => {});
        peer.write("ping");
      });
      server.listen(0, "127.0.0.1", () => {
        const raw = net.connect(server.address().port, "127.0.0.1", () => {
          raw.on("close", () => log.push("raw close, added before the wrap"));
          const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
          tlsSocket.on("error", err => log.push("reported: " + err.message));
          tlsSocket.on("close", () => {
            throw new Error("thrown by a 'close' listener");
          });
          raw.on("close", () => (log.push("raw close, added after the wrap"), setImmediate(() => server.close())));
          tlsSocket.once("data", () => raw.destroy());
        });
      });
    `);
    assert.deepStrictEqual(log.sort(), [
      "raw close, added after the wrap",
      "raw close, added before the wrap",
      "reported: thrown by a 'close' listener",
    ]);
  });

  // Bun only: in node a TLS socket that is dialed again has no TLS.
  for (const verb of ["destroy", "resetAndDestroy"] as const) {
    test(
      `new TLSSocket(socket): the TLS socket is dialed again after the destroy(), and its ${verb}() closes that connection`,
      { skip: typeof Bun === "undefined" },
      async () => {
        const peers: tls.TLSSocket[] = [];
        const accepted = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
        const peerClosed = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
        const server = tls.createServer({ key, cert }, peer => {
          const nth = peers.push(peer) - 1;
          peer.on("error", () => {}).resume();
          peer.on("close", () => peerClosed[nth].resolve());
          accepted[nth].resolve();
        });
        const port = await listen(server);
        const raw = net.connect(port, "127.0.0.1");
        const tlsSocket = new tls.TLSSocket(raw, { rejectUnauthorized: false });
        try {
          tlsSocket.on("error", () => {});
          await accepted[0].promise;
          raw.destroy();
          await Promise.all([once(tlsSocket, "close"), peerClosed[0].promise]);
          tlsSocket.connect({ port, host: "127.0.0.1" });
          await accepted[1].promise;
          const { fd } = (tlsSocket as unknown as { _handle: { fd: number } })._handle;
          const before = process.platform === "win32" || isOpen(fd);
          tlsSocket[verb]();
          assert.deepStrictEqual({ before, after: isOpen(fd) }, { before: true, after: false });
          await peerClosed[1].promise;
        } finally {
          for (const peer of peers) peer.destroy();
          raw.destroy();
          tlsSocket.destroy();
          server.close();
        }
      },
    );
  }

  // Bun only: node has no connect() that gives a TLS socket another socket to wrap.
  test(
    "tls.connect({ socket }): the TLS socket wraps another socket, and destroy() of the first one leaves that session open",
    { skip: typeof Bun === "undefined" },
    async () => {
      const server = tls.createServer({ key, cert }, peer => {
        peer.on("error", () => {});
        peer.on("data", data => peer.write(`echo ${data}`));
      });
      const port = await listen(server);
      const [first, second] = [net.connect(port, "127.0.0.1"), net.connect(port, "127.0.0.1")];
      try {
        await Promise.all([once(first, "connect"), once(second, "connect")]);
        const tlsSocket = tls.connect({ socket: first, rejectUnauthorized: false });
        tlsSocket.on("error", () => {});
        await once(tlsSocket, "secureConnect");
        tlsSocket.connect({ socket: second, rejectUnauthorized: false } as unknown as net.SocketConnectOpts);
        await once(tlsSocket, "secureConnect");
        first.destroy();
        await once(first, "close");
        const state = { tls: tlsSocket.destroyed, second: second.destroyed };
        let answer: unknown;
        if (!tlsSocket.destroyed) {
          tlsSocket.write("over the second socket");
          [answer] = await once(tlsSocket, "data");
        }
        assert.deepStrictEqual(
          { ...state, answer: String(answer) },
          { tls: false, second: false, answer: "echo over the second socket" },
        );
      } finally {
        first.destroy();
        second.destroy();
        server.close();
      }
    },
  );

  // Bun only, as the row above. Each destroy() of the TLS socket owes a 'close' of its own.
  test(
    "tls.connect({ socket }): a TLS socket that gives up two connections in one tick emits a 'close' for each",
    { skip: typeof Bun === "undefined" },
    async () => {
      const server = tls.createServer({ key, cert }, peer => peer.on("error", () => {}).resume());
      server.on("tlsClientError", () => {});
      const port = await listen(server);
      const [first, second] = [net.connect(port, "127.0.0.1"), net.connect(port, "127.0.0.1")];
      try {
        for (const socket of [first, second]) socket.on("error", () => {});
        await Promise.all([once(first, "connect"), once(second, "connect")]);
        const tlsSocket = tls.connect({ socket: first, rejectUnauthorized: false });
        tlsSocket.on("error", () => {});
        await once(tlsSocket, "secureConnect");
        await new Promise(resolve => setImmediate(resolve));
        let closes = 0;
        tlsSocket.on("close", () => closes++);
        const closed = Promise.all([once(first, "close"), once(second, "close")]);
        first.destroy();
        tlsSocket.destroy();
        tlsSocket.connect({ socket: second, rejectUnauthorized: false } as unknown as net.SocketConnectOpts);
        second.destroy();
        tlsSocket.destroy();
        await closed;
        // Past a 'close' that is still queued.
        for (let turn = 0; turn < 2; turn++) await new Promise(resolve => setImmediate(resolve));
        assert.strictEqual(closes, 2);
      } finally {
        first.destroy();
        second.destroy();
        server.close();
      }
    },
  );

  // Bun only: node has no connect() that wraps the socket again.
  test(
    "tls.connect({ socket }): the pair is connected again, and destroy() of the TLS socket closes it as it closes a new pair",
    { skip: typeof Bun === "undefined" },
    async () => {
      const server = tls.createServer({ key, cert }, peer => peer.on("error", () => {}).resume());
      const port = await listen(server);
      const raw = net.connect(port, "127.0.0.1");
      try {
        await once(raw, "connect");
        const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
        tlsSocket.on("error", () => {});
        await once(tlsSocket, "secureConnect");
        raw.destroy();
        await once(tlsSocket, "close");
        await once(raw.connect(port, "127.0.0.1"), "connect");
        tlsSocket.connect({ port, host: "127.0.0.1" });
        await once(tlsSocket, "secureConnect");
        const log: string[] = [];
        const closed = [
          new Promise<void>(resolve => raw.on("close", () => (log.push("raw close"), resolve()))),
          new Promise<void>(resolve =>
            tlsSocket.on("close", hadError => (log.push(`tls close hadError=${hadError}`), resolve())),
          ),
        ];
        tlsSocket.destroy();
        log.push("tls destroy() returned");
        await Promise.all(closed);
        assert.deepStrictEqual(log, ["tls destroy() returned", "raw close", "tls close hadError=false"]);
      } finally {
        raw.destroy();
        server.close();
      }
    },
  );

  // The 'close' that a destroy() owes is the one of the connection that was destroyed. It closes no session that is
  // made over the next connection of that socket.
  for (const verb of ["destroy", "resetAndDestroy"] as const) {
    for (const when of ["process.nextTick", "setImmediate"] as const) {
      test(`tls.connect({ socket }): after ${verb}() the wrapped socket is dialed again from ${when} and wrapped again, and that session is used`, async () => {
        const server = tls.createServer({ key, cert }, peer => {
          peer.on("error", () => {});
          peer.on("data", data => peer.write(`echo ${data}`));
        });
        const port = await listen(server);
        const raw = net.connect(port, "127.0.0.1");
        try {
          raw.on("error", () => {});
          await once(raw, "connect");
          const first = tls.connect({ socket: raw, rejectUnauthorized: false });
          first.on("error", () => {});
          await once(first, "secureConnect");
          first.write("one");
          await once(first, "data");
          const log: string[] = [];
          const closed = Promise.withResolvers<void>();
          raw[verb]();
          (when === "setImmediate" ? setImmediate : process.nextTick)(() => {
            raw.connect(port, "127.0.0.1", () => {
              const second = tls.connect({ socket: raw, rejectUnauthorized: false }, () => {
                log.push("second secureConnect");
                second.write("two");
              });
              second.on("error", (err: NodeJS.ErrnoException) => log.push(`second error ${err.code}`));
              second.on("data", data => (log.push(`second data ${data}`), second.destroy()));
              second.on("close", () => (log.push("second close"), closed.resolve()));
            });
          });
          await closed.promise;
          assert.deepStrictEqual(log, ["second secureConnect", "second data echo two", "second close"]);
        } finally {
          raw.destroy();
          server.close();
        }
      });
    }

    // What a client that connects again at 'close' does. The destroy() comes before the handshake has completed, as a
    // timeout of that handshake does.
    test(`tls.connect({ socket }): after ${verb}() in the handshake the wrapped socket is dialed again in its 'close' listener, which was added before the wrap`, async () => {
      const log: string[] = [];
      const done = Promise.withResolvers<void>();
      let connections = 0;
      const server = net.createServer(peer => {
        peer.on("error", () => {});
        // The first connection gets no answer to its ClientHello.
        if (++connections === 1) return void peer.resume();
        peer.on("data", data => peer.write(`echo ${data}`));
      });
      const port = await listen(server);
      const raw = net.connect(port, "127.0.0.1");
      try {
        raw.on("error", (err: NodeJS.ErrnoException) => log.push(`raw error ${err.code}`));
        await once(raw, "connect");
        raw.once("close", () => {
          log.push("raw close");
          raw.connect(port, "127.0.0.1", () => {
            log.push("raw connect");
            raw.write("hello");
          });
          raw.on("data", data => (log.push(`raw data ${data}`), raw.end()));
          raw.on("close", () => (log.push("raw close"), done.resolve()));
        });
        const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
        tlsSocket.on("error", () => {});
        // The ClientHello has left.
        await new Promise(resolve => setImmediate(resolve));
        raw[verb]();
        await done.promise;
        assert.deepStrictEqual(log, ["raw close", "raw connect", "raw data echo hello", "raw close"]);
      } finally {
        raw.destroy();
        server.close();
      }
    });
  }

  // Bun only: in node a TLS socket that is dialed again has no TLS. Between the destroy() and the 'close' of the wrapped
  // socket the TLS socket is still open, and its connect() answers EISCONN as it does on a live session.
  type Redial = (raw: net.Socket, tlsSocket: tls.TLSSocket, redial: () => void) => void;
  const inTLSClose: Redial = (_raw, tlsSocket, redial) => tlsSocket.once("close", redial);
  const inRawClose: Redial = (raw, _tlsSocket, redial) => raw.once("close", redial);
  const redials: ["destroy" | "resetAndDestroy", string, Redial][] = [
    ["destroy", "in its 'close' listener", inTLSClose],
    ["destroy", "in a 'close' listener of the wrapped socket", inRawClose],
    ["resetAndDestroy", "in its 'close' listener", inTLSClose],
    ["resetAndDestroy", "in a 'close' listener of the wrapped socket", inRawClose],
  ];
  for (const [verb, when, schedule] of redials) {
    for (const beforeTheWrap of [false, true]) {
      // The listener of the wrapped socket runs ahead of the one that the wrap added, or behind it.
      if (beforeTheWrap && schedule !== inRawClose) continue;
      test(
        `new TLSSocket(socket): after ${verb}() the TLS socket is dialed again ${when}${beforeTheWrap ? ", added before the wrap" : ""}, and that session ends as any other`,
        { skip: typeof Bun === "undefined" },
        async () => {
          const seen: string[] = [];
          let sessionCount = 0;
          const server = tls.createServer({ key, cert }, peer => {
            peer.on("error", () => {});
            if (++sessionCount !== 2) return void peer.resume();
            peer.on("data", data => seen.push(`data ${data}`));
            peer.on("end", () => seen.push("end"));
          });
          const port = await listen(server);
          const raw = net.connect(port, "127.0.0.1");
          const log: string[] = [];
          // The 'close' of each of the two sessions, or an 'error'.
          const over = Promise.withResolvers<void>();
          let closes = 0;
          let tlsSocket!: tls.TLSSocket;
          const redial = () => {
            tlsSocket.connect({ port, host: "127.0.0.1" });
            tlsSocket.once("secure", () => {
              tlsSocket.on("finish", () => log.push("tls finish"));
              tlsSocket.end("again", () => log.push("end callback"));
              tlsSocket.resume();
            });
          };
          if (beforeTheWrap) schedule(raw, tlsSocket, redial);
          tlsSocket = new tls.TLSSocket(raw, { rejectUnauthorized: false });
          try {
            tlsSocket.on("error", (err: NodeJS.ErrnoException) => (log.push(`tls error ${err.code}`), over.resolve()));
            tlsSocket.on("close", () => ++closes === 2 && over.resolve());
            await once(tlsSocket, "secure");
            // Out of the callback of the handshake.
            await new Promise(resolve => setImmediate(resolve));
            raw[verb]();
            if (!beforeTheWrap) schedule(raw, tlsSocket, redial);
            await over.promise;
            assert.deepStrictEqual({ log, seen }, { log: ["end callback", "tls finish"], seen: ["data again", "end"] });
          } finally {
            raw.destroy();
            tlsSocket.destroy();
            server.close();
          }
        },
      );
    }
  }

  // Bun only. One immediate later the TLS socket is not destroyed yet.
  for (const verb of ["destroy", "resetAndDestroy"] as const) {
    test(
      `new TLSSocket(socket): after ${verb}() a connect() of the TLS socket one immediate later answers as on a live session`,
      { skip: typeof Bun === "undefined" },
      async () => {
        const server = tls.createServer({ key, cert }, peer => peer.on("error", () => {}).resume());
        const port = await listen(server);
        const raw = net.connect(port, "127.0.0.1");
        const tlsSocket = new tls.TLSSocket(raw, { rejectUnauthorized: false });
        try {
          const log: string[] = [];
          tlsSocket.on("error", (err: NodeJS.ErrnoException) => log.push(`tls error ${err.code}`));
          await once(tlsSocket, "secure");
          // Out of the callback of the handshake.
          await new Promise(resolve => setImmediate(resolve));
          const closed = new Promise<boolean>(resolve => tlsSocket.on("close", resolve));
          raw[verb]();
          setImmediate(() => tlsSocket.connect({ port, host: "127.0.0.1" }));
          assert.deepStrictEqual({ hadError: await closed, log }, { hadError: true, log: ["tls error EISCONN"] });
        } finally {
          raw.destroy();
          tlsSocket.destroy();
          server.close();
        }
      },
    );
  }

  // Bun only. The 'close' of the wrapped socket follows the 'error' and the 'close' of the TLS socket here.
  test(
    "new TLSSocket(socket): the TLS socket is dialed again in the 'close' that follows a cancelled write, and that session ends as any other",
    { skip: typeof Bun === "undefined" },
    async () => {
      const seen: string[] = [];
      let sessionCount = 0;
      const server = tls.createServer({ key, cert }, peer => {
        peer.on("error", () => {});
        // The first one reads nothing, so the kernel does not take all of `big`.
        if (++sessionCount !== 2) return void peer.pause();
        peer.on("data", data => seen.push(`data ${data}`));
        peer.on("end", () => seen.push("end"));
      });
      const port = await listen(server);
      const raw = net.connect(port, "127.0.0.1");
      const tlsSocket = new tls.TLSSocket(raw, { rejectUnauthorized: false });
      try {
        const log: string[] = [];
        const over = Promise.withResolvers<void>();
        let closes = 0;
        tlsSocket.on("error", (err: NodeJS.ErrnoException) => log.push(`tls error ${err.code}`));
        tlsSocket.on("close", () => {
          if (++closes === 2) return over.resolve();
          tlsSocket.connect({ port, host: "127.0.0.1" });
          tlsSocket.once("secure", () => {
            tlsSocket.on("finish", () => log.push("tls finish"));
            tlsSocket.end("again", () => log.push("end callback"));
            tlsSocket.resume();
          });
        });
        await once(tlsSocket, "secure");
        // Out of the callback of the handshake.
        await new Promise(resolve => setImmediate(resolve));
        tlsSocket.write(big, (err?: NodeJS.ErrnoException | null) => log.push(`big write: ${err ? err.code : "ok"}`));
        raw.destroy();
        await over.promise;
        assert.deepStrictEqual(
          { log, seen },
          {
            log: ["big write: ECANCELED", "tls error ECANCELED", "end callback", "tls finish"],
            seen: ["data again", "end"],
          },
        );
      } finally {
        raw.destroy();
        tlsSocket.destroy();
        server.close();
      }
    },
  );

  // Bun only: the two sockets are dialed again, each on its own. The end of the session of the TLS socket then is not
  // the end of the connection of the socket that it wrapped before.
  test(
    "new TLSSocket(socket): both sockets are dialed again, and the end of the TLS session leaves the other connection open",
    { skip: typeof Bun === "undefined" },
    async () => {
      const tlsServer = tls.createServer({ key, cert }, peer => {
        peer.on("error", () => {});
        peer.on("data", data => peer.write(`echo ${data}`));
      });
      const plain = net.createServer(peer => {
        peer.on("error", () => {});
        peer.on("data", data => peer.write(`echo ${data}`));
      });
      const [tlsPort, plainPort] = [await listen(tlsServer), await listen(plain)];
      const raw = net.connect(tlsPort, "127.0.0.1");
      const tlsSocket = new tls.TLSSocket(raw, { rejectUnauthorized: false });
      try {
        for (const socket of [raw, tlsSocket]) socket.on("error", () => {});
        await once(tlsSocket, "secure");
        await new Promise(resolve => setImmediate(resolve));
        raw.destroy();
        await Promise.all([once(raw, "close"), once(tlsSocket, "close")]);
        tlsSocket.connect({ port: tlsPort, host: "127.0.0.1" });
        await Promise.all([once(raw.connect(plainPort, "127.0.0.1"), "connect"), once(tlsSocket, "secure")]);
        tlsSocket.resume();
        tlsSocket.end("bye");
        await once(tlsSocket, "close");
        const state = { destroyed: raw.destroyed };
        raw.write("still here");
        const [answer] = await once(raw, "data");
        assert.deepStrictEqual({ ...state, answer: String(answer) }, { destroyed: false, answer: "echo still here" });
      } finally {
        raw.destroy();
        tlsSocket.destroy();
        tlsServer.close();
        plain.close();
      }
    },
  );

  // Bun only: node has no connect() that gives a TLS socket another socket to wrap.
  for (const verb of ["destroy", "resetAndDestroy"] as const) {
    test(
      `tls.connect({ socket }): after ${verb}() the TLS socket is given a socket that still connects, and wraps it`,
      { skip: typeof Bun === "undefined" },
      async () => {
        let sessionCount = 0;
        const server = tls.createServer({ key, cert }, peer => {
          sessionCount++;
          peer.on("error", () => {});
          peer.on("data", data => peer.write(`echo ${data}`));
        });
        const port = await listen(server);
        const raw = net.connect(port, "127.0.0.1");
        let other: net.Socket | undefined;
        try {
          await once(raw, "connect");
          const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
          tlsSocket.on("error", () => {});
          await once(tlsSocket, "secureConnect");
          tlsSocket.write("one");
          await once(tlsSocket, "data");
          const log: string[] = [];
          tlsSocket.on("secureConnect", () => tlsSocket.write("two"));
          tlsSocket.on("data", data => (log.push(`tls data ${data}`), tlsSocket.destroy()));
          raw[verb]();
          other = net.connect(port, "127.0.0.1");
          const otherClosed = new Promise<void>(resolve => other!.on("error", () => {}).on("close", () => resolve()));
          tlsSocket.connect({ socket: other, rejectUnauthorized: false } as unknown as net.SocketConnectOpts);
          await otherClosed;
          assert.deepStrictEqual({ log, sessionCount }, { log: ["tls data echo two"], sessionCount: 2 });
        } finally {
          raw.destroy();
          other?.destroy();
          server.close();
        }
      },
    );
  }

  // Bun only: the Writable of the TLS socket hands one write to the handle in a tick, and the destroy() hands over the
  // rest. A TLS socket that wraps another socket in that tick sends none of them a second time.
  test(
    "tls.connect({ socket }): writes that the destroy() handed over are not sent again over the next socket",
    { skip: typeof Bun === "undefined" },
    async () => {
      const received: string[] = ["", ""];
      let sessionCount = 0;
      const server = tls.createServer({ key, cert }, peer => {
        const nth = sessionCount++;
        peer.on("error", () => {});
        peer.on("data", data => (received[nth] += data));
      });
      const port = await listen(server);
      const [raw, other] = [net.connect(port, "127.0.0.1"), net.connect(port, "127.0.0.1")];
      try {
        await Promise.all([once(raw, "connect"), once(other, "connect")]);
        const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
        tlsSocket.on("error", () => {});
        await once(tlsSocket, "secureConnect");
        await new Promise(resolve => setImmediate(resolve));
        const written: string[] = [];
        const callback = (name: string) => (err?: Error | null) => written.push(`${name}: ${err ? err.message : "ok"}`);
        tlsSocket.write("AAAA", callback("a"));
        tlsSocket.write("BBBB", callback("b"));
        tlsSocket.write("CCCC", callback("c"));
        raw.destroy();
        tlsSocket.connect({ socket: other, rejectUnauthorized: false } as unknown as net.SocketConnectOpts);
        await once(tlsSocket, "secureConnect");
        tlsSocket.write("DDDD");
        while (received[1].length < 4) await new Promise(resolve => setImmediate(resolve));
        assert.deepStrictEqual(
          { written, received },
          { written: ["a: ok", "b: ok", "c: ok"], received: ["AAAABBBBCCCC", "DDDD"] },
        );
      } finally {
        raw.destroy();
        other.destroy();
        server.close();
      }
    },
  );

  // Combinations of the above, drawn by seed: the wrap, the state of its session, the callback that destroys the wrapped
  // socket, the verb, and up to two things that the owner does with the TLS socket after that.
  describe("drawn by seed", () => {
    type FollowUp = [action: string, when: string];
    function draw(seed: number) {
      let state = (Math.imul(seed, 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
      const random = () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x1_0000_0000;
      };
      for (let i = 0; i < 8; i++) random();
      const pick = (list: string[]) => list[Math.floor(random() * list.length)];
      const wrap = pick(sessions.map(([name]) => name));
      const session = pick(["established", "established", "a write in flight", "before the handshake"]);
      const where =
        session === "before the handshake"
          ? pick(["an immediate", "a timer"])
          : pick(["'data'", "'data'", "an immediate", "a tick", "a timer"]);
      const verb = pick(["destroy()", "destroy()", "resetAndDestroy()", "destroy(err)"]);
      const followUps: FollowUp[] = [];
      for (let count = Math.floor(random() * 3); count > 0; count--) {
        followUps.push([
          pick([
            "write",
            "write of no data",
            "end",
            "end with data",
            "destroy",
            "nothing",
            "destroy of the wrapped socket again",
          ]),
          pick(["in the call", "in the call", "in a tick", "in an immediate", "two immediates later", "in a timer"]),
        ]);
      }
      const then = followUps.map(([action, when]) => `${action} ${when}`).join(", ") || "nothing";
      return { wrap, session, where, verb, followUps, name: `${wrap}, ${session}, ${verb} in ${where}, then: ${then}` };
    }

    // The log of the wrapped socket and of its TLS socket.
    async function play({ wrap, session, where, verb, followUps }: ReturnType<typeof draw>) {
      const log: string[] = [];
      const closed: Promise<void>[] = [];
      const sockets: net.Socket[] = [];
      const servers: net.Server[] = [];
      const observe = (name: string, socket: net.Socket) => {
        sockets.push(socket);
        socket.on("data", data => log.push(`${name} data ${data}`));
        socket.on("end", () => log.push(`${name} end`));
        socket.on("finish", () => log.push(`${name} finish`));
        socket.on("error", (err: NodeJS.ErrnoException) => log.push(`${name} error ${err.code}`));
        closed.push(
          new Promise<void>(resolve =>
            socket.on("close", hadError => (log.push(`${name} close hadError=${hadError}`), resolve())),
          ),
        );
      };
      const observePeer = (socket: net.Socket) => {
        sockets.push(socket);
        socket.on("error", () => {}).resume();
        closed.push(new Promise<void>(resolve => socket.on("close", () => resolve())));
        return socket;
      };
      const established = session !== "before the handshake";
      const secured = Promise.withResolvers<void>();
      let raw!: net.Socket;
      let tlsSocket: tls.TLSSocket | undefined;
      let peer!: net.Socket;
      if (clientWraps.includes(wrap)) {
        // A plain server never answers the handshake.
        const server = established
          ? tls.createServer({ key, cert }, accepted => ((peer = observePeer(accepted)), secured.resolve()))
          : net.createServer(accepted => void (peer = observePeer(accepted)));
        servers.push(server);
        raw = net.connect(await listen(server), "127.0.0.1");
        await once(raw, "connect");
        if (wrap === "new TLSSocket(socket)") {
          tlsSocket = new tls.TLSSocket(raw, { rejectUnauthorized: false });
          (tlsSocket as unknown as { _start(): void })._start();
        } else {
          tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
        }
        if (established) await Promise.all([secured.promise, once(tlsSocket, "secure")]);
      } else {
        const wrapped = Promise.withResolvers<void>();
        const tlsServer = tls.createServer({ key, cert }, accepted => ((tlsSocket = accepted), secured.resolve()));
        tlsServer.on("tlsClientError", (err: NodeJS.ErrnoException) => log.push(`tlsClientError ${err.code}`));
        const server = net.createServer(accepted => {
          raw = accepted;
          if (wrap === "a socket injected into a tls.Server") {
            tlsServer.emit("connection", accepted);
          } else {
            tlsSocket = new tls.TLSSocket(accepted, { isServer: true, key, cert });
            tlsSocket.on("secure", () => secured.resolve());
          }
          wrapped.resolve();
        });
        servers.push(server);
        const port = await listen(server);
        // A plain peer never starts the handshake.
        peer = observePeer(
          established
            ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
            : net.connect(port, "127.0.0.1"),
        );
        await wrapped.promise;
        if (established) await secured.promise;
      }
      try {
        // Out of the callback of the handshake: a write from there fails with another error in newer node.
        await new Promise(resolve => setImmediate(resolve));
        observe("raw", raw);
        // A tls.Server hands over no TLS socket before the handshake.
        if (tlsSocket) observe("tls", tlsSocket);
        const written = (name: string) => (err?: NodeJS.ErrnoException | null) =>
          log.push(`${name}: ${err ? (err.code ?? err.message) : "ok"}`);
        // Each follow-up has run when the log is read.
        const ran = followUps.map(() => Promise.withResolvers<void>());
        closed.push(...ran.map(({ promise }) => promise));
        const follow = ([action, when]: FollowUp, nth: number) => {
          const run = () => {
            ran[nth].resolve();
            if (!tlsSocket) return;
            if (action === "write")
              log.push(`write #${nth} returned ${tlsSocket.write("pong", written(`write #${nth}`))}`);
            else if (action === "write of no data")
              log.push(`write #${nth} returned ${tlsSocket.write("", written(`write #${nth}`))}`);
            else if (action === "end") tlsSocket.end();
            else if (action === "end with data") tlsSocket.end("bye", written(`end #${nth}`));
            else if (action === "destroy") (tlsSocket.destroy(), log.push(`tls destroy() #${nth} returned`));
            else if (action === "destroy of the wrapped socket again") raw.destroy();
          };
          if (when === "in the call") run();
          else if (when === "in a tick") process.nextTick(run);
          else if (when === "in an immediate") setImmediate(run);
          else if (when === "two immediates later") setImmediate(() => setImmediate(run));
          // Past the immediates of the loop turn in which the timer is due: Bun can run that timer ahead of them.
          else setTimeout(() => setImmediate(run), 1);
        };
        const act = () => {
          log.push("act");
          // The peer reads nothing, so the kernel does not take all of it.
          if (session === "a write in flight") tlsSocket!.write(big, written("write in flight"));
          if (verb === "destroy()") raw.destroy();
          else if (verb === "resetAndDestroy()") raw.resetAndDestroy();
          else raw.destroy(ownerError());
          followUps.forEach(follow);
          // It reads the FIN or the reset.
          if (session === "a write in flight") peer.resume();
        };
        if (session === "a write in flight") peer.pause();
        if (where === "'data'") {
          tlsSocket!.once("data", act);
          peer.write("ping");
        } else if (where === "an immediate") setImmediate(act);
        else if (where === "a tick") process.nextTick(act);
        else setTimeout(act, 1);
        await Promise.all(closed);
        // Past what is still queued.
        for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve));
        return log;
      } finally {
        for (const socket of sockets) socket.destroy();
        for (const server of servers) server.close();
      }
    }

    const closeIsLater =
      "a destroy() from the check phase of the loop: the 'close' comes one loop turn later, so what the owner does before it finds the TLS socket open";
    const completesInATick =
      "a write of no data completes in a tick: node completes it in the check phase of the loop, past the 'close' here";
    // [seed, the log in Node.js, how the log differs in Bun]
    // prettier-ignore
    const seeds: [number, string, string?][] = [
    [1, "tls data ping | act | tls close hadError=false | tls destroy() #1 returned | raw close hadError=false"],
    [2, "act | tls close hadError=false | tls destroy() #1 returned | raw close hadError=false"],
    [3, "act | tls close hadError=false | raw close hadError=false | write #0 returned false | write #0: ERR_STREAM_DESTROYED"],
    [4, "act | tls error OWNER_DESTROY | raw error OWNER_DESTROY | tls close hadError=false | raw close hadError=true"],
    [5, "act | tls close hadError=false | raw close hadError=false"],
    [6, "act | tls close hadError=false | raw close hadError=false"],
    [7, "act | raw error OWNER_DESTROY | write in flight: ECANCELED | tls close hadError=true | tls error ECANCELED | raw close hadError=true"],
    [8, "act | raw error OWNER_DESTROY | write in flight: ECANCELED | tls close hadError=true | tls error ECANCELED | raw close hadError=true"],
    [9, "act | write in flight: ECANCELED | end #0: ECANCELED | tls close hadError=true | tls error ECANCELED | raw close hadError=false"],
    [10, "act | write #0 returned false | write #1 returned false | write in flight: ECANCELED | write #0: ECANCELED | write #1: ECANCELED | tls close hadError=true | tls error ECANCELED | raw close hadError=false"],
    [11, "act | raw error OWNER_DESTROY | tls finish | tls close hadError=false | raw close hadError=true"],
    [12, "act | end #0: ECANCELED | tls close hadError=false | raw close hadError=false"],
    [13, "tls data ping | act | tls close hadError=false | raw close hadError=false"],
    [14, "act | write #1 returned true | write #1: ok | tls close hadError=false | raw close hadError=false"],
    [15, "tls data ping | act | tls close hadError=false | raw close hadError=false"],
    [16, "tls data ping | act | tls close hadError=false | raw close hadError=false | end #1: ERR_STREAM_DESTROYED"],
    [17, "tls data ping | act | tls close hadError=false | raw close hadError=false"],
    [18, "act | tls close hadError=false | raw close hadError=false"],
    [19, "act | tls close hadError=false | raw close hadError=false"],
    [20, "tls data ping | act | tls close hadError=false | raw close hadError=false"],
    [21, "act | tls close hadError=false | raw close hadError=false"],
    [22, "act | raw error OWNER_DESTROY | tls close hadError=false | raw close hadError=true | write #0 returned false | write #0: ERR_STREAM_DESTROYED"],
    [23, "tls data ping | act | write #0 returned false | write in flight: ECANCELED | write #0: ECANCELED | end #1: ECANCELED | tls close hadError=true | tls error ECANCELED | raw close hadError=false"],
    [24, "tls data ping | act | write #0 returned false | write in flight: ECANCELED | write #0: ECANCELED | tls close hadError=true | tls error ECANCELED | raw close hadError=false"],
    [25, "act | tls close hadError=true | end #0: EBADF | tls error EBADF | raw close hadError=false"],
    [26, "tls data ping | act | write in flight: ECANCELED | tls close hadError=true | tls error ECANCELED | raw close hadError=false | tls destroy() #0 returned"],
    [27, "act | tls close hadError=false | raw close hadError=false | write #0 returned false | write #0: ERR_STREAM_DESTROYED"],
    [28, "act | tls close hadError=false | raw close hadError=false"],
    [29, "act | tls close hadError=false | raw close hadError=false"],
    [30, "act | tls close hadError=false | raw close hadError=false"],
    [31, "act | tls close hadError=false | raw close hadError=false | end #0: ERR_STREAM_DESTROYED"],
    [32, "tls data ping | act | tls finish | tls close hadError=false | raw close hadError=false"],
    [33, "act | tls close hadError=false | raw close hadError=false"],
    [34, "act | tls error OWNER_DESTROY | raw error OWNER_DESTROY | tls close hadError=false | raw close hadError=true | write #0 returned false | write #0: ERR_STREAM_DESTROYED | tls destroy() #1 returned", closeIsLater],
    [35, "act | tls close hadError=false | raw close hadError=false", closeIsLater],
    [36, "act | write in flight: ECANCELED | end #1: ECANCELED | tls close hadError=true | tls error ECANCELED | raw close hadError=false | end #0: ERR_STREAM_WRITE_AFTER_END"],
    [37, "tls data ping | act | tls close hadError=false | raw close hadError=false"],
    [38, "act | write in flight: ECANCELED | tls close hadError=true | tls error ECANCELED | raw close hadError=false"],
    [39, "tls data ping | act | write in flight: ECANCELED | tls close hadError=true | tls error ECANCELED | raw close hadError=false"],
    [40, "tls data ping | act | write #1 returned true | write #1: ok | write #0 returned true | tls close hadError=false | raw close hadError=false | write #0: ok", completesInATick],
    [41, "tls data ping | act | tls close hadError=false | raw close hadError=false"],
    [42, "act | write #0 returned false | tls error OWNER_DESTROY | raw error OWNER_DESTROY | write #0: EBADF | tls close hadError=true | tls error EBADF | raw close hadError=true | write #1 returned false | write #1: ERR_STREAM_DESTROYED"],
    [43, "act | write #0 returned true | write #0: ok | tls close hadError=false | raw close hadError=false"],
    [44, "tls data ping | act | raw error OWNER_DESTROY | tls close hadError=false | raw close hadError=true"],
    [45, "act | write in flight: ECANCELED | tls close hadError=true | tls error ECANCELED | raw close hadError=false | tls destroy() #0 returned"],
    [46, "act | write #0 returned false | write #0: EBADF | tls close hadError=true | tls error EBADF | raw close hadError=false"],
    [47, "act | raw error OWNER_DESTROY | tls close hadError=false | raw close hadError=true"],
    [48, "tls data ping | act | write in flight: ECANCELED | tls close hadError=false | tls destroy() #0 returned | raw close hadError=false"],
    ];
    // The log in Bun for that log in Node.js: the 'close' of the TLS socket comes right ahead of the 'close' of the
    // wrapped socket (`closeAndError`, `closeInTheCall`).
    function inBun(log: string[]) {
      const at = log.findIndex(line => line.startsWith("tls close"));
      const to = log.findIndex((line, i) => i > at && line.startsWith("raw close"));
      if (at === -1 || to === -1) return log;
      log.splice(to - 1, 0, ...log.splice(at, 1));
      return log;
    }
    for (const [seed, log, how] of seeds) {
      const drawn = draw(seed);
      test(`seed ${seed}: ${drawn.name}`, how ? differs(how) : {}, async () => {
        const inNodeJS = log.split(" | ");
        assert.deepStrictEqual(await play(drawn), inNode ? inNodeJS : inBun(inNodeJS));
      });
    }
  });
});

describe("the TLS socket is destroyed in the tick it was made", () => {
  const both = ["raw close", "tls close hadError=false"];

  // No 'error' listener on the wrapped socket: a connect left running would fail as an uncaught exception.
  async function destroyedAtOnce(raw: Duplex, wrap: (raw: Duplex) => tls.TLSSocket) {
    const { events, closed, observe } = lifecycleLog();
    const tlsSocket = wrap(raw);
    observe("raw", raw, false);
    observe("tls", tlsSocket);
    tlsSocket.destroy();
    events.push(`raw.destroyed=${raw.destroyed}`);
    await Promise.all(closed);
    return events;
  }

  for (const [name, wrap] of wraps) {
    test(`${name} over a socket whose connect will be refused`, async () => {
      await using refused = await refusedPort();
      const events = await destroyedAtOnce(net.connect(refused.port, "127.0.0.1"), wrap);
      assert.deepStrictEqual(events, ["raw.destroyed=true", ...both]);
    });

    test(`${name} over a socket that was never dialed`, async () => {
      assert.deepStrictEqual(await destroyedAtOnce(new net.Socket(), wrap), ["raw.destroyed=true", ...both]);
    });
  }

  test("new TLSSocket(socket, { isServer }) over an accepted socket releases the connection", async () => {
    const accepted = Promise.withResolvers<string[]>();
    const server = net.createServer(raw => accepted.resolve(destroyedAtOnce(raw, wraps[2][1])));
    const peer = net.connect(await listen(server), "127.0.0.1").resume();
    try {
      await once(peer, "close");
      assert.deepStrictEqual(await accepted.promise, ["raw.destroyed=true", ...both]);
      server.close();
      await once(server, "close");
    } finally {
      peer.destroy();
      server.close();
    }
  });

  test("tls.connect({ socket }) over an established TLS socket", async () => {
    const server = tls.createServer({ key, cert }, peer => peer.on("error", () => {}).resume());
    const inner = tls.connect({ port: await listen(server), host: "127.0.0.1", rejectUnauthorized: false });
    try {
      await once(inner, "secureConnect");
      assert.deepStrictEqual(await destroyedAtOnce(inner, wraps[0][1]), ["raw.destroyed=true", ...both]);
    } finally {
      inner.destroy();
      server.close();
    }
  });
});

test("destroy() of a TLS socket made over a socket with a write still queued closes a connection the peer keeps open", async () => {
  const { events, closed, observe } = lifecycleLog();
  const server = net.createServer({ allowHalfOpen: true }, peer => peer.on("error", () => {}).resume());
  const raw = net.connect(await listen(server), "127.0.0.1");
  try {
    await once(raw, "connect");
    raw.cork();
    raw.write("STARTTLS\r\n");
    const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
    raw.uncork();
    observe("raw", raw);
    observe("tls", tlsSocket);
    setImmediate(() => tlsSocket.destroy());
    await Promise.all(closed);
    assert.deepStrictEqual(events, ["raw close", "tls close hadError=false"]);
  } finally {
    raw.destroy();
    server.close();
  }
});

describe("the wrapped socket goes away before it connected", () => {
  async function wrapped(raw: net.Socket, wrap: (raw: Duplex) => tls.TLSSocket, rawListeners = true) {
    const { events, closed, observe } = lifecycleLog();
    if (rawListeners) observe("raw", raw);
    const tlsSocket = wrap(raw);
    tlsSocket.on("_tlsError", (err: NodeJS.ErrnoException) => events.push(`tls _tlsError ${err.code}`));
    observe("tls", tlsSocket);
    return { events, closed };
  }

  // Only a socket from tls.connect() has released control, so only it re-emits '_tlsError' as 'error'.
  for (const [name, wrap] of wraps) {
    const tlsError = ["tls _tlsError ECONNREFUSED", ...(wrap === wraps[0][1] ? ["tls error ECONNREFUSED"] : [])];

    test(`${name}: a refused connect`, async () => {
      await using refused = await refusedPort();
      const { events, closed } = await wrapped(net.connect(refused.port, "127.0.0.1"), wrap);
      await Promise.all(closed);
      assert.deepStrictEqual(events, ["raw error ECONNREFUSED", ...tlsError, "raw close", "tls close hadError=false"]);
    });

    test(`${name}: a refused connect() made after the wrap, with listeners on the TLS socket alone`, async () => {
      await using refused = await refusedPort();
      const raw = new net.Socket();
      const { events, closed } = await wrapped(raw, wrap, false);
      raw.connect(refused.port, "127.0.0.1");
      await Promise.all(closed);
      assert.deepStrictEqual(events, [...tlsError, "tls close hadError=false"]);
    });

    test(`${name}: destroy() of the wrapped socket`, async () => {
      await using refused = await refusedPort();
      const raw = net.connect(refused.port, "127.0.0.1");
      const { events, closed } = await wrapped(raw, wrap);
      raw.destroy();
      await Promise.all(closed);
      assert.deepStrictEqual(events, ["raw close", "tls close hadError=false"]);
    });
  }

  test("a socket dialed again after the failure is no longer tied to the closed TLS socket", async () => {
    await using refused = await refusedPort();
    const plain = net.createServer(socket => socket.resume().end("plain"));
    const port = await listen(plain);
    const raw = net.connect(refused.port, "127.0.0.1");
    try {
      const { events, closed } = await wrapped(raw, wraps[0][1]);
      await Promise.all(closed);
      events.length = 0;
      raw.connect(port, "127.0.0.1");
      const received: Buffer[] = [];
      raw.on("data", (chunk: Buffer) => received.push(chunk));
      await once(raw, "close");
      assert.deepStrictEqual([Buffer.concat(received).toString(), ...events], ["plain", "raw close"]);
    } finally {
      raw.destroy();
      plain.close();
    }
  });
});

// In a process of its own: these shapes used to abort it, or to keep it from exiting. Resolves with what `body` pushed to `log`.
async function logOfChild(body: string) {
  const script = `
    const net = require("node:net"), tls = require("node:tls"), { readFileSync } = require("node:fs");
    const [key, cert] = ${JSON.stringify([join(fixtures, "agent1-key.pem"), join(fixtures, "agent1-cert.pem")])}.map(f => readFileSync(f));
    const log = [];
    process.on("exit", () => console.log(JSON.stringify(log)));
    // A process that cannot exit must not outlive the test.
    setTimeout(() => process.exit(3), 10_000).unref();
    ${body}
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  let stdout = "";
  child.stdout.on("data", chunk => (stdout += chunk));
  const [exitCode, signal] = await once(child, "exit");
  assert.deepStrictEqual({ exitCode, signal }, { exitCode: 0, signal: null });
  return JSON.parse(stdout);
}

describe("new TLSSocket(socket, { isServer }) over a socket that is still connecting", () => {
  const lookups: [string, net.LookupFunction | undefined][] = [
    ["an IP address", undefined],
    ["a lookup that answers later", (_host, _options, callback) => void setImmediate(callback, null, "127.0.0.1", 4)],
  ];
  for (const [name, lookup] of lookups) {
    test(`handshakes once it connected to ${name}, and lets the process exit`, async () => {
      // The listener plays the TLS client over the connection it accepts.
      const log = await logOfChild(`
        const lookup = ${lookup};
        const server = net.createServer(accepted => {
          const client = tls.connect({ socket: accepted, rejectUnauthorized: false }, () => client.write("ping"));
          client.once("data", data => { log.push("client data " + data); client.end(); });
        }).listen(0, "127.0.0.1", () => {
          const raw = net.connect({ port: server.address().port, host: lookup ? "localhost" : "127.0.0.1", family: 4, lookup });
          raw.on("connect", () => log.push("raw connect"));
          raw.on("close", () => log.push("raw close"));
          const tlsSocket = new tls.TLSSocket(raw, { isServer: true, key, cert });
          tlsSocket.on("data", data => tlsSocket.write("echo:" + data + " from " + tlsSocket.remoteAddress));
          tlsSocket.on("close", () => { log.push("tls close"); server.close(); });
        });
      `);
      assert.deepStrictEqual(log, ["raw connect", "client data echo:ping from 127.0.0.1", "raw close", "tls close"]);
    });
  }

  for (const method of ["end", "destroy"]) {
    test(`${method}() once it connected closes the connection`, async () => {
      const log = await logOfChild(`
        let tlsSocket;
        const server = net.createServer(peer => {
          peer.on("end", () => log.push("peer end")).resume();
          setImmediate(() => tlsSocket.${method}());
        }).listen(0, "127.0.0.1", () => {
          tlsSocket = new tls.TLSSocket(net.connect(server.address().port, "127.0.0.1"), { isServer: true, key, cert });
          tlsSocket.on("close", () => { log.push("tls close"); server.close(); }).resume();
        });
      `);
      assert.deepStrictEqual(log.sort(), ["peer end", "tls close"]);
    });
  }
});

describe("a TLS socket made over a socket that has sent its FIN", () => {
  for (const when of ["in the same tick", "after 'finish'"]) {
    test(`new TLSSocket(socket, { isServer }), end() ${when}`, async () => {
      const log = await logOfChild(`
        const server = net.createServer(raw => {
          raw.end();
          const wrap = () => {
            const tlsSocket = new tls.TLSSocket(raw, { isServer: true, key, cert });
            raw.on("close", () => log.push("raw close"));
            tlsSocket.on("close", () => { log.push("tls close"); server.close(); });
          };
          ${when === "in the same tick" ? "wrap()" : `raw.on("finish", wrap)`};
        }).listen(0, "127.0.0.1", () => {
          const peer = tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false });
          for (const event of ["secureConnect", "end", "error"]) peer.on(event, err => log.push("peer " + event + (err ? " " + err.code : "")));
        });
      `);
      // Only Linux is known to hand the peer the FIN ahead of the reset behind it.
      const peerEnd = process.platform === "linux" ? ["peer end"] : [];
      assert.deepStrictEqual(log.filter(event => event !== "peer end" || peerEnd.length > 0).sort(), [
        ...peerEnd,
        "peer error ECONNRESET",
        "raw close",
        "tls close",
      ]);
    });
  }

  test("tls.connect({ socket })", async () => {
    const log = await logOfChild(`
      const server = net.createServer({ allowHalfOpen: true }, peer => {
        peer.on("data", () => log.push("peer data")).on("end", () => peer.end());
      }).listen(0, "127.0.0.1", () => {
        const raw = net.connect({ port: server.address().port, host: "127.0.0.1", allowHalfOpen: true }, () => raw.end());
        raw.on("finish", () => {
          const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
          raw.on("close", () => log.push("raw close"));
          tlsSocket.on("secureConnect", () => log.push("tls secureConnect")).on("error", () => log.push("tls error"));
          tlsSocket.on("close", hadError => { log.push("tls close hadError=" + hadError); server.close(); });
        });
      });
    `);
    assert.deepStrictEqual(log.sort(), ["raw close", "tls close hadError=true", "tls error"]);
  });
});

test("a transport is still intact inside the 'error' of a handshake that failed over it", async () => {
  const { events, closed, observe } = lifecycleLog();
  const transport = new Duplex({ read() {}, write: (_chunk, _encoding, callback) => callback() });
  const tlsSocket = new tls.TLSSocket(transport as net.Socket, { isServer: true, key, cert });
  observe("raw", transport);
  tlsSocket.on("error", () => events.push(`tls error, raw.destroyed=${transport.destroyed}`));
  observe("tls", tlsSocket, false);
  transport.push("this is not a ClientHello\r\n");
  await Promise.all(closed);
  assert.deepStrictEqual(events, ["tls error, raw.destroyed=false", "raw close", "tls close hadError=true"]);
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L480-L488
describe("a client handshake that fails with a protocol error leaves the socket inspectable inside 'error'", () => {
  function observe(tlsSocket: tls.TLSSocket, raw?: net.Socket) {
    const events: unknown[] = [];
    const { promise, resolve } = Promise.withResolvers<unknown[]>();
    tlsSocket.on("secureConnect", () => events.push("secureConnect"));
    tlsSocket.on("error", (error: NodeJS.ErrnoException) => {
      events.push({
        error: error.code,
        destroyed: tlsSocket.destroyed,
        _hadError: (tlsSocket as unknown as { _hadError: boolean })._hadError,
        remoteAddress: tlsSocket.remoteAddress,
        remotePort: tlsSocket.remotePort,
        rawDestroyed: raw?.destroyed,
      });
    });
    tlsSocket.on("close", hadError => {
      events.push({ close: hadError });
      resolve(events);
    });
    return promise;
  }

  const failure = (error: string, remotePort: number, rawDestroyed?: boolean) => [
    { error, destroyed: true, _hadError: true, remoteAddress: "127.0.0.1", remotePort, rawDestroyed },
    { close: true },
  ];

  const plaintextPeer = () =>
    net.createServer(peer => {
      peer.on("error", () => {});
      peer.on("data", () => peer.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
    });

  test("tls.connect({ port }) to a peer that does not speak TLS", async () => {
    const server = plaintextPeer();
    const port = await listen(server);
    try {
      const events = await observe(tls.connect({ port, host: "127.0.0.1" }));
      assert.deepStrictEqual(events, failure("ERR_SSL_WRONG_VERSION_NUMBER", port));
    } finally {
      server.close();
    }
  });

  for (const state of ["connected", "connecting"]) {
    test(`tls.connect({ socket }) over a ${state} socket to a peer that does not speak TLS`, async () => {
      const server = plaintextPeer();
      const port = await listen(server);
      const raw = net.connect(port, "127.0.0.1");
      try {
        if (state === "connected") await once(raw, "connect");
        const events = await observe(tls.connect({ socket: raw }), raw);
        assert.deepStrictEqual(events, failure("ERR_SSL_WRONG_VERSION_NUMBER", port, false));
      } finally {
        raw.destroy();
        server.close();
      }
    });
  }

  test("a fatal alert from a TLS peer", async () => {
    const server = tls.createServer({ key, cert, minVersion: "TLSv1.3" }).on("tlsClientError", () => {});
    const port = await listen(server);
    try {
      const events = await observe(tls.connect({ port, host: "127.0.0.1", maxVersion: "TLSv1.2" }));
      assert.deepStrictEqual(events, failure("ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION", port));
    } finally {
      server.close();
    }
  });
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L977
describe("an error of the wrapped socket is reported on the TLS socket", () => {
  const failure = () => Object.assign(new Error("transport failed"), { code: "TRANSPORT_FAILED" });

  // The events of the TLS socket, and the 'error' of the wrapped socket when `rawListener` asks for one.
  function observe(tlsSocket: tls.TLSSocket, raw: net.Socket, rawListener: boolean) {
    const events: string[] = [];
    const { promise, resolve } = Promise.withResolvers<string[]>();
    tlsSocket.on("_tlsError", (err: NodeJS.ErrnoException) => events.push(`tls _tlsError ${err.code}`));
    tlsSocket.on("error", (err: NodeJS.ErrnoException) => events.push(`tls error ${err.code}`));
    if (rawListener) raw.on("error", (err: NodeJS.ErrnoException) => events.push(`raw error ${err.code}`));
    tlsSocket.on("close", hadError => {
      events.push(`tls close hadError=${hadError}`);
      resolve(events);
    });
    return promise;
  }

  for (const rawListener of [false, true]) {
    const listeners = rawListener ? "both sockets" : "the TLS socket alone";
    const rawError = rawListener ? ["raw error TRANSPORT_FAILED"] : [];

    for (const state of ["connected", "connecting"]) {
      test(`tls.connect({ socket }) over a ${state} socket, after the handshake, listeners on ${listeners}`, async () => {
        const server = tls.createServer({ key, cert }, peer => peer.on("error", () => {}).resume());
        const raw = net.connect(await listen(server), "127.0.0.1");
        try {
          if (state === "connected") await once(raw, "connect");
          const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
          const events = observe(tlsSocket, raw, rawListener);
          tlsSocket.on("secureConnect", () => raw.destroy(failure()));
          assert.deepStrictEqual(await events, [
            "tls _tlsError TRANSPORT_FAILED",
            "tls error TRANSPORT_FAILED",
            ...rawError,
            "tls close hadError=false",
          ]);
        } finally {
          raw.destroy();
          server.close();
        }
      });
    }

    test(`tls.connect({ socket }), before the handshake completes, listeners on ${listeners}`, async () => {
      const server = net.createServer(peer => peer.on("error", () => {}).resume());
      const raw = net.connect(await listen(server), "127.0.0.1");
      try {
        await once(raw, "connect");
        const events = observe(tls.connect({ socket: raw, rejectUnauthorized: false }), raw, rawListener);
        setImmediate(() => raw.destroy(failure()));
        assert.deepStrictEqual(await events, [
          "tls _tlsError TRANSPORT_FAILED",
          "tls error TRANSPORT_FAILED",
          ...rawError,
          "tls close hadError=false",
        ]);
      } finally {
        raw.destroy();
        server.close();
      }
    });

    // A server-side wrap has not released control, so '_tlsError' is not re-emitted as 'error'.
    for (const when of ["before the handshake completes", "after the handshake"]) {
      test(`new TLSSocket(socket, { isServer }), ${when}, listeners on ${listeners}`, async () => {
        const accepted = Promise.withResolvers<string[]>();
        const server = net.createServer(raw => {
          const tlsSocket = new tls.TLSSocket(raw, { isServer: true, key, cert });
          accepted.resolve(observe(tlsSocket, raw, rawListener));
          if (when === "after the handshake") tlsSocket.on("secure", () => raw.destroy(failure()));
          else setImmediate(() => raw.destroy(failure()));
        });
        const port = await listen(server);
        const peer =
          when === "after the handshake"
            ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
            : net.connect(port, "127.0.0.1");
        peer.on("error", () => {});
        try {
          assert.deepStrictEqual(await accepted.promise, [
            "tls _tlsError TRANSPORT_FAILED",
            ...rawError,
            "tls close hadError=false",
          ]);
        } finally {
          peer.destroy();
          server.close();
        }
      });
    }
  }

  test("a socket injected into a tls.Server, before the handshake completes: 'tlsClientError'", async () => {
    const reported = Promise.withResolvers<string | undefined>();
    const tlsServer = tls.createServer({ key, cert });
    tlsServer.on("tlsClientError", (err: NodeJS.ErrnoException) => reported.resolve(err.code));
    const server = net.createServer(raw => {
      tlsServer.emit("connection", raw);
      setImmediate(() => raw.destroy(failure()));
    });
    const peer = net.connect(await listen(server), "127.0.0.1");
    peer.on("error", () => {});
    try {
      assert.strictEqual(await reported.promise, "TRANSPORT_FAILED");
    } finally {
      peer.destroy();
      server.close();
    }
  });

  // Bun only: node re-emits it on the destroyed TLS socket.
  test("not once the TLS socket has closed", { skip: typeof Bun === "undefined" }, async () => {
    const server = net.createServer(peer => peer.on("error", () => {}).resume());
    const port = await listen(server);
    const raw = net.connect(port, "127.0.0.1");
    try {
      const events = observe(tls.connect({ socket: raw, rejectUnauthorized: false }), raw, true);
      raw.destroy();
      const log = await events;
      await once(raw.connect(port, "127.0.0.1"), "connect");
      raw.destroy(failure());
      await new Promise(resolve => raw.once("close", resolve));
      assert.deepStrictEqual(log, ["tls close hadError=false", "raw error TRANSPORT_FAILED"]);
    } finally {
      raw.destroy();
      server.close();
    }
  });

  test("the AbortSignal of the wrapped socket", async () => {
    const server = tls.createServer({ key, cert }, peer => peer.on("error", () => {}).resume());
    const controller = new AbortController();
    const raw = net.connect({ port: await listen(server), host: "127.0.0.1", signal: controller.signal });
    try {
      const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
      const events = observe(tlsSocket, raw, false);
      tlsSocket.on("secureConnect", () => controller.abort());
      assert.deepStrictEqual(await events, [
        "tls _tlsError ABORT_ERR",
        "tls error ABORT_ERR",
        "tls close hadError=false",
      ]);
    } finally {
      raw.destroy();
      server.close();
    }
  });

  // Node has one engine. Bun adopts the fd of "a connected socket" and runs TLS over the stream for the other two.
  const transports = ["a connected socket", "a socket with a write still queued", "a TLS socket"];

  // Makes the TLS socket under test on one side of a connection that runs through a plain TCP relay.
  // `act` gets it, the socket it wraps, and the relay's end of that socket's TCP connection.
  async function behindRelay(
    transport: string,
    side: string,
    when: string,
    act: (raw: net.Socket, peer: net.Socket) => void,
    withListeners = true,
  ) {
    const sockets: net.Socket[] = [];
    const quiet = <T extends net.Socket>(socket: T) => (sockets.push(socket), socket.on("error", () => {}));
    const result = Promise.withResolvers<{ added: number; events: string[] }>();
    const queued = transport === "a socket with a write still queued";
    const relayEnds: Record<string, net.Socket> = {};
    // A dialed socket can hear of its 'connect' before the relay hears of the 'connection'.
    const relayed = Promise.withResolvers<void>();

    function wrap(isServer: boolean, raw: net.Socket) {
      return isServer
        ? new tls.TLSSocket(raw, { isServer, key, cert })
        : tls.connect({ socket: raw, rejectUnauthorized: false });
    }
    function underTest(raw: net.Socket) {
      sockets.push(raw);
      const before = raw.listenerCount("error");
      if (queued) (raw.cork(), raw.write("pre"));
      const tlsSocket = wrap(side === "server", raw);
      if (queued) raw.uncork();
      sockets.push(tlsSocket);
      const run = () => {
        const added = raw.listenerCount("error") - before;
        const events: string[] = [];
        const closed = [raw, tlsSocket].map((socket, i) => {
          const name = i ? "tls" : "raw";
          if (i) socket.on("_tlsError", (err: NodeJS.ErrnoException) => events.push(`tls _tlsError ${err.code}`));
          if (withListeners)
            socket.on("error", (err: NodeJS.ErrnoException) => events.push(`${name} error ${err.code}`));
          return new Promise<void>(resolve =>
            socket.on("close", hadError => (events.push(`${name} close hadError=${hadError}`), resolve())),
          );
        });
        tlsSocket.resume();
        act(raw, relayEnds[side]);
        result.resolve(Promise.all(closed).then(() => ({ added, events })));
      };
      const soon = () => void relayed.promise.then(() => setImmediate(run));
      if (when === "after the handshake") tlsSocket.once(side === "server" ? "secure" : "secureConnect", soon);
      else soon();
    }
    function farEnd(raw: net.Socket) {
      quiet(raw);
      const start = () => (when === "after the handshake" ? quiet(wrap(side !== "server", raw)) : raw).resume();
      if (queued) raw.once("readable", () => (raw.read(3), start()));
      else start();
    }

    const onServerEnd = side === "server" ? underTest : farEnd;
    const onClientEnd = side === "server" ? farEnd : underTest;
    const overTLS = transport === "a TLS socket";
    const server = overTLS ? tls.createServer({ key, cert }, onServerEnd) : net.createServer(onServerEnd);
    const port = await listen(server);
    const relay = net.createServer({ allowHalfOpen: true }, client => {
      relayEnds.client = quiet(client);
      relayEnds.server = quiet(net.connect({ port, host: "127.0.0.1", allowHalfOpen: true }));
      client.pipe(relayEnds.server).pipe(client);
      relayed.resolve();
    });
    const dial = { port: await listen(relay), host: "127.0.0.1", rejectUnauthorized: false };
    const dialed: net.Socket = overTLS ? tls.connect(dial) : net.connect(dial);
    dialed.once(overTLS ? "secureConnect" : "connect", () => onClientEnd(dialed));
    try {
      return await result.promise;
    } finally {
      for (const socket of sockets) socket.destroy();
      relay.close();
      server.close();
    }
  }

  for (const transport of transports) {
    for (const side of ["client", "server"]) {
      for (const when of ["before the handshake completes", "after the handshake"]) {
        const early = when !== "after the handshake";
        // destroy(err) of the TLS socket itself: a server-side wrap still has its own first 'error' listener.
        const destroyedWith = (code: string) => [
          ...(side === "server" ? [`tls _tlsError ${code}`] : []),
          `tls error ${code}`,
          "raw close hadError=false",
          "tls close hadError=true",
        ];
        const forwarded = (code: string) => [
          `tls _tlsError ${code}`,
          ...(side === "client" ? [`tls error ${code}`] : []),
          `raw error ${code}`,
        ];
        const rows: [string, (raw: net.Socket, peer: net.Socket) => void, string[], boolean?][] = [
          // TLSWrap owns the reads: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L723-L727
          ["the peer resets the connection", (_raw, peer) => peer.resetAndDestroy(), destroyedWith("ECONNRESET")],
          [
            "the peer sends a FIN",
            (_raw, peer) => peer.end(),
            side === "client" && early
              ? destroyedWith("ECONNRESET")
              : ["raw close hadError=false", "tls close hadError=false"],
            // Bun's server-side wrap of an adopted fd reports a FIN ahead of the handshake as ECONNRESET.
            typeof Bun !== "undefined" && transport === transports[0] && side === "server" && early,
          ],
          [
            "destroy(err) of the wrapped socket",
            raw => raw.destroy(failure()),
            [...forwarded("TRANSPORT_FAILED"), "tls close hadError=false", "raw close hadError=true"],
          ],
          [
            "destroy() of the wrapped socket",
            raw => raw.destroy(),
            ["tls close hadError=false", "raw close hadError=false"],
          ],
        ];
        for (const [what, act, expected, skip] of rows) {
          const wrap = side === "server" ? "new TLSSocket(socket, { isServer })" : "tls.connect({ socket })";
          test(`${wrap} over ${transport}, ${when}: ${what}`, { skip }, async () => {
            const { added, events } = await behindRelay(transport, side, when, act);
            // When its owner destroys the wrapped socket, node closes the TLS socket first and Bun the wrapped one.
            const closes = what.startsWith("destroy") ? -2 : events.length;
            assert.deepStrictEqual(
              { added, events: [...events.slice(0, closes), ...events.slice(closes).sort().reverse()] },
              { added: 1, events: expected },
            );
          });
        }
      }
    }

    // Bun only: node throws it. A reset is reported to a socket that listens.
    test(
      `tls.connect({ socket }) over ${transport} with no 'error' listener: the peer resets the connection`,
      {
        skip: typeof Bun === "undefined",
      },
      async () => {
        const reset = (_raw: net.Socket, peer: net.Socket) => peer.resetAndDestroy();
        assert.deepStrictEqual(await behindRelay(transport, "client", "after the handshake", reset, false), {
          added: 1,
          events: ["raw close hadError=false", "tls close hadError=false"],
        });
      },
    );
  }
});

test("a FIN during the handshake of a TLS socket that is already wrapped is one 'error' on the TLS socket above it", async () => {
  const server = net.createServer({ allowHalfOpen: true }, peer => {
    peer.on("error", () => {}).once("data", () => peer.end());
  });
  const outer = tls.connect({ port: await listen(server), host: "127.0.0.1", rejectUnauthorized: false });
  // Bun also fails the inner ClientHello that is parked on it, as ERR_SOCKET_CLOSED. Node reports nothing here.
  outer.on("error", () => {});
  try {
    const inner = tls.connect({ socket: outer, rejectUnauthorized: false });
    let errors = 0;
    inner.on("secureConnect", () => assert.fail("secureConnect")).on("error", () => errors++);
    await new Promise(resolve => inner.on("close", resolve));
    // Past any error that is still queued.
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(errors, 1);
  } finally {
    outer.destroy();
    server.close();
  }
});

// The shape of https-proxy-agent. node:http reads the socket's _hadError to decide whether it still owes 'socket hang up'.
for (const when of ["during the handshake", "with the request in flight"]) {
  test(`an https request over tls.connect({ socket }) hangs up when the wrapped socket is destroyed ${when}`, async () => {
    const destroyRaw = () => void setImmediate(() => raw.destroy());
    const server =
      when === "during the handshake"
        ? net.createServer(peer => peer.on("error", () => {}).once("data", destroyRaw))
        : https.createServer({ key, cert }, destroyRaw);
    const raw = net.connect(await listen(server), "127.0.0.1");
    try {
      const events: string[] = [];
      const req = https.request({ createConnection: () => tls.connect({ socket: raw, rejectUnauthorized: false }) });
      req.on("response", () => events.push("response"));
      req.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code} ${err.message}`));
      req.end();
      await new Promise(resolve => req.on("close", resolve));
      assert.deepStrictEqual(events, ["error ECONNRESET socket hang up"]);
    } finally {
      raw.destroy();
      server.close();
    }
  });
}

test("a secureContext that is not one is refused by the constructor", () => {
  const invalid = { name: "TypeError", code: "ERR_TLS_INVALID_CONTEXT", message: "context must be a SecureContext" };
  for (const secureContext of [{ context: {} }, {}, tls.createSecureContext().context, "context"]) {
    for (const isServer of [true, false]) {
      assert.throws(() => new tls.TLSSocket(new net.Socket(), { isServer, secureContext }), invalid);
    }
    assert.throws(() => tls.connect({ port: 1, secureContext }), invalid);
  }
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const node = Bun.which("node");
  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", { timeout: 120_000 }, async () => {
      await using proc = Bun.spawn({
        // A test that hangs in Node.js fails by name instead of running this one out of time.
        cmd: [node!, "--test-timeout=15000", "--test-force-exit", import.meta.filename],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
