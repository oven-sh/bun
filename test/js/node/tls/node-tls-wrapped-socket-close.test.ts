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
import { readFileSync } from "node:fs";
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
