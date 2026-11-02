// The dispatch of a request throws while an earlier response on the connection is still pending.
// MODE selects the scenario. The only line of stdout is the result as JSON.
// Under Node.js (`MODE=request node <this file>`) every mode prints the same result, except
// unfinished and not-pipelined: they wait for a close that Node never makes.
const http = require("node:http");
const net = require("node:net");

const mode = process.env.MODE;
const events = [];
process.on("uncaughtException", err => events.push(`uncaught: ${err.message}`));

const get = (path, headers = "") => `GET ${path} HTTP/1.1\r\nHost: example.com\r\n${headers}\r\n`;
const written = new Map([
  ["checkContinue", get("/first") + get("/second", "Expect: 100-continue\r\n")],
  ["checkExpectation", get("/first") + get("/second", "Expect: something\r\n")],
  ["unfinished", get("/first") + get("/second") + get("/third") + get("/fourth")],
  ["not-pipelined", get("/first")],
]);
const pipelinedPair = get("/first") + get("/second");

// The "large" modes end /first with more bytes than a socket buffer takes at once, so most of
// them are still on their way out when the turn of /second comes.
const isLarge = mode.startsWith("large");
const firstBodyLength = isLarge ? 8 * 1024 * 1024 : 10;

let received = "";
let firstBodyBytes = 0;
let clientClosed = false;
const serverSideCloses = [];

function report(extra) {
  const result = isLarge
    ? { firstBodyBytes }
    : { bodies: ["first-done", "second", "third", "fourth"].filter(body => received.includes(body)) };
  console.log(JSON.stringify({ events, ...result, closed: clientClosed, ...extra }));
  process.exit(0);
}

// "unfinished" waits for the end of the connection, and for each request and response behind
// /first to close. server.close() calls back only when no request is pending, the one that threw
// included.
let closingServer = false;
function reportUnfinished() {
  if (clientClosed && serverSideCloses.length === 6 && !closingServer) {
    closingServer = true;
    server.close(() => report({ serverSideCloses: serverSideCloses.sort() }));
  }
}

// The response to /first stays open until a later dispatch finishes it.
let first;
const finishFirst = () => first.end(isLarge ? Buffer.alloc(firstBodyLength - 5, "-") : "-done");

function fail(thrower, req) {
  events.push(`${thrower} ${req.url}`);
  throw new Error(`${thrower} threw`);
}

// node:http queues a response only after it constructed the request and the response.
class ResponseThatThrows extends http.ServerResponse {
  constructor(req, options) {
    super(req, options);
    if (req.url === "/second") {
      setImmediate(finishFirst);
      fail("ServerResponse", req);
    }
  }
}
// The url is not known yet in this constructor: the second request is the one that throws.
let requests = 0;
class RequestThatThrows extends http.IncomingMessage {
  constructor(...args) {
    super(...args);
    if (++requests === 2) {
      setImmediate(finishFirst);
      events.push("IncomingMessage /second");
      throw new Error("IncomingMessage threw");
    }
  }
}
const serverOptions = new Map([
  ["constructor-response", { ServerResponse: ResponseThatThrows }],
  ["constructor-request", { IncomingMessage: RequestThatThrows }],
]);

const server = http.createServer(serverOptions.get(mode) ?? {}, (req, res) => {
  if (req.url === "/first") {
    events.push(`request ${req.url}`);
    if (mode === "not-pipelined") return void res.end("first-done");
    first = res;
    res.writeHead(200, { "Content-Length": String(firstBodyLength) });
    res.write("first");
    return;
  }
  switch (mode) {
    case "unfinished":
      // /second and /fourth answer. /third throws and leaves its response open.
      for (const emitter of [req, res]) {
        emitter.on("close", () => {
          serverSideCloses.push(req.url);
          reportUnfinished();
        });
      }
      if (req.url === "/third") fail("request", req);
      res.end(req.url.slice(1));
      if (req.url === "/fourth") setImmediate(finishFirst);
      return;
    case "constructor-response":
    case "constructor-request":
      events.push(`request ${req.url}`);
      return void res.end(req.url.slice(1));
    case "large-destroyed":
      // No throw: the queued response is destroyed, and its turn resets the connection too.
      events.push(`request ${req.url}`);
      setImmediate(finishFirst);
      return void res.destroy();
    case "ended":
      // The response is complete before the throw.
      res.end("second");
      setImmediate(finishFirst);
      break;
    case "ended-later":
      // The response is complete before its turn comes.
      setImmediate(() => {
        res.end("second");
        finishFirst();
      });
      break;
    case "request":
    case "large":
      setImmediate(finishFirst);
      break;
  }
  fail("request", req);
});
for (const eventName of ["checkContinue", "checkExpectation"]) {
  server.on(eventName, req => {
    setImmediate(finishFirst);
    fail(eventName, req);
  });
}

server.listen(0, "127.0.0.1", () => {
  // This client never answers a FIN, so the server has to close the connection on its own.
  const client = net.connect({ port: server.address().port, host: "127.0.0.1", allowHalfOpen: true });
  let wroteAgain = false;
  let head = "";
  const onServerClosedConnection = () => {
    clientClosed = true;
    if (mode === "unfinished") reportUnfinished();
    else report();
  };
  client.on("error", () => {});
  client.on("end", onServerClosedConnection);
  client.on("close", onServerClosedConnection);
  client.on("data", chunk => {
    if (isLarge) {
      // Count the body of /first: no other response can follow it.
      if (head === undefined) {
        firstBodyBytes += chunk.length;
      } else {
        head += chunk.toString("latin1");
        const headEnd = head.indexOf("\r\n\r\n");
        if (headEnd === -1) return;
        firstBodyBytes = head.length - (headEnd + 4);
        head = undefined;
      }
      if (firstBodyBytes === firstBodyLength) report();
      return;
    }
    received += chunk.toString("latin1");
    switch (mode) {
      case "request":
      case "checkContinue":
      case "checkExpectation":
        if (received.includes("first-done")) report();
        break;
      case "ended":
      case "ended-later":
        if (received.includes("second")) report();
        break;
      case "constructor-response":
      case "constructor-request":
        // A response that took the turn of /second would show up here.
        if (received.includes("third")) report();
      // fallthrough
      case "not-pipelined":
        // One more request, after the first response is complete.
        if (received.includes("first-done") && !wroteAgain) {
          wroteAgain = true;
          client.write(get(mode === "not-pipelined" ? "/second" : "/third"));
        }
        break;
    }
  });
  client.write(written.get(mode) ?? pipelinedPair);
});
