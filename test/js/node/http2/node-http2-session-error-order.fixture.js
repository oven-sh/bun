// Ends node:http2 sessions on several paths and prints what each session and its open stream emit,
// in order. Run under Node.js and under Bun.
//   no argument      the paths on which Bun emits what Node.js emits: the output must be identical
//   "unlike-node"    the paths on which Bun's order still differs from Node.js
// H2_ORDER_TLS holds { key, cert } as JSON for the paths over TLS. Without it they are left out.
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

// Resolves with the next uncaught exception, one turn later: a 'close' that follows it would be recorded.
function uncaughtException(events) {
  return new Promise(resolve => process.once("uncaughtException", resolve)).then(error => {
    events.push(`uncaughtException ${error.message}`);
    return new Promise(resolve => setImmediate(resolve));
  });
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

  "listeners that are added after destroy(error) returned": () =>
    withIdleClient(({ client, events }) => {
      client.destroy(new Error("boom"));
      return recordSession(events, client);
    }),

  "a 'close' listener that the 'error' listener adds": () =>
    withIdleClient(({ client, events }) => {
      const closed = new Promise(resolve => {
        client.on("error", error => {
          events.push(`session error ${error.message}`);
          client.once("close", () => resolve(events.push("session close")));
        });
      });
      client.destroy(new Error("boom"));
      return closed;
    }),

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

  // The session reports the error once, to a listener that hears one event.
  "a request() that throws, and destroy(error) in the catch": () =>
    withIdleClient(({ client, events }) => {
      client.once("error", error => events.push(`session error ${error.message}`));
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
        client.destroy(error);
      }
      return closed;
    }),

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

  ...(tlsOptions && {
    "a client receives GOAWAY(CANCEL), over TLS": () =>
      withOpenStream("client", ({ serverSession }) => serverSession.destroy(NGHTTP2_CANCEL), { secure: true }),
  }),

  // The emit throws, so the error is uncaught and no 'close' follows it.
  "destroy(error) with no 'error' listener": () =>
    withIdleClient(({ client, events }) => {
      client.on("close", () => events.push("session close"));
      const uncaught = uncaughtException(events);
      client.destroy(new Error("boom"));
      events.push("destroy() returned");
      return uncaught;
    }),

  "an 'error' listener that is removed after destroy(error) returned": () =>
    withIdleClient(({ client, events }) => {
      const listener = error => events.push(`session error ${error.message}`);
      client.on("error", listener);
      client.on("close", () => events.push("session close"));
      const uncaught = uncaughtException(events);
      client.destroy(new Error("boom"));
      client.off("error", listener);
      return uncaught;
    }),
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

  // On purpose: a session whose socket fails while it has an 'error' listener does not throw later, when the
  // listener is gone. node:net keeps the same promise for its sockets.
  "the socket of a client session fails, and its 'error' listener is removed before the emit": () =>
    withIdleClient(({ client, socket, events }) => {
      const listener = error => events.push(`session error ${error.message}`);
      client.on("error", listener);
      const closed = new Promise(resolve => client.on("close", () => resolve(events.push("session close"))));
      // Runs behind the session's own listener for the socket's 'error'.
      socket.on("error", () => client.off("error", listener));
      socket.destroy(new Error("boom"));
      return Promise.race([closed, uncaughtException(events)]);
    }),

  "the socket of a server session fails, and its 'error' listener is removed before the emit": async () => {
    const events = [];
    let serverSocket;
    const ended = new Promise(resolve => {
      const server = net.createServer(socket => {
        serverSocket = socket;
        const session = http2.performServerHandshake(socket);
        const listener = error => events.push(`session error ${error.message}`);
        session.on("error", listener);
        session.on("close", () => resolve(events.push("session close")));
        socket.on("error", () => session.off("error", listener));
      });
      listen(server).then(port => {
        const client = http2.connect(`http://127.0.0.1:${port}`);
        client.on("error", () => {});
        client.on("close", () => server.close());
        client.on("connect", () => serverSocket.destroy(new Error("boom")));
      });
    });
    await Promise.race([ended, uncaughtException(events)]);
    return events;
  },

  "the socket of a server session is destroyed with no error": () =>
    withOpenStream("server", ({ serverSocket, events }) => {
      serverSocket.destroy();
      events.push("socket.destroy() returned");
    }),
};

(async () => {
  const scenarios = process.argv[2] === "unlike-node" ? unlikeNode : likeNode;
  for (const [name, scenario] of Object.entries(scenarios)) {
    console.log(`${name}:\n${(await scenario()).map(event => `  ${event}`).join("\n")}`);
  }
})();
