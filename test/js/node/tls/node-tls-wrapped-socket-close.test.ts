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
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
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

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const node = Bun.which("node");
  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      await using proc = Bun.spawn({
        cmd: [node!, import.meta.filename],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
