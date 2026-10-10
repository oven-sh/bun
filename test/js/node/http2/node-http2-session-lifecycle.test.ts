/**
 * The lifecycle getters of Http2Session: `connecting`, `closed`, `destroyed` and `state`.
 *
 * A session has no native handle while it connects and after it is destroyed. node then reports an
 * empty `state` object. node keeps a session `connecting` until the session took its socket: through
 * the TLS handshake, and until the session's own socket listener ran. A socket that closes before
 * that gives the session an ERR_SOCKET_CLOSED error.
 * The expected values are node's (v24.21.0, v26.3.0 and v26.11.1 agree). Where Bun reports something
 * else, the test says so and why.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-session-lifecycle.test.ts
 *   node --test test/js/node/http2/node-http2-session-lifecycle.test.ts
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
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
function lifecycle(session: Session) {
  return {
    connecting: session.connecting,
    closed: session.closed,
    destroyed: session.destroyed,
    state: stateKind(session.state),
  };
}
const connecting = { connecting: true, closed: false, destroyed: false, state: "empty" };
const ready = { connecting: false, closed: false, destroyed: false, state: "populated" };
const destroyed = { connecting: false, closed: false, destroyed: true, state: "empty" };
const destroyedBeforeReady = { ...destroyed, connecting: true };

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

// A session whose socket closes, with no error, before the session is ready.
// node's socketOnClose first closes the session, which destroys an idle session ('close').
// Then it reports the lost socket, with a second 'close', one tick later.
// Bun reports the error from destroy(error), inside the socket's 'close' event (#38195 moves it
// to a tick, and leaves the order).
const socketClosedBeforeReady = isBun
  ? ["error ERR_SOCKET_CLOSED", "close"]
  : ["close", "error ERR_SOCKET_CLOSED", "close"];

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

  test("client: close() while it connects", async () => {
    const { server, port } = await h2cServer();
    const client = http2.connect(`http://127.0.0.1:${port}`);
    const errors = errorCodes(client);
    try {
      const closed = closeOf(client);
      client.close();
      const seen: Record<string, unknown> = { afterCloseCall: lifecycle(client) };
      await closed;
      seen.closeEvent = lifecycle(client);
      assert.deepStrictEqual(
        { ...seen, errors },
        {
          // node destroys a session in close() when nothing is pending, so the session never
          // gets ready. Bun destroys it after the socket connected.
          afterCloseCall: { connecting: true, closed: true, destroyed: !isBun, state: "empty" },
          closeEvent: { connecting: !isBun, closed: true, destroyed: true, state: "empty" },
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
      client.destroy();
      const seen: Record<string, unknown> = { afterDestroyCall: lifecycle(client) };
      await closed;
      seen.closeEvent = lifecycle(client);
      seen.afterSocketConnect = await socketConnected;
      assert.deepStrictEqual(
        { ...seen, errors },
        {
          afterDestroyCall: destroyedBeforeReady,
          closeEvent: destroyedBeforeReady,
          afterSocketConnect: destroyedBeforeReady,
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
    // A port that was just released: nothing listens on it.
    const released = net.createServer();
    const port = await listen(released);
    released.close();
    await once(released, "close");
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
      seen.tcpConnected = {
        ...lifecycle(client),
        localSettings: client.localSettings,
        remoteSettings: client.remoteSettings,
      };
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
        {
          tcpConnected: { ...connecting, localSettings: {}, remoteSettings: {} },
          tcpConnectedAfterSession: connecting,
          handshakeDone: ready,
          errors: [],
        },
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

  // Sessions that are ready at once: what each reports after its constructor, its 'error' codes,
  // and whether each emits 'connect' on a tick (an immediate runs after every tick).
  // Bun can run the queued ticks while it constructs a session. So a session gets its 'connect'
  // listener before the next session is made.
  function readySessions() {
    const sessions: Session[] = [];
    const seen: unknown[] = [];
    const errors: unknown[][] = [];
    const connects: Promise<unknown>[] = [];
    return {
      sessions,
      add(session: Session) {
        sessions.push(session);
        seen.push(lifecycle(session));
        errors.push(errorCodes(session));
        connects.push(once(session, "connect"));
      },
      async result() {
        const all = Promise.all(connects).then(() => "all");
        return { seen, errors, connectEvents: await Promise.race([all, immediate().then(() => "not all")]) };
      },
    };
  }

  test("a session over a connected socket or a Duplex is ready at once", async () => {
    const { server, port } = await h2cServer();
    const socket = net.connect(port, "127.0.0.1");
    const [clientSide, serverSide] = duplexPair();
    const made = readySessions();
    try {
      await once(socket, "connect");
      made.add(http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket }));
      made.add(http2.performServerHandshake(serverSide));
      made.add(http2.connect("http://localhost", { createConnection: () => clientSide }));
      assert.deepStrictEqual(await made.result(), {
        seen: [ready, ready, ready],
        errors: [[], [], []],
        connectEvents: "all",
      });
    } finally {
      for (const session of made.sessions) session.destroy();
      socket.destroy();
      server.close();
    }
  });

  // node wraps a stream that is not a net.Socket, and never reads these two properties from it.
  for (const flag of ["connecting", "secureConnecting"]) {
    test(`a session over a Duplex that has a true \`${flag}\` property is ready at once`, async () => {
      const h2 = http2.createServer();
      h2.on("sessionError", () => {});
      const pairs = [duplexPair(), duplexPair()];
      for (const pair of pairs) for (const side of pair) Object.assign(side, { [flag]: true });
      const [[clientSide, serverSide], [otherClientSide, otherServerSide]] = pairs;
      const made = readySessions();
      h2.on("session", made.add);
      try {
        // The server emits 'session' before emit() returns.
        h2.emit("connection", otherServerSide);
        made.add(http2.performServerHandshake(serverSide));
        made.add(http2.connect("http://localhost", { createConnection: () => clientSide }));
        made.add(http2.connect("http://localhost", { createConnection: () => otherClientSide }));
        assert.deepStrictEqual(await made.result(), {
          seen: [ready, ready, ready, ready],
          errors: [[], [], [], []],
          connectEvents: "all",
        });
      } finally {
        for (const session of made.sessions) session.destroy();
      }
    });
  }

  test("connecting and state are accessors of the prototype that client and server sessions share", async () => {
    const { server, port } = await h2cServer();
    const serverSessionCreated = once(server, "session");
    const client = http2.connect(`http://127.0.0.1:${port}`);
    const errors = errorCodes(client);
    try {
      const [serverSession] = (await serverSessionCreated) as [http2.ServerHttp2Session];
      const clientPrototype = Object.getPrototypeOf(client);
      const serverPrototype = Object.getPrototypeOf(serverSession);
      const shared = Object.getPrototypeOf(clientPrototype);
      // node defines `closed` and `destroyed` there too. Bun defines them on each of the two classes.
      const names = ["connecting", "state"];
      assert.deepStrictEqual(
        {
          sharedPrototype: Object.getPrototypeOf(serverPrototype) === shared,
          onShared: names.map(name => typeof Object.getOwnPropertyDescriptor(shared, name)?.get),
          onClient: names.filter(name => Object.hasOwn(clientPrototype, name)),
          onServer: names.filter(name => Object.hasOwn(serverPrototype, name)),
          errors,
        },
        { sharedPrototype: true, onShared: ["function", "function"], onClient: [], onServer: [], errors: [] },
      );
    } finally {
      client.destroy();
      server.close();
    }
  });

  for (const [kind, connect] of Object.entries(earlySockets)) {
    const scheme = kind === "a TLS socket" ? "https" : "http";

    test(`client: ${kind} that closes before the session is ready gives ERR_SOCKET_CLOSED`, async () => {
      const { peer, port } = await silentPeer();
      const socket = connect(port);
      const client = http2.connect(`${scheme}://127.0.0.1:${port}`, { createConnection: () => socket });
      const events = sessionEvents(client);
      try {
        await closeBeforeReady(socket);
        await immediate();
        assert.deepStrictEqual(
          { events, ...lifecycle(client) },
          // node's socketOnClose also calls close(). Bun leaves `closed` false (#42180).
          { events: socketClosedBeforeReady, ...destroyedBeforeReady, closed: !isBun },
        );
      } finally {
        client.destroy();
        peer.close();
      }
    });

    test(`client: a promisified connect() rejects when ${kind} closes before the session is ready`, async () => {
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
        // The rejection comes from a tick. An immediate runs after every tick.
        assert.strictEqual(await Promise.race([outcome, immediate().then(() => "still pending")]), "ERR_SOCKET_CLOSED");
      } finally {
        socket.destroy();
        peer.close();
      }
    });
  }

  test("client: a queued request is canceled with ERR_SOCKET_CLOSED as its cause", async () => {
    const { peer, port } = await silentPeer();
    const socket = net.connect(port, "127.0.0.1");
    const client = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
    const errors = errorCodes(client);
    try {
      const request = client.request({ ":path": "/" });
      const requestFailed = once(request, "error") as Promise<[NodeJS.ErrnoException]>;
      const closed = closeOf(client);
      socket.destroy();
      const [error] = await requestFailed;
      await closed;
      await immediate();
      // The order of the two 'error' events is not compared: node emits the request's first,
      // Bun the session's (#38195).
      assert.deepStrictEqual(
        {
          code: error.code,
          message: error.message,
          cause: (error.cause as NodeJS.ErrnoException | undefined)?.code,
          errors,
        },
        {
          code: "ERR_HTTP2_STREAM_CANCEL",
          message: "The pending stream has been canceled (caused by: Socket is closed)",
          cause: "ERR_SOCKET_CLOSED",
          errors: ["ERR_SOCKET_CLOSED"],
        },
      );
    } finally {
      client.destroy();
      peer.close();
    }
  });

  // A debug build of Bun needs about four seconds to start and to load node:http2.
  test("client: with no 'error' listener, the lost socket ends the process", { timeout: 60_000 }, async () => {
    const fixture = path.join(here, "http2-socket-closed-unobserved.fixture.js");
    const child = spawn(process.execPath, [fixture], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    // The runtime prints the uncaught error there. The fixture reports its code on stdout.
    child.stderr.resume();
    const [exitCode, signal] = await (once(child, "close") as Promise<[number | null, string | null]>);
    assert.deepStrictEqual(
      { stdout: stdout.trim().split("\n"), exitCode, signal },
      {
        stdout: isBun
          ? // The throw leaves destroy(error) inside the socket's 'close' event (#38195).
            ["uncaught ERR_SOCKET_CLOSED"]
          : ["socket 'close' listener added after the session", "session 'close'", "uncaught ERR_SOCKET_CLOSED"],
        exitCode: 1,
        signal: null,
      },
    );
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
        seen.waitingAborted = lifecycle(client);
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
      waitingAborted: destroyed,
      errors: ["ESOCKETFAILED"],
    });
  });

  test("client: a request that waits for a stream slot reads the state when the socket closes", async () => {
    assert.deepStrictEqual(await waitingRequestAborted(undefined), {
      // node's nghttp2 holds the request, and node cancels it while the session has its handle.
      // Bun holds the request itself, and cancels it after it dropped the parser.
      waitingAborted: isBun ? { ...ready, state: "empty" } : ready,
      errors: [],
    });
  });

  // The socket of a server session is connected in each of these, so node sets the session up in its constructor.
  const forwardedRawSocket = "a net.Server that forwards with emit('connection')";
  const acceptPaths: Record<string, () => { h2: http2.Http2Server | http2.Http2SecureServer; front: net.Server }> = {
    "http2.createServer()": () => {
      const h2 = http2.createServer();
      return { h2, front: h2 };
    },
    "http2.createSecureServer()": () => {
      const h2 = http2.createSecureServer(TLS);
      return { h2, front: h2 };
    },
    [forwardedRawSocket]: () => {
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
      const order: string[] = [];
      h2.on("sessionError", () => {});
      h2.on("session", (session: http2.ServerHttp2Session) => {
        seen.sessionEvent = lifecycle(session);
        session.once("connect", () => {
          order.push("connect");
          seen.connectEvent = lifecycle(session);
        });
      });
      h2.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        order.push("stream");
        seen.streamEvent = {
          ...lifecycle(stream.session as http2.ServerHttp2Session),
          remoteSettingsCount: Object.keys(stream.session!.remoteSettings).length > 0 ? "some" : "none",
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
          { ...seen, order, status: headers[":status"], errors },
          {
            sessionEvent: ready,
            connectEvent: ready,
            streamEvent: { ...ready, remoteSettingsCount: "some", pushAllowed: true },
            // Bun runs the TLS engine of a forwarded raw socket on a stream. It hands over the
            // first request in the same turn as the end of the handshake, before the tick that
            // emits 'connect'.
            order: isBun && name === forwardedRawSocket ? ["stream", "connect"] : ["connect", "stream"],
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

  test("server: connecting until its socket connects", async () => {
    const { peer, port } = await silentPeer();
    const socket = net.connect(port, "127.0.0.1");
    const session = http2.performServerHandshake(socket);
    const errors = errorCodes(session);
    try {
      const seen: Record<string, unknown> = { afterHandshakeCall: lifecycle(session) };
      socket.once("connect", () => {
        seen.socketConnected = lifecycle(session);
      });
      await once(session, "connect");
      seen.connectEvent = lifecycle(session);
      assert.deepStrictEqual(
        { ...seen, errors },
        { afterHandshakeCall: connecting, socketConnected: ready, connectEvent: ready, errors: [] },
      );
    } finally {
      session.destroy();
      peer.close();
    }
  });

  test("server: a session that the server makes from a connecting socket is connecting at 'session'", async () => {
    const { peer, port } = await silentPeer();
    const h2 = http2.createServer();
    h2.on("sessionError", () => {});
    const socket = net.connect(port, "127.0.0.1");
    const sessions: http2.ServerHttp2Session[] = [];
    h2.on("session", (session: http2.ServerHttp2Session) => sessions.push(session));
    // The server emits 'session' before emit() returns.
    h2.emit("connection", socket);
    const [session] = sessions;
    const errors = errorCodes(session);
    try {
      const seen: Record<string, unknown> = { sessionEvent: lifecycle(session) };
      await once(session, "connect");
      seen.connectEvent = lifecycle(session);
      assert.deepStrictEqual({ ...seen, errors }, { sessionEvent: connecting, connectEvent: ready, errors: [] });
    } finally {
      session.destroy();
      peer.close();
    }
  });

  test("server: connecting through the handshake of a tls.connect() socket", async () => {
    // Completes the handshake and never speaks HTTP/2.
    const peer = tls.createServer(TLS, socket => {
      socket.on("error", () => {});
      socket.resume();
    });
    const port = await listen(peer);
    const socket = tls.connect({ host: "127.0.0.1", port, ALPNProtocols: ["h2"], rejectUnauthorized: false });
    const seen: Record<string, unknown> = {};
    socket.once("secureConnect", () => {
      seen.handshakeDoneBeforeSession = lifecycle(session);
    });
    const session = http2.performServerHandshake(socket);
    const errors = errorCodes(session);
    try {
      seen.afterHandshakeCall = lifecycle(session);
      socket.once("connect", () => {
        seen.tcpConnected = lifecycle(session);
      });
      socket.once("secureConnect", () => {
        seen.handshakeDone = lifecycle(session);
      });
      await once(session, "connect");
      seen.connectEvent = lifecycle(session);
      assert.deepStrictEqual(
        { ...seen, errors },
        {
          handshakeDoneBeforeSession: connecting,
          afterHandshakeCall: connecting,
          tcpConnected: connecting,
          handshakeDone: ready,
          connectEvent: ready,
          errors: [],
        },
      );
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // node waits for 'secureConnect', and a TLSSocket that wraps a socket emits none: node never
  // sets the sessions of the next three tests up. Bun does.
  test("server: ready when a client-side TLSSocket finishes its handshake", { skip: !isBun }, async () => {
    // Completes the handshake and never speaks HTTP/2.
    const peer = tls.createServer(TLS, socket => {
      socket.on("error", () => {});
      socket.resume();
    });
    const port = await listen(peer);
    const rawSocket = net.connect(port, "127.0.0.1");
    await once(rawSocket, "connect");
    const socket = new tls.TLSSocket(rawSocket, { ALPNProtocols: ["h2"], rejectUnauthorized: false });
    const session = http2.performServerHandshake(socket);
    const errors = errorCodes(session);
    try {
      const seen: Record<string, unknown> = { afterHandshakeCall: lifecycle(session) };
      session.once("connect", () => {
        seen.connectEvent = lifecycle(session);
      });
      // The end of the handshake. The session emits 'connect' one tick later.
      await once(socket, "secure");
      await immediate();
      assert.deepStrictEqual({ ...seen, errors }, { afterHandshakeCall: connecting, connectEvent: ready, errors: [] });
    } finally {
      session.destroy();
      peer.close();
    }
  });

  const serverSideWraps = {
    "a socket": {
      wrap: (rawSocket: net.Socket) => new tls.TLSSocket(rawSocket, { isServer: true, ...TLS }),
      order: ["connect", "stream"],
    },
    // The TLS engine runs on a stream here. It hands over the first request in the same turn as
    // the end of the handshake, before the tick that emits 'connect'.
    "a Duplex": {
      wrap: (rawSocket: net.Socket) => {
        const [near, far] = duplexPair();
        rawSocket.pipe(far).pipe(rawSocket);
        rawSocket.on("close", () => far.destroy());
        return new tls.TLSSocket(near, { isServer: true, ...TLS });
      },
      order: ["stream", "connect"],
    },
  };
  for (const [transport, { wrap, order: expectedOrder }] of Object.entries(serverSideWraps)) {
    test(
      `server: ready when a server-side TLSSocket over ${transport} finishes its handshake`,
      { skip: !isBun },
      async () => {
        const seen: Record<string, unknown> = {};
        const order: string[] = [];
        const front = net.createServer(rawSocket => {
          const session = http2.performServerHandshake(wrap(rawSocket));
          seen.serverErrors = errorCodes(session);
          seen.afterHandshakeCall = lifecycle(session);
          session.once("connect", () => {
            order.push("connect");
            seen.connectEvent = lifecycle(session);
          });
          session.on("stream", stream => {
            stream.on("error", () => {});
            order.push("stream");
            seen.streamEvent = { ...lifecycle(session), pushAllowed: stream.pushAllowed };
            stream.respond({ ":status": 200 }, { endStream: true });
          });
        });
        const port = await listen(front);
        const client = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
        const errors = errorCodes(client);
        try {
          const request = client.request({ ":path": "/" });
          const [headers] = await once(request, "response");
          request.resume();
          await once(request, "close");
          assert.deepStrictEqual(
            { ...seen, order, status: headers[":status"], errors },
            {
              serverErrors: [],
              afterHandshakeCall: connecting,
              connectEvent: ready,
              streamEvent: { ...ready, pushAllowed: true },
              order: expectedOrder,
              status: 200,
              errors: [],
            },
          );
        } finally {
          client.destroy();
          front.close();
        }
      },
    );
  }

  test("server: destroyed before its socket connects", async () => {
    const { peer, port } = await silentPeer();
    const socket = net.connect(port, "127.0.0.1");
    const session = http2.performServerHandshake(socket);
    const events = sessionEvents(session);
    try {
      const socketClosed = once(socket, "close");
      session.destroy();
      const seen: Record<string, unknown> = { afterDestroyCall: lifecycle(session) };
      await socketClosed;
      await immediate();
      seen.afterSocketClose = lifecycle(session);
      assert.deepStrictEqual(
        { ...seen, events },
        {
          afterDestroyCall: destroyedBeforeReady,
          afterSocketClose: destroyedBeforeReady,
          // node holds the session's 'close' until the socket closed, so its 'connect' comes first.
          // Bun emits 'close' one tick after destroy() (#38195).
          events: isBun ? ["close", "connect"] : ["connect", "close"],
        },
      );
    } finally {
      session.destroy();
      socket.destroy();
      peer.close();
    }
  });

  test("server: a socket that closes before the session is ready gives ERR_SOCKET_CLOSED", async () => {
    const { peer, port } = await silentPeer();
    const socket = net.connect(port, "127.0.0.1");
    const session = http2.performServerHandshake(socket);
    const events = sessionEvents(session);
    const connected = once(session, "connect").then(
      () => "connected",
      (error: NodeJS.ErrnoException) => error.code,
    );
    try {
      await closeBeforeReady(socket);
      await immediate();
      assert.deepStrictEqual(
        { events, connected: await Promise.race([connected, immediate().then(() => "still pending")]) },
        { events: socketClosedBeforeReady, connected: "ERR_SOCKET_CLOSED" },
      );
    } finally {
      session.destroy();
      peer.close();
    }
  });

  test("server: a session of a server reports its lost socket as 'sessionError'", async () => {
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
        { sessions: 1, sessionErrors: ["ERR_SOCKET_CLOSED"] },
      );
    } finally {
      for (const session of sessions) session.destroy();
      peer.close();
    }
  });
});

if (typeof Bun !== "undefined") {
  const node = Bun.which("node");
  // Alpine's node segfaults at a random point of an http2 test file (see node-http2-client-close.test.ts),
  // and the CI runner fails a file for any new core dump.
  const isMusl =
    process.platform === "linux" &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  describe("Node.js compatibility", () => {
    test("tests should run on node.js", { skip: !node || isMusl }, async () => {
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
