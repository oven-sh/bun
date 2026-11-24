// Ends node:http2 sessions on several paths and prints what each session and its open stream emit,
// in order.
//   no argument      the paths on which Bun emits what Node.js emits. Run under both: the output must be identical.
//   "unlike-node"    the paths on which Bun does not emit what Node.js emits, some of them on purpose.
//                    Run under Bun. Node.js has no one text for them: v26.3.0 and v26.12.1 differ on one.
// H2_ORDER_TLS holds { key, cert } as JSON for the paths over TLS. Without it they are left out.
const { once } = require("node:events");
const http2 = require("node:http2");
const net = require("node:net");
const { Duplex } = require("node:stream");

const { NGHTTP2_CANCEL, NGHTTP2_ENHANCE_YOUR_CALM } = http2.constants;
const tlsOptions = process.env.H2_ORDER_TLS ? JSON.parse(process.env.H2_ORDER_TLS) : undefined;

function listen(server) {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

// Resolves when the session emits 'close'.
function recordSession(events, session) {
  let sinceError;
  session.on("goaway", code => events.push(`session goaway ${code}`));
  session.on("error", error => {
    events.push(
      `session error ${error.code ?? error.message}, destroyed ${session.destroyed}, closed ${session.closed}`,
    );
    sinceError = [];
    process.nextTick(() => sinceError.push("a tick"));
    queueMicrotask(() => sinceError.push("a microtask"));
  });
  return new Promise(resolve => {
    session.on("close", () => {
      events.push(
        sinceError === undefined
          ? "session close"
          : `session close, ran since 'error': ${sinceError.join(", ") || "nothing"}`,
      );
      resolve();
    });
  });
}

// Resolves when the stream emits 'close'.
function recordStream(events, stream) {
  stream.on("aborted", () => events.push("stream aborted"));
  stream.on("error", error => events.push(`stream error ${error.code ?? error.message}`));
  return new Promise(resolve => {
    stream.on("close", () => {
      events.push(`stream close ${stream.rstCode}`);
      // When the session waits for its socket's 'close', its 'error' is not in this tick queue.
      process.nextTick(() => events.push("a tick queued in the stream's 'close'"));
      resolve();
    });
  });
}

// One request whose response stays open. `side` names the end whose events are recorded, and
// `act` ends that end's session. `before` runs when the client session exists.
async function withOpenStream(side, act, { secure = false, transport, before } = {}) {
  const events = [];
  let serverSession, serverSocket, sessionClosed, streamClosed;
  const server = secure ? http2.createSecureServer(tlsOptions) : http2.createServer();
  server.on("connection", socket => (serverSocket = socket));
  server.on("session", session => {
    serverSession = session;
    if (side === "server") sessionClosed = recordSession(events, session);
    else session.on("error", () => {});
  });
  if (side === "server") {
    server.on("sessionError", error => events.push(`server sessionError ${error.code ?? error.message}`));
  }
  server.on("stream", stream => {
    if (side === "server") streamClosed = recordStream(events, stream);
    else stream.on("error", () => {});
    stream.respond();
    stream.write("hello");
  });
  const port = await listen(server);
  // A socket of the scenario's own, for the scenarios that destroy it or wrap it.
  const clientSocket = transport && net.connect(port, "127.0.0.1");
  clientSocket?.on("error", () => {});
  const client = http2.connect(`${secure ? "https" : "http"}://127.0.0.1:${port}`, {
    ...(secure && { servername: "localhost", rejectUnauthorized: false }),
    ...(transport && { createConnection: () => (transport === "duplex" ? overDuplex(clientSocket) : clientSocket) }),
  });
  if (side === "client") sessionClosed = recordSession(events, client);
  else client.on("error", () => {});
  before?.({ client, events, getServerSession: () => serverSession });
  const req = client.request({ ":method": "POST" });
  if (side === "client") streamClosed = recordStream(events, req);
  else req.on("error", () => {});
  await new Promise(resolve => req.once("data", resolve));
  act({ client, clientSocket, serverSession, serverSocket, events });
  await Promise.all([sessionClosed, streamClosed]);
  // Lets a tick that the last listener queued run.
  await new Promise(resolve => setImmediate(resolve));
  client.destroy();
  clientSocket?.destroy();
  serverSession.destroy();
  server.close();
  return events;
}

// A transport that is a stream and no socket.
function overDuplex(socket) {
  const transport = new Duplex({
    read() {},
    write: (chunk, encoding, callback) => void socket.write(chunk, encoding, callback),
    final: callback => void socket.end(callback),
    destroy: (error, callback) => (socket.destroy(), callback(error)),
  });
  socket.on("data", chunk => transport.push(chunk));
  socket.on("end", () => transport.push(null));
  return transport;
}

// A connected client session with no stream. `act` runs in its 'connect' listener and returns a
// promise for the end of the scenario.
async function withIdleClient(act) {
  const events = [];
  const server = http2.createServer();
  server.on("session", session => session.on("error", () => {}));
  const port = await listen(server);
  const socket = net.connect(port, "127.0.0.1");
  socket.on("error", () => {});
  const client = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
  await new Promise(resolve => client.on("connect", () => resolve(act({ client, socket, events }))));
  server.close();
  return events;
}

// A connected server session that only `act` listens to: performServerHandshake() adds no 'error' listener,
// where createServer() adds one. `act` returns a promise for the end of the scenario.
async function withBareServerSession(act) {
  const events = [];
  const server = net.createServer();
  const accepted = new Promise(resolve => {
    server.once("connection", socket => {
      socket.on("error", () => {});
      resolve({ socket, session: http2.performServerHandshake(socket) });
    });
  });
  const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
  client.on("error", () => {});
  await new Promise(resolve => client.once("connect", resolve));
  await act({ ...(await accepted), events });
  client.destroy();
  server.close();
  return events;
}

// Resolves with the next uncaught exception, one turn later: a 'close' that follows it would be recorded.
function uncaughtException(events) {
  return new Promise(resolve => process.once("uncaughtException", resolve)).then(error => {
    events.push(`uncaughtException ${error.message}`);
    return new Promise(resolve => setImmediate(resolve));
  });
}

// Resolves one turn after the socket's 'close': the session has nothing more to emit then.
function socketClosed(socket) {
  return new Promise(resolve => socket.once("close", () => setImmediate(resolve)));
}

// Resolves after `count` turns of the event loop.
async function turns(count) {
  for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve));
}

