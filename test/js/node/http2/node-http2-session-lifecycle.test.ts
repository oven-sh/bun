/**
 * The lifecycle getters of Http2Session: `connecting`, `closed`, `destroyed` and `state`, and the
 * getters that node fills when the session takes its socket: `encrypted`, `alpnProtocol`,
 * `originSet`, `pendingSettingsAck`, `localSettings` and `remoteSettings`.
 *
 * A session has no native handle while it connects and after it is destroyed. node then reports an
 * empty `state` object. node keeps a client session `connecting` until the session took its socket:
 * through the TLS handshake, and until the session's own socket listener ran.
 * The expected values are node's (v24.21.0, v26.3.0 and v26.11.1 agree). Where Bun reports something
 * else, the test says so and why.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-session-lifecycle.test.ts
 *   node --test test/js/node/http2/node-http2-session-lifecycle.test.ts
 */
import assert from "node:assert";
import { once, type EventEmitter } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import { duplexPair } from "node:stream";
import { describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const isBun = typeof Bun !== "undefined";

const here = path.dirname(fileURLToPath(import.meta.url));
const keys = path.join(here, "..", "test", "fixtures", "keys");
const TLS = {
  key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
  cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
  ALPNProtocols: ["h2"],
};

type Session = http2.ClientHttp2Session | http2.ServerHttp2Session;
type Connect = (authority: string, options: http2.ClientSessionOptions) => Promise<http2.ClientHttp2Session>;

const sessionStateKeys = [
  "deflateDynamicTableSize",
  "effectiveLocalWindowSize",
  "effectiveRecvDataLength",
  "inflateDynamicTableSize",
  "lastProcStreamID",
  "localWindowSize",
  "nextStreamID",
  "outboundQueueSize",
  "remoteWindowSize",
];
// "empty" for {}, "populated" for the nine numeric fields, the value itself for anything else.
// The values of the nine fields are not compared.
function stateKind(state: unknown) {
  if (state === null || typeof state !== "object") return state;
  const fields = state as Record<string, unknown>;
  const names = Object.keys(fields).sort();
  if (names.length === 0) return "empty";
  if (names.join() === sessionStateKeys.join() && names.every(name => typeof fields[name] === "number")) {
    return "populated";
  }
  return state;
}
// "empty" for {}, "populated" for a settings object. The settings are not compared.
function settingsKind(settings: http2.Settings) {
  return Object.keys(settings).length === 0 ? "empty" : "populated";
}
function lifecycle(session: Session) {
  const getters = {
    connecting: session.connecting,
    closed: session.closed,
    destroyed: session.destroyed,
    state: stateKind(session.state),
  };
  // node keeps the last `localSettings` object of a destroyed session. Bun does not.
  if (session.destroyed) return getters;
  return {
    ...getters,
    localSettings: settingsKind(session.localSettings),
    remoteSettings: settingsKind(session.remoteSettings),
  };
}
const connecting = {
  connecting: true,
  closed: false,
  destroyed: false,
  state: "empty",
  localSettings: "empty",
  remoteSettings: "empty",
};
const ready = {
  connecting: false,
  closed: false,
  destroyed: false,
  state: "populated",
  localSettings: "populated",
  remoteSettings: "populated",
};
const destroyed = { connecting: false, closed: false, destroyed: true, state: "empty" };
const destroyedBeforeReady = { ...destroyed, connecting: true };
// For a session whose socket went away: node's socketOnClose also calls close(), and Bun does not
// yet (#42180). What `closed` reports then is not under test here.
function withoutClosed(getters: { closed: boolean; [name: string]: unknown }) {
  const others: { closed?: boolean; [name: string]: unknown } = { ...getters };
  delete others.closed;
  return others;
}

// What node's setupHandle writes when the session takes its socket.
function fromSocket(session: http2.ClientHttp2Session) {
  return {
    encrypted: session.encrypted,
    alpnProtocol: session.alpnProtocol,
    originSet: session.originSet,
    pendingSettingsAck: session.pendingSettingsAck,
  };
}
const notFromSocketYet = { encrypted: undefined, alpnProtocol: undefined, originSet: undefined };

// The 'connect', 'error' and 'close' events of a session, in the order it emits them.
function sessionEvents(session: EventEmitter) {
  const events: string[] = [];
  session.on("connect", () => events.push("connect"));
  session.on("error", (error: NodeJS.ErrnoException) => events.push(`error ${error.code}`));
  session.on("close", () => events.push("close"));
  return events;
}
// The code of every 'error' event that the emitter emits.
function errorCodes(emitter: EventEmitter) {
  const codes: unknown[] = [];
  emitter.on("error", (error: NodeJS.ErrnoException) => codes.push(error.code));
  return codes;
}
// Resolves on 'close'. Unlike once(), it does not reject when an 'error' event comes first.
function closeOf(emitter: EventEmitter) {
  return new Promise<void>(resolve => emitter.once("close", () => resolve()));
}
function immediate() {
  return new Promise<void>(resolve => setImmediate(resolve));
}
async function listen(server: net.Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as net.AddressInfo).port;
}
// An h2c server that answers every request at once. Every test ends the connection from the
// client side. What the server sessions and streams report about that is not under test.
async function h2cServer() {
  const server = http2.createServer();
  server.on("sessionError", () => {});
  server.on("stream", (stream: http2.ServerHttp2Stream) => {
    stream.on("error", () => {});
    stream.respond({ ":status": 200 }, { endStream: true });
  });
  return { server, port: await listen(server) };
}
// A peer that accepts the connection and never answers.
async function silentPeer() {
  const peer = net.createServer(socket => {
    socket.on("error", () => {});
    socket.resume();
  });
  return { peer, port: await listen(peer) };
}

