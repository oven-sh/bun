// User code emits 'close' on a ServerResponse that is open, or on the socket of its connection.
// Node.js has no listener of its own on the 'close' of a response, so the exchange goes on.
//
// usage: <tcp|tls> [scenario]. Prints one JSON line per scenario.
// This is plain node:http code. The expected values in node-http.test.ts are what Node.js
// v26.3.0 prints for it (`node <this file> tcp`).
"use strict";
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const tls = require("node:tls");

const [transport, only] = process.argv.slice(2);
const isTLS = transport === "tls";
const keys = path.join(__dirname, "..", "test", "fixtures", "keys");
const tlsOptions = isTLS
  ? {
      key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
      cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
    }
  : {};

const turn = () => new Promise(resolve => setImmediate(resolve));
const tick = () => new Promise(resolve => process.nextTick(resolve));
// Not events.once(): that one rejects for an 'error' event, and these emitters get one.
const closeOf = emitter => new Promise(resolve => emitter.once("close", resolve));
const get = (url, headers = "") => `GET ${url} HTTP/1.1\r\nHost: localhost\r\n${headers}\r\n`;
const codeOf = error => String(error?.code ?? error?.message ?? error);

// Of the scenario that runs. The scenarios run one after the other.
let errors = [];
let events = [];
process.on("uncaughtException", error => errors.push(codeOf(error)));
process.on("unhandledRejection", error => events.push(`unhandledRejection: ${codeOf(error)}`));

async function listen(options, listener) {
  const server = (isTLS ? https : http).createServer({ ...tlsOptions, ...options });
  for (const eventName of ["request", "checkContinue", "checkExpectation"]) server.on(eventName, listener);
  await once(server.listen(0, "127.0.0.1"), "listening");
  return server;
}

// `received()` is what the client has, without the Date headers. After the first 1 KB it gives
// the head of the first response and the number of bytes.
async function connect(server) {
  const { port } = server.address();
  const client = isTLS
    ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
    : net.connect(port, "127.0.0.1");
  client.on("error", () => {});
  await once(client, isTLS ? "secureConnect" : "connect");
  const responseStart = "HTTP/1.1 ";
  let text = "";
  let bytes = 0;
  const closed = closeOf(client);
  client.on("data", chunk => {
    bytes += chunk.length;
    if (text.length < 1024) text += chunk.toString("latin1");
    // Bytes that cannot be the start of a response: no end of a response comes after them.
    if (!responseStart.startsWith(text.slice(0, responseStart.length))) client.destroy();
  });
  const withoutDates = string => string.replace(/Date: [^\r]+\r\n/g, "");
  const received = () =>
    bytes <= 1024
      ? withoutDates(text)
      : withoutDates(text.slice(0, text.indexOf("\r\n\r\n") + 4)) + `<${bytes} bytes in all>`;
  return { client, closed, received };
}

function close(server) {
  server.close();
  server.closeAllConnections();
}

// The last request of a connection: its response closes the connection.
function answerSentinel(req, res) {
  res.setHeader("Connection", "close");
  res.end("sentinel");
}
// For a response that stays open: the response of the sentinel waits behind it and can send
// nothing, so it closes the connection itself.
function closeAtSentinel(req, res) {
  events.push(`the response of the sentinel ${res.socket === null ? "is queued" : "has the socket"}`);
  req.socket.destroy();
}

// Runs `steps` in the listener of /first. When they are done, the client sends /sentinel and
// reads until the connection closes.
async function firstThenSentinel(
  steps,
  { options = {}, request = get("/first"), sentinel = true, onSentinel = answerSentinel } = {},
) {
  const done = Promise.withResolvers();
  let connection;
  const server = await listen(options, (req, res) => {
    if (req.url === "/sentinel") return onSentinel(req, res);
    let pending;
    try {
      pending = steps(req, res, connection);
    } catch (error) {
      errors.push(codeOf(error));
    }
    Promise.resolve(pending)
      .catch(error => errors.push(codeOf(error)))
      .then(done.resolve);
  });
  connection = await connect(server);
  connection.client.write(request);
  await done.promise;
  if (sentinel) connection.client.write(get("/sentinel"));
  await connection.closed;
  close(server);
  return connection.received();
}

const endOnALaterTurn = async (req, res) => {
  await turn();
  res.emit("close");
  await turn();
  res.end("body");
};

// A tunnel: the listener of 'connect' or 'upgrade' has the socket. 'close' is emitted on it by
// hand, then the tunnel is used.
async function tunnel(eventName, request, head) {
  const server = await listen({}, answerSentinel);
  server.on(eventName, (req, socket) => {
    socket.on("error", () => {});
    socket.write(head);
    setImmediate(() => {
      // Nothing of node:http listens on a socket that it handed over.
      events.push(`'close' listeners of the socket: ${socket.listenerCount("close")}`);
      socket.emit("close");
      setImmediate(() => socket.end("tunnel-bytes"));
    });
  });
  const connection = await connect(server);
  connection.client.write(request);
  await connection.closed;
  close(server);
  return connection.received();
}