// A client session that is destroyed while its socket is connecting: the lookup answers, with a failure,
// only after the session closed or three turns passed.
async function destroyedWhileConnecting(error) {
  const events = [];
  let answer;
  const client = http2.connect("http://unreachable.invalid", {
    lookup(hostname, options, callback) {
      const fail = () => callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }));
      if (answer === null) fail();
      else answer = fail;
    },
  });
  const sessionClosed = recordSession(events, client);
  // A request that waits, next to an error alone: with none, its rstCode is 8 and node's is 2, which is not
  // the subject here.
  const streamClosed = error && recordStream(events, client.request({ ":method": "POST" }));
  if (error) {
    // What the socket tells its own listeners when the session's error ends its connect.
    client.socket.on("error", socketError => events.push(`socket error ${socketError.message}`));
    client.socket.on("close", hadError => events.push(`socket close, hadError ${hadError}`));
  }
  client.destroy(error);
  events.push("destroy() returned");
  await Promise.race([sessionClosed, turns(3)]);
  events.push("the lookup answers");
  answer?.();
  answer = null;
  await Promise.all([sessionClosed, streamClosed]);
  return events;
}

// What the scenarios of a client session and of a server session share.
function requestThatThrows(client, events, destroy) {
  client.on("error", error => events.push(`session error ${error.message}`));
  const closed = new Promise(resolve => client.on("close", () => resolve(events.push("session close"))));
  try {
    client.request({
      "x-throws": {
        toString() {
          throw new Error("toString boom");
        },
      },
    });
  } catch (error) {
    events.push(`request() threw ${error.message}`);
    destroy(error);
  }
  return closed;
}

