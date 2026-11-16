// The first request of a connection arrives while a raw write of the socket is still in its
// buffer: a 'connection' listener wrote more than the socket takes at once, and the client does
// not read. Such a request is dispatched like a pipelined one. Its response waits in the queue,
// and the socket has no current response yet. Then the dispatch throws.
//
// usage: <tcp|tls> [mode]
// Prints one JSON line for each mode. Node.js runs this file too.
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const tls = require("node:tls");

const [transport, onlyMode] = process.argv.slice(2);
const isTLS = transport === "tls";
const keys = path.join(__dirname, "..", "test", "fixtures", "keys");

let events = [];
process.on("uncaughtException", err => events.push(`uncaught: ${err.message}`));

const get = (url, headers = "") => `GET ${url} HTTP/1.1\r\nHost: localhost\r\n${headers}\r\n`;
const post = (url, sent) => `POST ${url} HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\n${sent}`;
const turn = () => new Promise(resolve => setImmediate(resolve));
// More than a socket buffer takes at once, so most of it is still in the buffer of the server when the request arrives.
const rawLength = 8 * 1024 * 1024;
// For an end that a wrong build never reaches. The time limit only bounds that failure.
async function within(promise) {
  let timer;
  try {
    await Promise.race([promise, new Promise(resolve => (timer = setTimeout(resolve, 10_000)))]);
  } finally {
    clearTimeout(timer);
  }
}

// `written` is what the client sends before the throw. `until` ends the scenario: the close of
// the connection, or the last bytes of a response. `resets` marks the modes in which the
// connection goes away before the raw write has left, so its byte count says nothing.
const modes = {
  "request": { written: get("/first"), until: "close" },
  "checkContinue": { written: get("/first", "Expect: 100-continue\r\n"), until: "close" },
  "checkExpectation": { written: get("/first", "Expect: something\r\n"), until: "close" },
  // No 'checkContinue' listener: the server answers the expectation itself, then emits 'request'.
  "expect-request": { written: get("/first", "Expect: 100-continue\r\n"), until: "close" },
  "constructor-request": { written: get("/first"), until: "close" },
  "constructor-response": { written: get("/first"), until: "close" },
  // The response is complete before the throw.
  "ended": { written: get("/first"), until: "done" },
  "destroyed": { written: get("/first"), until: "close", resets: true },
  "body": { written: post("/first", "hello"), until: "close" },
  // The body arrives after the throw.
  "body-to-come": { written: post("/first", ""), until: "close", resets: true },
};

async function scenario(mode) {
  events = [];
  const thrown = Promise.withResolvers();
  let queued;
  function fail(thrower, req) {
    events.push(req ? `${thrower} ${req.url}` : thrower);
    thrown.resolve();
    throw new Error(`${thrower} threw`);
  }

  const options = isTLS
    ? { key: fs.readFileSync(path.join(keys, "agent1-key.pem")), cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")) }
    : {};
  if (mode === "constructor-request") {
    options.IncomingMessage = class extends http.IncomingMessage {
      constructor(...args) {
        super(...args);
        fail("IncomingMessage");
      }
    };
  } else if (mode === "constructor-response") {
    options.ServerResponse = class extends http.ServerResponse {
      constructor(req, responseOptions) {
        super(req, responseOptions);
        fail("ServerResponse", req);
      }
    };
  }

  const server = (isTLS ? https : http).createServer(options, (req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    // A queued response has no socket.
    queued = res.socket === null;
    if (mode === "ended") res.end("done");
    if (mode === "destroyed") req.destroy();
    fail("request", req);
  });
  for (const eventName of ["checkContinue", "checkExpectation"]) {
    if (mode !== eventName) continue;
    server.on(eventName, (req, res) => {
      queued = res.socket === null;
      fail(eventName, req);
    });
  }
  server.on(isTLS ? "secureConnection" : "connection", socket => {
    socket.on("error", () => {});
    socket.write(Buffer.alloc(rawLength, "x"));
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  const { port } = server.address();
  const client = isTLS
    ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
    : net.connect(port, "127.0.0.1");
  client.pause();
  client.on("error", () => {});
  let received = 0;
  let rawIntact = true;
  let response = "";
  const { written, until, resets } = modes[mode];
  const finished = Promise.withResolvers();
  let closed = false;
  client.on("close", () => {
    closed = true;
    finished.resolve();
  });
  client.on("data", chunk => {
    const rawPart = Math.max(0, Math.min(chunk.length, rawLength - received));
    received += chunk.length;
    for (let i = 0; i < rawPart; i++) rawIntact &&= chunk[i] === 0x78;
    response += chunk.toString("latin1", rawPart);
    if (until !== "close" && response.endsWith(until)) finished.resolve();
  });
  await once(client, isTLS ? "secureConnect" : "connect");
  client.write(written);
  await thrown.promise;
  await turn();
  if (mode === "body-to-come") client.write("hello");
  client.resume();
  await within(finished.promise);

  client.destroy();
  server.close();
  server.closeAllConnections();
  return {
    mode,
    queued,
    events,
    rawBytes: resets ? undefined : received >= rawLength && rawIntact ? "all" : Math.min(received, rawLength),
    response: response.replace(/Date: [^\r]+\r\n/g, ""),
    closed,
  };
}

(async () => {
  for (const mode of Object.keys(modes)) {
    if (onlyMode && mode !== onlyMode) continue;
    console.log(JSON.stringify(await scenario(mode)));
  }
})();