describe("Http2Session lifecycle getters", () => {
  test("client: {} while it connects, populated from 'connect' until it is destroyed", async () => {
    const { server, port } = await h2cServer();
    const client = http2.connect(`http://127.0.0.1:${port}`);
    const errors = errorCodes(client);
    try {
      const seen: Record<string, unknown> = { afterConnectCall: lifecycle(client) };
      await once(client, "connect");
      seen.connectEvent = lifecycle(client);
      seen.sameObjectOnTwoReads = client.state === client.state;
      const closed = closeOf(client);
      client.close();
      seen.afterCloseCall = lifecycle(client);
      await closed;
      seen.closeEvent = lifecycle(client);
      assert.deepStrictEqual(
        { ...seen, errors },
        {
          afterConnectCall: connecting,
          connectEvent: ready,
          sameObjectOnTwoReads: false,
          afterCloseCall: { ...ready, closed: true },
          closeEvent: { ...destroyed, closed: true },
          errors: [],
        },
      );
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("client and server: {} after destroy()", async () => {
    const { server, port } = await h2cServer();
    const serverSessionCreated = once(server, "session");
    const client = http2.connect(`http://127.0.0.1:${port}`);
    const errors = errorCodes(client);
    const connected = once(client, "connect");
    try {
      const [serverSession] = (await serverSessionCreated) as [http2.ServerHttp2Session];
      const seen: Record<string, unknown> = { serverSessionEvent: lifecycle(serverSession) };
      await connected;
      const serverClosed = closeOf(serverSession);
      const clientClosed = closeOf(client);
      serverSession.destroy();
      seen.serverAfterDestroyCall = lifecycle(serverSession);
      client.destroy();
      seen.clientAfterDestroyCall = lifecycle(client);
      await serverClosed;
      seen.serverCloseEvent = lifecycle(serverSession);
      await clientClosed;
      seen.clientCloseEvent = lifecycle(client);
      assert.deepStrictEqual(
        { ...seen, errors },
        {
          serverSessionEvent: ready,
          serverAfterDestroyCall: destroyed,
          clientAfterDestroyCall: destroyed,
          serverCloseEvent: destroyed,
          clientCloseEvent: destroyed,
          errors: [],
        },
      );
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("client: close() while it connects, it never gets ready", async () => {
    const { server, port } = await h2cServer();
    const client = http2.connect(`http://127.0.0.1:${port}`);
    const errors = errorCodes(client);
    try {
      const closed = closeOf(client);
      client.close();
      // node destroys a session in close() when nothing is pending, and Bun destroys it later.
      // So `destroyed` is not compared here.
      const seen: Record<string, unknown> = {
        afterCloseCall: { connecting: client.connecting, closed: client.closed, state: stateKind(client.state) },
      };
      await closed;
      seen.closeEvent = lifecycle(client);
      seen.fromSocketAtCloseEvent = fromSocket(client);
      assert.deepStrictEqual(
        { ...seen, errors },
        {
          afterCloseCall: { connecting: true, closed: true, state: "empty" },
          closeEvent: { ...destroyedBeforeReady, closed: true },
          fromSocketAtCloseEvent: { ...notFromSocketYet, pendingSettingsAck: false },
          errors: [],
        },
      );
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("client: close() while it connects with a request queued, it gets ready", async () => {
    const { server, port } = await h2cServer();
    const client = http2.connect(`http://127.0.0.1:${port}`);
    const errors = errorCodes(client);
    const seen: Record<string, unknown> = {};
    // Added before the request, so it runs before the listener that rejects the request.
    client.once("connect", () => {
      seen.connectingAtConnectEvent = client.connecting;
    });
    try {
      const request = client.request({ ":path": "/" });
      const requestFailed = once(request, "error") as Promise<[NodeJS.ErrnoException]>;
      const closed = closeOf(client);
      client.close();
      seen.afterCloseCall = lifecycle(client);
      const [error] = await requestFailed;
      await closed;
      seen.closeEvent = lifecycle(client);
      assert.deepStrictEqual(
        { ...seen, requestError: error.code, errors },
        {
          connectingAtConnectEvent: false,
          afterCloseCall: { ...connecting, closed: true },
          closeEvent: { ...destroyed, closed: true },
          requestError: "ERR_HTTP2_GOAWAY_SESSION",
          errors: [],
        },
      );
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("client: destroyed before its socket connects, it stays connecting", async () => {
    const { server, port } = await h2cServer();
    const socket = net.connect(port, "127.0.0.1");
    const client = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
    const errors = errorCodes(client);
    try {
      // Added after the session's own listener, so the session handled the connect when it runs.
      const socketConnected = Promise.race([
        once(socket, "connect").then(() => lifecycle(client)),
        closeOf(socket).then(() => "the socket closed before it connected"),
      ]);
      const closed = closeOf(client);
      const socketClosed = closeOf(socket);
      client.destroy();
      const seen: Record<string, unknown> = { afterDestroyCall: lifecycle(client) };
      await closed;
      seen.closeEvent = lifecycle(client);
      seen.afterSocketConnect = await socketConnected;
      // destroy() ended the socket. Its 'close' finds a session that is destroyed already.
      await socketClosed;
      await immediate();
      seen.afterSocketClose = lifecycle(client);
      assert.deepStrictEqual(
        { ...seen, errors },
        {
          afterDestroyCall: destroyedBeforeReady,
          closeEvent: destroyedBeforeReady,
          afterSocketConnect: destroyedBeforeReady,
          afterSocketClose: destroyedBeforeReady,
          errors: [],
        },
      );
    } finally {
      client.destroy();
      socket.destroy();
      server.close();
    }
  });

  test("client: a refused connection leaves it connecting and destroyed", async () => {
    // The local port of a live connection: nothing listens on it, and no listen(0) of another
    // test can get it.
    const sink = net.createServer();
    const holder = net.connect(await listen(sink), "127.0.0.1");
    const [[accepted]] = (await Promise.all([once(sink, "connection"), once(holder, "connect")])) as [
      [net.Socket],
      unknown,
    ];
    const { port } = holder.address() as net.AddressInfo;
    const client = http2.connect(`http://127.0.0.1:${port}`);
    const seen: Record<string, unknown> = {};
    client.on("error", (error: NodeJS.ErrnoException) => {
      seen.errorEvent = { code: error.code, ...lifecycle(client) };
    });
    try {
      await closeOf(client);
      seen.closeEvent = lifecycle(client);
      assert.deepStrictEqual(seen, {
        errorEvent: { code: "ECONNREFUSED", ...destroyedBeforeReady },
        closeEvent: destroyedBeforeReady,
      });
    } finally {
      client.destroy();
      holder.destroy();
      accepted.destroy();
      sink.close();
    }
  });

  test("client: still connecting through the TLS handshake", async () => {
    const server = http2.createSecureServer(TLS);
    server.on("sessionError", () => {});
    const port = await listen(server);
    const socket = tls.connect({ host: "127.0.0.1", port, ALPNProtocols: ["h2"], rejectUnauthorized: false });
    const seen: Record<string, unknown> = {};
    // TCP is up and the handshake has not finished.
    socket.once("connect", () => {
      seen.tcpConnected = lifecycle(client);
    });
    const client = http2.connect(`https://127.0.0.1:${port}`, { createConnection: () => socket });
    const errors = errorCodes(client);
    // These two run after every listener that the session added to the socket.
    socket.once("connect", () => {
      seen.tcpConnectedAfterSession = lifecycle(client);
    });
    socket.once("secureConnect", () => {
      seen.handshakeDone = lifecycle(client);
    });
    try {
      await once(client, "connect");
      assert.deepStrictEqual(
        { ...seen, errors },
        { tcpConnected: connecting, tcpConnectedAfterSession: connecting, handshakeDone: ready, errors: [] },
      );
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("client: connecting until the session's own socket 'connect' listener ran", async () => {
    const { server, port } = await h2cServer();
    const socket = net.connect(port, "127.0.0.1");
    const seen: Record<string, unknown> = {};
    socket.once("connect", () => {
      seen.listenerAddedBeforeSession = lifecycle(client);
    });
    const client = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
    const errors = errorCodes(client);
    socket.once("connect", () => {
      seen.listenerAddedAfterSession = lifecycle(client);
    });
    try {
      await once(client, "connect");
      assert.deepStrictEqual(
        { ...seen, errors },
        { listenerAddedBeforeSession: connecting, listenerAddedAfterSession: ready, errors: [] },
      );
    } finally {
      client.destroy();
      server.close();
    }
  });

  const schemes = {
    https: { createServer: () => http2.createSecureServer(TLS), encrypted: true, alpnProtocol: "h2" },
    http: { createServer: () => http2.createServer(), encrypted: false, alpnProtocol: "h2c" },
  };
  for (const [scheme, { createServer, encrypted, alpnProtocol }] of Object.entries(schemes)) {
    test(`client: ${scheme}, what the session takes from its socket is undefined while it connects`, async () => {
      const server = createServer();
      server.on("sessionError", () => {});
      const port = await listen(server);
      const authority = `${scheme}://127.0.0.1:${port}`;
      const early = http2.connect(authority, { rejectUnauthorized: false });
      const client = http2.connect(authority, { rejectUnauthorized: false });
      const errors = { early: errorCodes(early), client: errorCodes(client) };
      try {
        // This read comes before the session has its socket. It must not fix the origin for later reads.
        const seen: Record<string, unknown> = { afterConnectCall: fromSocket(client) };
        // node counts the first SETTINGS frame from the time the session is ready, and this one at once.
        early.settings({ enablePush: false });
        seen.afterSettingsCall = fromSocket(early);
        const earlyClosed = closeOf(early);
        early.destroy();
        await once(client, "connect");
        seen.connectEvent = fromSocket(client);
        await earlyClosed;
        seen.destroyedBeforeReady = fromSocket(early);
        assert.deepStrictEqual(
          { ...seen, errors },
          {
            afterConnectCall: { ...notFromSocketYet, pendingSettingsAck: false },
            afterSettingsCall: { ...notFromSocketYet, pendingSettingsAck: true },
            connectEvent: {
              encrypted,
              alpnProtocol,
              originSet: encrypted ? [authority] : undefined,
              pendingSettingsAck: true,
            },
            destroyedBeforeReady: { ...notFromSocketYet, pendingSettingsAck: true },
            errors: { early: [], client: [] },
          },
        );
      } finally {
        early.destroy();
        client.destroy();
        server.close();
      }
    });
  }

  test("a session over a connected socket or a Duplex is ready at once", async () => {
    const { server, port } = await h2cServer();
    const socket = net.connect(port, "127.0.0.1");
    const [clientSide, serverSide] = duplexPair();
    const sessions: Session[] = [];
    const seen: unknown[] = [];
    const errors: unknown[][] = [];
    const connects: Promise<unknown>[] = [];
    // Bun can run the queued ticks while it constructs a session. So a session gets its 'connect'
    // listener before the next session is made.
    const add = (session: Session) => {
      sessions.push(session);
      seen.push({ ...lifecycle(session), encrypted: session.encrypted });
      errors.push(errorCodes(session));
      connects.push(once(session, "connect"));
    };
    try {
      await once(socket, "connect");
      add(http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket }));
      add(http2.performServerHandshake(serverSide));
      add(http2.connect("http://localhost", { createConnection: () => clientSide }));
      // Every session emits 'connect' on a tick, and an immediate runs after every tick.
      const all = Promise.all(connects).then(() => "all");
      const connectEvents = await Promise.race([all, immediate().then(() => "not all")]);
      const readyAtOnce = { ...ready, encrypted: false };
      assert.deepStrictEqual(
        { seen, errors, connectEvents },
        { seen: [readyAtOnce, readyAtOnce, readyAtOnce], errors: [[], [], []], connectEvents: "all" },
      );
    } finally {
      for (const session of sessions) session.destroy();
      socket.destroy();
      server.close();
    }
  });

  test("state is an accessor of the prototype that client and server sessions share", async () => {
    const { server, port } = await h2cServer();
    const serverSessionCreated = once(server, "session");
    const client = http2.connect(`http://127.0.0.1:${port}`);
    const errors = errorCodes(client);
    try {
      const [serverSession] = (await serverSessionCreated) as [http2.ServerHttp2Session];
      const clientPrototype = Object.getPrototypeOf(client);
      const serverPrototype = Object.getPrototypeOf(serverSession);
      const shared = Object.getPrototypeOf(clientPrototype);
      const getterOnShared = (name: string) => typeof Object.getOwnPropertyDescriptor(shared, name)?.get;
      // node defines `closed` and `destroyed` there too, and `connecting` for a server session.
      // Bun defines these on each of the two classes.
      assert.deepStrictEqual(
        {
          sharedPrototype: Object.getPrototypeOf(serverPrototype) === shared,
          onShared: { state: getterOnShared("state"), connecting: getterOnShared("connecting") },
          onClient: ["connecting", "state"].filter(name => Object.hasOwn(clientPrototype, name)),
          stateOnServer: Object.hasOwn(serverPrototype, "state"),
          errors,
        },
        {
          sharedPrototype: true,
          onShared: { state: "function", connecting: "function" },
          onClient: [],
          stateOnServer: false,
          errors: [],
        },
      );
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("pendingSettingsAck is true until the peer acknowledged every SETTINGS frame", async () => {
    const server = http2.createServer();
    server.on("sessionError", () => {});
    const seen = { client: [] as boolean[], server: [] as boolean[] };
    const { promise: serverAcked, resolve: onServerAcked } = Promise.withResolvers<void>();
    const { promise: clientAcked, resolve: onClientAcked } = Promise.withResolvers<void>();
    // Each side sends three SETTINGS frames: the first one of the session, and two more at once.
    server.on("session", (session: http2.ServerHttp2Session) => {
      session.settings({ maxConcurrentStreams: 10 });
      session.settings({ maxConcurrentStreams: 11 });
      session.on("localSettings", () => {
        if (seen.server.push(session.pendingSettingsAck) === 3) onServerAcked();
      });
    });
    const port = await listen(server);
    const client = http2.connect(`http://127.0.0.1:${port}`);
    const errors = errorCodes(client);
    client.once("connect", () => {
      client.settings({ enablePush: false });
      client.settings({ initialWindowSize: 70000 });
    });
    client.on("localSettings", () => {
      if (seen.client.push(client.pendingSettingsAck) === 3) onClientAcked();
    });
    try {
      await Promise.all([clientAcked, serverAcked]);
      assert.deepStrictEqual(
        { ...seen, errors },
        { client: [true, true, false], server: [true, true, false], errors: [] },
      );
    } finally {
      client.destroy();
      server.close();
    }
  });

  // A session whose socket closes, with no error, before the session is ready.
  // node (v20.19.3, v22.16.0 and later) reports the lost socket: 'close', then ERR_SOCKET_CLOSED and
  // a second 'close'. Bun emits one 'close' and no error, as node did before. The five tests that
  // follow fail if a change to the getters starts to report the lost socket by accident.
  const socketClosedBeforeReady = isBun ? ["close"] : ["close", "error ERR_SOCKET_CLOSED", "close"];
  // A client socket that is closed before its session is ready: a TCP socket before it connects,
  // a TLS socket at the TCP connect, when the handshake has only started.
  const earlySockets = {
    "a TCP socket": (port: number) => net.connect(port, "127.0.0.1"),
    "a TLS socket": (port: number) =>
      tls.connect({ host: "127.0.0.1", port, ALPNProtocols: ["h2"], rejectUnauthorized: false }),
  };
  function closeBeforeReady(socket: net.Socket) {
    if (socket instanceof tls.TLSSocket) socket.once("connect", () => socket.destroy());
    else socket.destroy();
    return closeOf(socket);
  }
  for (const [kind, connect] of Object.entries(earlySockets)) {
    const scheme = kind === "a TLS socket" ? "https" : "http";

    test(`client: ${kind} that closes before the session is ready leaves it connecting`, async () => {
      const { peer, port } = await silentPeer();
      const socket = connect(port);
      const client = http2.connect(`${scheme}://127.0.0.1:${port}`, { createConnection: () => socket });
      const events = sessionEvents(client);
      try {
        await closeBeforeReady(socket);
        await immediate();
        assert.deepStrictEqual(
          { events, ...withoutClosed(lifecycle(client)) },
          { events: socketClosedBeforeReady, ...withoutClosed(destroyedBeforeReady) },
        );
      } finally {
        client.destroy();
        peer.close();
      }
    });

    test(`client: a promisified connect() when ${kind} closes before the session is ready`, async () => {
      const { peer, port } = await silentPeer();
      const socket = connect(port);
      try {
        // The types do not declare the signature of connect[util.promisify.custom].
        const connectSession = promisify(http2.connect) as unknown as Connect;
        const outcome = connectSession(`${scheme}://127.0.0.1:${port}`, { createConnection: () => socket }).then(
          session => {
            session.destroy();
            return "connected";
          },
          (error: NodeJS.ErrnoException) => error.code,
        );
        await closeBeforeReady(socket);
        // node rejects from a tick, and an immediate runs after every tick. Bun reports no error.
        assert.strictEqual(
          await Promise.race([outcome, immediate().then(() => "still pending")]),
          isBun ? "still pending" : "ERR_SOCKET_CLOSED",
        );
      } finally {
        socket.destroy();
        peer.close();
      }
    });
  }

  test("server: a session whose socket closes before it connects", async () => {
    const { peer, port } = await silentPeer();
    const h2 = http2.createServer();
    const sessionErrors: unknown[] = [];
    h2.on("sessionError", (error: NodeJS.ErrnoException) => sessionErrors.push(error.code));
    const socket = net.connect(port, "127.0.0.1");
    const sessions: http2.ServerHttp2Session[] = [];
    h2.on("session", (session: http2.ServerHttp2Session) => sessions.push(session));
    // The server emits 'session' before emit() returns.
    h2.emit("connection", socket);
    try {
      await closeBeforeReady(socket);
      await immediate();
      assert.deepStrictEqual(
        { sessions: sessions.length, sessionErrors },
        { sessions: 1, sessionErrors: isBun ? [] : ["ERR_SOCKET_CLOSED"] },
      );
    } finally {
      for (const session of sessions) session.destroy();
      peer.close();
    }
  });

  test("client: no error for destroy() while it connects, or for a socket that closes once it is ready", async () => {
    const { server, port } = await h2cServer();
    const socket = net.connect(port, "127.0.0.1");
    const destroyedEarly = http2.connect(`http://127.0.0.1:${port}`);
    const lostSocket = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
    const errors = { destroyedEarly: errorCodes(destroyedEarly), lostSocket: errorCodes(lostSocket) };
    try {
      const destroyedEarlyClosed = closeOf(destroyedEarly);
      destroyedEarly.destroy();
      await once(lostSocket, "connect");
      const lostSocketClosed = closeOf(lostSocket);
      socket.destroy();
      await Promise.all([destroyedEarlyClosed, lostSocketClosed]);
      await immediate();
      assert.deepStrictEqual(errors, { destroyedEarly: [], lostSocket: [] });
    } finally {
      destroyedEarly.destroy();
      lostSocket.destroy();
      server.close();
    }
  });

  // What the session reports to the 'aborted' listener of a request that waits for a stream slot,
  // when the socket of the session goes away.
  async function waitingRequestAborted(socketError: Error | undefined) {
    const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
    server.on("sessionError", () => {});
    // The response stays open, so the one stream slot stays taken.
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
    });
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    const client = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
    const errors = errorCodes(client);
    try {
      await once(client, "remoteSettings");
      // What the two requests report is not under test.
      const active = client.request({ ":method": "POST", ":path": "/" });
      active.on("error", () => {});
      await once(active, "response");
      const waiting = client.request({ ":method": "POST", ":path": "/" });
      waiting.on("error", () => {});
      const seen: Record<string, unknown> = {};
      waiting.on("aborted", () => {
        seen.waitingAborted = withoutClosed(lifecycle(client));
      });
      const closed = closeOf(client);
      socket.destroy(socketError);
      await closed;
      return { ...seen, errors };
    } finally {
      client.destroy();
      server.close();
    }
  }

  test("client: a request that waits for a stream slot reads {} when the socket fails", async () => {
    const error = Object.assign(new Error("the socket failed"), { code: "ESOCKETFAILED" });
    assert.deepStrictEqual(await waitingRequestAborted(error), {
      waitingAborted: withoutClosed(destroyed),
      errors: ["ESOCKETFAILED"],
    });
  });

  test("client: a request that waits for a stream slot reads the state when the socket closes", async () => {
    assert.deepStrictEqual(await waitingRequestAborted(undefined), {
      // node's nghttp2 holds the request, and node cancels it while the session has its handle.
      // Bun holds the request itself, and cancels it after it dropped the parser.
      waitingAborted: withoutClosed(isBun ? { ...ready, state: "empty" } : ready),
      errors: [],
    });
  });

  test("server: connecting and without settings until its socket connects", async () => {
    const { peer, port } = await silentPeer();
    const socket = net.connect(port, "127.0.0.1");
    const session = http2.performServerHandshake(socket);
    const errors = errorCodes(session);
    // `state` is not compared: node has no handle until the socket connects, Bun has one at once.
    const read = () => ({
      connecting: session.connecting,
      localSettings: settingsKind(session.localSettings),
      remoteSettings: settingsKind(session.remoteSettings),
      pendingSettingsAck: session.pendingSettingsAck,
    });
    try {
      const seen: Record<string, unknown> = { afterHandshakeCall: read() };
      await once(socket, "connect");
      seen.socketConnected = read();
      assert.deepStrictEqual(
        { ...seen, errors },
        {
          afterHandshakeCall: {
            connecting: true,
            localSettings: "empty",
            remoteSettings: "empty",
            pendingSettingsAck: false,
          },
          socketConnected: {
            connecting: false,
            localSettings: "populated",
            remoteSettings: "populated",
            pendingSettingsAck: true,
          },
          errors: [],
        },
      );
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // The socket of a server session is connected in each of these, so node sets the session up in its constructor.
  const acceptPaths: Record<string, () => { h2: http2.Http2Server | http2.Http2SecureServer; front: net.Server }> = {
    "http2.createServer()": () => {
      const h2 = http2.createServer();
      return { h2, front: h2 };
    },
    "http2.createSecureServer()": () => {
      const h2 = http2.createSecureServer(TLS);
      return { h2, front: h2 };
    },
    "a net.Server that forwards with emit('connection')": () => {
      const h2 = http2.createSecureServer(TLS);
      return { h2, front: net.createServer(socket => h2.emit("connection", socket)) };
    },
    "a tls.Server that forwards with emit('secureConnection')": () => {
      const h2 = http2.createSecureServer(TLS);
      return { h2, front: tls.createServer(TLS, socket => h2.emit("secureConnection", socket)) };
    },
  };
  for (const [name, accept] of Object.entries(acceptPaths)) {
    test(`server: ready at the 'session' event, ${name}`, async () => {
      const { h2, front } = accept();
      const seen: Record<string, unknown> = {};
      h2.on("sessionError", () => {});
      h2.on("session", (session: http2.ServerHttp2Session) => {
        seen.sessionEvent = lifecycle(session);
        session.once("connect", () => {
          seen.connectEvent = lifecycle(session);
        });
      });
      h2.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        seen.streamEvent = {
          ...lifecycle(stream.session as http2.ServerHttp2Session),
          pushAllowed: stream.pushAllowed,
        };
        stream.respond({ ":status": 200 }, { endStream: true });
      });
      const port = await listen(front);
      const scheme = name === "http2.createServer()" ? "http" : "https";
      const client = http2.connect(`${scheme}://127.0.0.1:${port}`, { rejectUnauthorized: false });
      const errors = errorCodes(client);
      try {
        const [headers] = await once(client.request({ ":path": "/" }), "response");
        assert.deepStrictEqual(
          { ...seen, status: headers[":status"], errors },
          {
            sessionEvent: ready,
            connectEvent: ready,
            streamEvent: { ...ready, pushAllowed: true },
            status: 200,
            errors: [],
          },
        );
      } finally {
        client.destroy();
        front.close();
      }
    });
  }

  test("server: no error for a socket that closes once the session is ready", async () => {
    const { promise: accepted, resolve: onAccepted } = Promise.withResolvers<net.Socket>();
    const front = net.createServer(onAccepted);
    const port = await listen(front);
    // The peer connects and never speaks HTTP/2.
    const peerSocket = net.connect(port, "127.0.0.1");
    peerSocket.on("error", () => {});
    const socket = await accepted;
    const session = http2.performServerHandshake(socket);
    const events = sessionEvents(session);
    try {
      await once(session, "connect");
      const closed = closeOf(session);
      socket.destroy();
      await closed;
      await immediate();
      assert.deepStrictEqual(
        { events, ...lifecycle(session) },
        { events: ["connect", "close"], ...destroyed, closed: true },
      );
    } finally {
      session.destroy();
      peerSocket.destroy();
      front.close();
    }
  });
});

if (typeof Bun !== "undefined") {
  const node = Bun.which("node");
  // Alpine's node segfaults at a random point of an http2 test file (see node-http2-client-close.test.ts),
  // and the CI runner fails a file for any new core dump. The report names a glibc version only on glibc.
  const { header } = process.report.getReport() as { header: { osName: string; glibcVersionRuntime?: string } };
  const muslLibc = header.osName === "Linux" && !header.glibcVersionRuntime;
  describe("Node.js compatibility", () => {
    test("tests should run on node.js", { skip: !node || muslLibc }, async () => {
      await using proc = Bun.spawn({
        cmd: [node as string, "--test", import.meta.filename],
        stdout: "inherit",
        stderr: "inherit",
        stdin: "ignore",
      });
      assert.strictEqual(await proc.exited, 0);
    });
  });
}