function failSocketWithNoListener(session, socket, events) {
  session.on("close", () => events.push("session close"));
  const ended = Promise.race([uncaughtException(events), socketClosed(socket)]);
  socket.destroy(new Error("boom"));
  return ended;
}

function destroyWithNoListener(session, socket, events) {
  session.on("close", () => events.push("session close"));
  const ended = Promise.race([socketClosed(socket), uncaughtException(events)]);
  try {
    session.destroy(new Error("boom"));
    events.push("destroy() returned");
  } catch (error) {
    events.push(`destroy() threw ${error.message}`);
  }
  return ended;
}

function destroyWithReplacedEmit(session, events) {
  const emit = session.emit;
  session.emit = function (name, ...args) {
    if (name !== "error") return emit.call(this, name, ...args);
    events.push(`emit("error", ${args[0].message})`);
    return true;
  };
  const closed = new Promise(resolve => session.on("close", () => resolve(events.push("session close"))));
  session.destroy(new Error("boom"));
  events.push("destroy() returned");
  // The error is reported. A listener that comes now must not get it again.
  session.on("error", () => {});
  return closed;
}

function failSocketThenRemoveListener(session, socket, events) {
  const listener = error => events.push(`session error ${error.message}`);
  session.on("error", listener);
  const closed = new Promise(resolve => session.on("close", () => resolve(events.push("session close"))));
  // Runs behind the session's own listener for the socket's 'error'.
  socket.on("error", () => session.off("error", listener));
  socket.destroy(new Error("boom"));
  return Promise.race([closed, uncaughtException(events)]);
}