// A subclass with its own assignSocket() gets the socket through the public method, which
// listens for the 'close' of the socket. Node.js also aborts the request for that 'close',
// and the abort destroys the socket.
class ResponseWithAssignSocket extends http.ServerResponse {
  assignSocket(socket) {
    super.assignSocket(socket);
  }
}
function recordAbort(req, res) {
  req.on("aborted", () => events.push("request 'aborted'"));
  req.on("error", error => events.push(`request 'error' ${codeOf(error)}`));
  res.on("error", error => events.push(`response 'error' ${codeOf(error)}`));
  res.on("close", () => events.push("response 'close'"));
}
// The abort of the request has destroyed the socket. If it did not, nothing else ends the
// connection: the 'close' event also stopped the parser.
function endUnlessAborted(socket) {
  if (socket.destroyed) return;
  events.push("the socket is not destroyed");
  socket.destroy();
}

const scenarios = {
  // 'close' is emitted after the listener returned.
  "end on a later turn": () => firstThenSentinel(endOnALaterTurn),
  "end in the same turn": () =>
    firstThenSentinel(async (req, res) => {
      await turn();
      res.emit("close");
      res.end("body");
    }),
  "end in a tick": () =>
    firstThenSentinel(async (req, res) => {
      await turn();
      res.emit("close");
      await tick();
      res.end("body");
    }),
  "end after an await": () =>
    firstThenSentinel(async (req, res) => {
      await turn();
      res.emit("close");
      await null;
      res.end("body");
    }),
  "emitted twice": () =>
    firstThenSentinel(async (req, res) => {
      await turn();
      res.emit("close");
      res.emit("close");
      await turn();
      res.end("body");
    }),
  "emit() calls the listeners and returns true": () =>
    firstThenSentinel(async (req, res) => {
      res.on("close", () => events.push(`response 'close', writableEnded ${res.writableEnded}`));
      await turn();
      events.push(`emit returned ${res.emit("close")}`);
      await turn();
      res.end("body");
    }),
  "after writeHead()": () =>
    firstThenSentinel(async (req, res) => {
      res.writeHead(201, { "X-Custom": "yes" });
      await turn();
      res.emit("close");
      await turn();
      res.end("body");
    }),
  "after write()": () =>
    firstThenSentinel(async (req, res) => {
      res.write("a");
      await turn();
      res.emit("close");
      await turn();
      res.end("body");
    }),
  "after flushHeaders() with a Content-Length": () =>
    firstThenSentinel(async (req, res) => {
      res.setHeader("Content-Length", "4");
      res.flushHeaders();
      await turn();
      res.emit("close");
      await turn();
      res.end("body");
    }),
  "write() and no end()": () =>
    firstThenSentinel(
      async (req, res) => {
        await turn();
        res.emit("close");
        await turn();
        res.write("a");
      },
      { onSentinel: closeAtSentinel },
    ),
  "no end()": () =>
    firstThenSentinel(
      async (req, res) => {
        await turn();
        res.emit("close");
      },
      { onSentinel: closeAtSentinel },
    ),
  "then res.destroy()": () =>
    firstThenSentinel(
      async (req, res, connection) => {
        req.on("error", () => {});
        res.write("a");
        await turn();
        res.emit("close");
        await turn();
        res.destroy();
        await connection.closed;
      },
      { sentinel: false },
    ),
  "then the client leaves": () =>
    firstThenSentinel(
      async (req, res, connection) => {
        recordAbort(req, res);
        await turn();
        res.emit("close");
        await turn();
        connection.client.destroy();
        await closeOf(req);
      },
      { sentinel: false },
    ),
  "a 'checkContinue' listener": () =>
    firstThenSentinel(
      async (req, res) => {
        await turn();
        res.emit("close");
        await turn();
        res.writeContinue();
        res.end("body");
      },
      { request: get("/first", "Expect: 100-continue\r\n") },
    ),
  "a 'checkExpectation' listener": () =>
    firstThenSentinel(endOnALaterTurn, { request: get("/first", "Expect: something\r\n") }),
  "a subclass of ServerResponse": () =>
    firstThenSentinel(endOnALaterTurn, { options: { ServerResponse: class extends http.ServerResponse {} } }),
  "a request with Connection: close": () =>
    firstThenSentinel(endOnALaterTurn, { request: get("/first", "Connection: close\r\n"), sentinel: false }),
  "an HTTP/1.0 request": () =>
    firstThenSentinel(endOnALaterTurn, { request: "GET /first HTTP/1.0\r\n\r\n", sentinel: false }),

  // 'close' is emitted in the listener. The next request arrives while the response is open, so
  // its response waits: the responses leave in the order of the requests.
  "emitted in the listener, then a second request": async () => {
    const firstRan = Promise.withResolvers();
    const done = Promise.withResolvers();
    let first;
    const server = await listen({}, (req, res) => {
      if (req.url === "/sentinel") return answerSentinel(req, res);
      if (req.url === "/first") {
        first = res;
        res.emit("close");
        firstRan.resolve();
        return;
      }
      events.push(`the second response ${res.socket === null ? "is queued" : "has the socket"}`);
      res.end("second");
      setImmediate(() => {
        try {
          first.end("first");
        } finally {
          done.resolve();
        }
      });
    });
    const connection = await connect(server);
    connection.client.write(get("/first"));
    await firstRan.promise;
    connection.client.write(get("/second"));
    await done.promise;
    connection.client.write(get("/sentinel"));
    await connection.closed;
    close(server);
    return connection.received();
  },

  // The response has ended and most of its body waits for the client, which does not read.
  // Only the client can finish it.
  "emitted while the body drains": async () => {
    const body = Buffer.alloc(32 * 1024 * 1024, "a");
    const done = Promise.withResolvers();
    let connection;
    const server = await listen({}, (req, res) => {
      if (req.url === "/sentinel") return answerSentinel(req, res);
      res.on("finish", () => {
        events.push("response 'finish'");
        done.resolve();
      });
      res.on("close", () => events.push("response 'close'"));
      res.end(body);
      setImmediate(() => {
        events.push(`emit returned ${res.emit("close")}`);
        setImmediate(() => {
          events.push("the client reads");
          connection.client.resume();
        });
      });
    });
    connection = await connect(server);
    connection.client.pause();
    connection.client.write(get("/first"));
    await done.promise;
    connection.client.write(get("/sentinel"));
    await connection.closed;
    close(server);
    return connection.received();
  },

  "socket.emit('close') with an own assignSocket(), after flushHeaders()": () =>
    firstThenSentinel(
      async (req, res) => {
        const socket = req.socket;
        recordAbort(req, res);
        res.flushHeaders();
        await turn();
        socket.emit("close");
        events.push(`response destroyed ${res.destroyed}, closed ${res.closed}`);
        await turn();
        res.end("body");
        endUnlessAborted(socket);
      },
      { options: { ServerResponse: ResponseWithAssignSocket }, sentinel: false },
    ),
  "socket.emit('close') with an own assignSocket(), after write()": () =>
    firstThenSentinel(
      async (req, res) => {
        const socket = req.socket;
        recordAbort(req, res);
        res.write("a");
        await turn();
        socket.emit("close");
        await turn();
        res.end("body");
        endUnlessAborted(socket);
      },
      { options: { ServerResponse: ResponseWithAssignSocket }, sentinel: false },
    ),

  // Both requests arrive in one read. Node.js parses the whole read before it runs the
  // rejection handlers.
  "an unhandled rejection in a listener that leaves the response open": async () => {
    const done = Promise.withResolvers();
    let first;
    const server = await listen({}, (req, res) => {
      if (req.url === "/sentinel") return answerSentinel(req, res);
      events.push(`request ${req.url}`);
      if (req.url === "/first") {
        first = res;
        Promise.reject(new Error("rejected in the listener"));
        return;
      }
      res.end("second");
      setImmediate(() => {
        first.end("first");
        done.resolve();
      });
    });
    const connection = await connect(server);
    connection.client.write(get("/first") + get("/second"));
    await done.promise;
    connection.client.write(get("/sentinel"));
    await connection.closed;
    close(server);
    return connection.received();
  },
};

// Winsock takes the whole body in one send() on loopback, so no response is left that drains.
if (process.platform === "win32") delete scenarios["emitted while the body drains"];

// Not on TLS: the TLSSocket of Node.js has 'close' listeners of its own, which take the event as
// the end of the TLS session.
if (!isTLS) {
  scenarios["socket.emit('close') in a CONNECT tunnel"] = () =>
    tunnel(
      "connect",
      "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
      "HTTP/1.1 200 Connection Established\r\n\r\n",
    );
  scenarios["socket.emit('close') after an upgrade"] = () =>
    tunnel(
      "upgrade",
      get("/first", "Connection: Upgrade\r\nUpgrade: custom\r\n"),
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: custom\r\n\r\n",
    );
}

(async () => {
  for (const [scenario, run] of Object.entries(scenarios)) {
    if (only && only !== scenario) continue;
    errors = [];
    events = [];
    const received = await run();
    // An event of this scenario that is still on its way belongs to it.
    await turn();
    console.log(JSON.stringify({ scenario, received, events, errors }));
  }
})();