const likeNode = {
  "a client receives GOAWAY(CANCEL)": () =>
    withOpenStream("client", ({ serverSession }) => serverSession.destroy(NGHTTP2_CANCEL)),

  "a client receives GOAWAY(ENHANCE_YOUR_CALM)": () =>
    withOpenStream("client", ({ serverSession }) => serverSession.destroy(NGHTTP2_ENHANCE_YOUR_CALM)),

  "a client that called close() receives GOAWAY(CANCEL)": () =>
    withOpenStream("client", ({ client, serverSession }) => {
      client.close();
      serverSession.destroy(NGHTTP2_CANCEL);
    }),

  // What @grpc/grpc-js does: close() in the 'goaway' listener, and a listener for the socket's 'close'.
  "a client that calls close() in its 'goaway' listener receives GOAWAY(CANCEL)": () =>
    withOpenStream("client", ({ serverSession }) => serverSession.destroy(NGHTTP2_CANCEL), {
      before({ client, events }) {
        client.once("goaway", () => client.close());
        client.socket.once("close", () => events.push("socket close"));
      },
    }),

  // What a server that drains does: GOAWAY(NO_ERROR), then GOAWAY(CANCEL) for the calls that are still open.
  "a client receives GOAWAY(NO_ERROR), then GOAWAY(CANCEL)": () =>
    withOpenStream("client", ({ serverSession }) => serverSession.close(), {
      before({ client, getServerSession }) {
        client.once("goaway", () => setImmediate(() => getServerSession().destroy(NGHTTP2_CANCEL)));
      },
    }),

  "a server receives GOAWAY(CANCEL)": () => withOpenStream("server", ({ client }) => client.destroy(NGHTTP2_CANCEL)),

  "a server session is destroyed with an error": () =>
    withOpenStream("server", ({ serverSession, events }) => {
      serverSession.destroy(new Error("boom"));
      events.push("destroy() returned");
    }),

  "a server session is destroyed with a code": () =>
    withOpenStream("server", ({ serverSession, events }) => {
      serverSession.destroy(NGHTTP2_CANCEL);
      events.push("destroy() returned");
    }),

  // The socket is gone when destroy() runs, so process.nextTick emits the session's events.
  "the socket of a server session is destroyed with an error": () =>
    withOpenStream("server", ({ serverSocket, events }) => {
      serverSocket.destroy(new Error("boom"));
      events.push("socket.destroy() returned");
    }),

  "a client session with no stream is destroyed with an error": () =>
    withIdleClient(({ client, events }) => {
      const closed = recordSession(events, client);
      client.destroy(new Error("boom"));
      events.push("destroy() returned");
      return closed;
    }),

  "the socket of a client session with no stream is destroyed with an error": () =>
    withIdleClient(({ client, socket, events }) => {
      const closed = recordSession(events, client);
      socket.destroy(new Error("boom"));
      events.push("socket.destroy() returned");
      return closed;
    }),

  // No GOAWAY arrives first: the session finds the error itself, in a settings() call with too many before it.
  "a client session that destroys itself with an error": () =>
    withIdleClient(({ client, events }) => {
      const closed = recordSession(events, client);
      try {
        for (;;) client.settings({});
      } catch (error) {
        events.push(`settings() threw ${error.code}`);
      }
      return closed;
    }),

  // The session had an 'error' listener when destroy() ran. The emit is for the listeners it has then.
  "listeners that are added after destroy(error) returned": () =>
    withIdleClient(({ client, events }) => {
      client.on("error", () => {});
      client.destroy(new Error("boom"));
      return recordSession(events, client);
    }),

  "a 'close' listener that the 'error' listener adds": () =>
    withIdleClient(({ client, socket, events }) => {
      const closed = new Promise(resolve => {
        client.on("error", error => {
          events.push(`session error ${error.message}`);
          client.once("close", () => resolve(events.push("session close")));
        });
      });
      const ended = Promise.race([closed, socketClosed(socket)]);
      client.destroy(new Error("boom"));
      return ended;
    }),

  // The listener runs with nothing of the program on the stack, so what it throws is uncaught. No 'close' follows.
  "an 'error' listener that throws": () =>
    withIdleClient(({ client, socket, events }) => {
      client.on("error", error => {
        events.push(`session error ${error.message}`);
        throw new Error("the listener threw");
      });
      client.on("close", () => events.push("session close"));
      const ended = Promise.race([uncaughtException(events), socketClosed(socket)]);
      try {
        client.destroy(new Error("boom"));
        events.push("destroy() returned");
      } catch (error) {
        events.push(`destroy() threw ${error.message}`);
      }
      return ended;
    }),

  // once() listens for 'error' too, and the error comes after destroy() returned.
  "events.once(session, 'close') after destroy(error)": () =>
    withIdleClient(async ({ client, events }) => {
      client.on("error", () => {});
      client.destroy(new Error("boom"));
      await once(client, "close").then(
        () => events.push("once() resolved"),
        error => events.push(`once() rejected ${error.message}`),
      );
    }),

  // A ping that the destroy() cancels is answered behind the streams' 'close'.
  "a client with a ping that waits is destroyed with an error": () =>
    withOpenStream("client", ({ client, events }) => {
      client.ping(error => events.push(`ping callback ${error?.code}`));
      client.destroy(new Error("boom"));
    }),

  "a client with a ping that waits receives GOAWAY(CANCEL)": () =>
    withOpenStream("client", ({ client, serverSession, events }) => {
      client.ping(error => events.push(`ping callback ${error?.code}`));
      serverSession.destroy(NGHTTP2_CANCEL);
    }),

  // The callback of server.close() runs ahead of the last session's 'sessionError'.
  "a server that is closing destroys its last session with an error": async () => {
    const events = [];
    const server = http2.createServer();
    server.on("sessionError", error => events.push(`server sessionError ${error.message}`));
    const accepted = new Promise(resolve => server.on("session", resolve));
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
    client.on("error", () => {});
    const [session] = await Promise.all([accepted, new Promise(resolve => client.once("connect", resolve))]);
    const closed = new Promise(resolve => session.on("close", () => resolve(events.push("session close"))));
    server.close(() => events.push("server.close() callback"));
    session.destroy(new Error("boom"));
    events.push("destroy() returned");
    await closed;
    client.destroy();
    return events;
  },

  // The socket's 'close' listener gets hadError = true. That is not the session's error.
  "destroy() with no error, then the socket fails": () =>
    withIdleClient(({ client, socket, events }) => {
      const closed = recordSession(events, client);
      client.destroy();
      socket.destroy(new Error("late"));
      return closed;
    }),

  "a server session is destroyed with no error, then its socket fails": async () => {
    const events = [];
    let serverSocket;
    const server = http2.createServer();
    server.on("connection", socket => (serverSocket = socket));
    const accepted = new Promise(resolve => server.on("session", resolve));
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
    client.on("error", () => {});
    const session = await accepted;
    const closed = recordSession(events, session);
    session.destroy();
    serverSocket.destroy(new Error("late"));
    await closed;
    client.destroy();
    server.close();
    return events;
  },

  // A destroyed session reports the error of its destroy(), once, and not the error of the request().
  "a request() that throws, and destroy(error) in the catch": () =>
    withIdleClient(({ client, events }) => requestThatThrows(client, events, error => client.destroy(error))),

  "a request() that throws, and destroy() in the catch": () =>
    withIdleClient(({ client, events }) => requestThatThrows(client, events, () => client.destroy())),

  "a request() that throws, and destroy(another error) in the catch": () =>
    withIdleClient(({ client, events }) =>
      requestThatThrows(client, events, () => client.destroy(new Error("another"))),
    ),

  // The lookup fails, so the socket is gone before it connects and process.nextTick emits the session's events.
  "a connect that fails, with a request that waits": async () => {
    const events = [];
    const client = http2.connect("http://unreachable.invalid", {
      lookup(hostname, options, callback) {
        process.nextTick(
          callback,
          Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }),
        );
      },
    });
    const sessionClosed = recordSession(events, client);
    const streamClosed = recordStream(events, client.request({ ":method": "POST" }));
    await Promise.all([sessionClosed, streamClosed]);
    await new Promise(resolve => setImmediate(resolve));
    return events;
  },

  // The peer accepts the connection and never answers the TLS handshake.
  "a client session that is still connecting is destroyed with an error": async () => {
    const events = [];
    const accepted = [];
    const peer = net.createServer(socket => accepted.push(socket.on("error", () => {})));
    const client = http2.connect(`https://127.0.0.1:${await listen(peer)}`, {
      servername: "localhost",
      rejectUnauthorized: false,
    });
    const sessionClosed = recordSession(events, client);
    const streamClosed = recordStream(events, client.request({ ":method": "POST" }));
    client.destroy(new Error("boom"));
    events.push("destroy() returned");
    await Promise.all([sessionClosed, streamClosed]);
    await new Promise(resolve => setImmediate(resolve));
    for (const socket of accepted) socket.destroy();
    peer.close();
    return events;
  },

  // With no error to report, the socket is ended, and that waits for the connect.
  "a client session whose connect does not complete is destroyed with no error": () => destroyedWhileConnecting(),

  ...(tlsOptions && {
    "a client receives GOAWAY(CANCEL), over TLS": () =>
      withOpenStream("client", ({ serverSession }) => serverSession.destroy(NGHTTP2_CANCEL), { secure: true }),
  }),

  // Nobody listens for the session's 'error', so it is an uncaught exception and no 'close' follows it.
  "the socket of a client session with no 'error' listener is destroyed with an error": () =>
    withIdleClient(({ client, socket, events }) => failSocketWithNoListener(client, socket, events)),

  "the socket of a server session with no 'error' listener is destroyed with an error": () =>
    withBareServerSession(({ session, socket, events }) => failSocketWithNoListener(session, socket, events)),
};

const unlikeNode = {
  "a client session with an open stream is destroyed with an error": () =>
    withOpenStream("client", ({ client, events }) => {
      client.destroy(new Error("boom"));
      events.push("destroy() returned");
    }),

  "the socket of a client session with an open stream is destroyed with an error": () =>
    withOpenStream(
      "client",
      ({ clientSocket, events }) => {
        clientSocket.destroy(new Error("boom"));
        events.push("socket.destroy() returned");
      },
      { transport: "socket" },
    ),

  "a client session over a Duplex is destroyed with an error": () =>
    withOpenStream(
      "client",
      ({ client, events }) => {
        client.destroy(new Error("boom"));
        events.push("destroy() returned");
      },
      { transport: "duplex" },
    ),

  "the socket of a server session is destroyed with no error": () =>
    withOpenStream("server", ({ serverSocket, events }) => {
      serverSocket.destroy();
      events.push("socket.destroy() returned");
    }),

  // The rest is on purpose. destroy(error) used to emit the 'error' before it returned, and a program that
  // worked then must not end with an uncaught exception now:
  // - With no 'error' listener, destroy(error) throws to its caller. Node.js returns, and throws when the
  //   socket has closed, where no try/catch can see it.
  // - With an 'error' listener that is gone at the emit, nothing is thrown. Node.js throws.
  // - A connect that does not complete does not hold the 'error' back. Node.js waits for it.
  "a client session with no 'error' listener is destroyed with an error": () =>
    withIdleClient(({ client, socket, events }) => destroyWithNoListener(client, socket, events)),

  "a server session with no 'error' listener is destroyed with an error": () =>
    withBareServerSession(({ session, socket, events }) => destroyWithNoListener(session, socket, events)),

  "a client session with no 'error' listener and an emit() of the program's is destroyed with an error": () =>
    withIdleClient(({ client, events }) => destroyWithReplacedEmit(client, events)),

  "a server session with no 'error' listener and an emit() of the program's is destroyed with an error": () =>
    withBareServerSession(({ session, events }) => destroyWithReplacedEmit(session, events)),

  "an 'error' listener that is removed after destroy(error) returned": () =>
    withIdleClient(({ client, events }) => {
      const listener = error => events.push(`session error ${error.message}`);
      client.on("error", listener);
      const closed = new Promise(resolve => client.on("close", () => resolve(events.push("session close"))));
      client.destroy(new Error("boom"));
      // The session adds no listener of its own to keep the emit from throwing.
      events.push(`'error' listeners when destroy() returned: ${client.listenerCount("error")}`);
      client.removeAllListeners("error");
      return Promise.race([closed, uncaughtException(events)]);
    }),

  "the socket of a client session fails, and its 'error' listener is removed before the emit": () =>
    withIdleClient(({ client, socket, events }) => failSocketThenRemoveListener(client, socket, events)),

  "the socket of a server session fails, and its 'error' listener is removed before the emit": () =>
    withBareServerSession(({ session, socket, events }) => failSocketThenRemoveListener(session, socket, events)),

  "a client session whose connect does not complete is destroyed with an error": () =>
    destroyedWhileConnecting(new Error("boom")),

  // The connect that destroy(error) finds pending is abandoned, so the listener of connect() is not called.
  // Node.js completes the connect and calls it, with a destroyed session.
  "a client session that is connecting to a server is destroyed with an error": async () => {
    const events = [];
    const server = http2.createServer();
    server.on("session", session => session.on("error", () => {}));
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`, () => events.push("connect() listener"));
    client.on("connect", () => events.push("session connect"));
    const closed = recordSession(events, client);
    client.destroy(new Error("boom"));
    events.push("destroy() returned");
    await closed;
    // A listener that is called late would be recorded.
    await turns(3);
    server.close();
    return events;
  },

  // Bun catches what the listener of connect() throws and destroys the session with it (Node.js: uncaught).
  // That error is still emitted inside destroy(): the 'connect' event comes next and can take a listener away.
  "a connect() listener that throws, and an 'error' listener that the 'connect' event removes": async () => {
    const events = [];
    const server = http2.createServer();
    server.on("session", session => session.on("error", () => {}));
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`, () => {
      throw new Error("boom");
    });
    const listener = error => events.push(`session error ${error.message}`);
    client.on("error", listener);
    client.on("connect", () => {
      events.push("session connect");
      client.off("error", listener);
    });
    await Promise.race([
      new Promise(resolve => client.on("close", () => resolve(events.push("session close")))),
      uncaughtException(events),
    ]);
    client.destroy();
    server.close();
    return events;
  },
};

(async () => {
  const scenarios = process.argv[2] === "unlike-node" ? unlikeNode : likeNode;
  for (const [name, scenario] of Object.entries(scenarios)) {
    const events = await scenario();
    // A scenario that waits for an uncaught exception and sees none leaves its listener.
    process.removeAllListeners("uncaughtException");
    console.log(`${name}:\n${events.map(event => `  ${event}`).join("\n")}`);
  }
})();
