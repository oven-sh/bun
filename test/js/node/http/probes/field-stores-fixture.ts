import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net, { type Socket } from "node:net";
import { RawHttpConnection, get } from "../raw-http-client.ts";
import {
  type Log,
  Report,
  ReusedConnection,
  attempt,
  exchangeState,
  formatResponse,
  formatValue,
  listen,
  readOrGiveUp,
  runProbe,
  untilDestroyed,
} from "./probe.ts";

interface Targets {
  req: any;
  res: any;
  socket: any;
  readableState: any;
  server: any;
}

interface Store {
  name: string;
  apply(targets: Targets): void;
  leavesResponseIncomplete?: boolean;
}

const assignments: [keyof Targets, string, unknown][] = [
  ["res", "shouldKeepAlive", false],
  ["res", "shouldKeepAlive", true],
  ["res", "sendDate", false],
  ["res", "useChunkedEncodingByDefault", false],
  ["res", "chunkedEncoding", true],
  ["res", "chunkedEncoding", false],
  ["res", "_hasBody", false],
  ["res", "_contentLength", 1],
  ["res", "_contentLength", 99],
  ["res", "_keepAliveTimeout", 9000],
  ["res", "_keepAliveTimeout", 0],
  ["res", "_last", true],
  ["res", "_removedConnection", true],
  ["res", "_removedContLen", true],
  ["res", "_removedTE", true],
  ["res", "_trailer", "X-T: 1\r\n"],
  ["res", "maxRequestsOnConnectionReached", true],
  ["res", "_defaultKeepAlive", false],
  ["res", "_maxRequestsPerSocket", 1],
  ["res", "statusCode", 201],
  ["res", "statusCode", "202"],
  ["res", "statusCode", 999],
  ["res", "statusCode", 1000],
  ["res", "statusCode", 99],
  ["res", "statusCode", null],
  ["res", "statusCode", 204],
  ["res", "statusCode", 304],
  ["res", "statusCode", 200.5],
  ["res", "statusMessage", "Custom"],
  ["res", "statusMessage", ""],
  ["res", "statusMessage", "bad\nmessage"],
  ["res", "statusMessage", 7],
  ["res", "_headerSent", true],
  ["res", "_header", "HTTP/1.1 299 Mine\r\nContent-Length: 2\r\n\r\n"],
  ["res", "writable", false],
  ["res", "finished", true],
  ["res", "destroyed", true],
  ["res", "_closed", true],
  ["res", "outputSize", 5],
  ["res", "socket", null],
  ["res", "connection", null],
  ["res", "req", null],
  ["res", "_events", undefined],
  ["res", "_events", null],
  ["res", "detachSocket", null],
  ["res", "_maxListeners", 1],
  ["res", "_expect_continue", true],
  ["res", "_sent100", true],
  ["req", "complete", false],
  ["req", "complete", true],
  ["req", "_dumped", true],
  ["req", "_dumped", false],
  ["req", "_consuming", true],
  ["req", "_consuming", false],
  ["req", "_closed", true],
  ["req", "aborted", true],
  ["req", "destroyed", true],
  ["req", "readable", false],
  ["req", "method", "HEAD"],
  ["req", "method", undefined],
  ["req", "upgrade", true],
  ["req", "socket", null],
  ["req", "connection", null],
  ["req", "client", null],
  ["req", "res", null],
  ["req", "url", undefined],
  ["req", "_readableState", null],
  ["req", "_readableState", undefined],
  ["req", "_readableState", 5],
  ["req", "_events", null],
  ["req", "_dump", null],
  ["readableState", "flowing", false],
  ["readableState", "ended", false],
  ["readableState", "autoDestroy", false],
  ["readableState", "emitClose", false],
  ["readableState", "highWaterMark", 1],
  ["readableState", "destroyed", true],
  ["readableState", "endEmitted", true],
  ["readableState", "closed", true],
  ["socket", "_paused", true],
  ["socket", "destroyed", true],
  ["socket", "_handle", null],
  ["socket", "_httpMessage", null],
  ["socket", "parser", null],
  ["socket", "server", null],
  ["socket", "_server", null],
  ["socket", "readable", false],
  ["socket", "_readableState", null],
  ["socket", "writable", false],
  ["socket", "timeout", 0],
  ["socket", "timeout", 1],
  ["server", "keepAliveTimeout", "5000"],
  ["server", "keepAliveTimeout", NaN],
  ["server", "keepAliveTimeout", -1],
  ["server", "keepAliveTimeout", 0],
  ["server", "keepAliveTimeout", 7000],
  ["server", "keepAliveTimeout", undefined],
  ["server", "keepAliveTimeoutBuffer", 0],
  ["server", "keepAliveTimeoutBuffer", 3000],
  ["server", "timeout", 9000],
  ["server", "timeout", "x"],
  ["server", "maxRequestsPerSocket", 2],
  ["server", "maxRequestsPerSocket", "2"],
  ["server", "maxHeadersCount", 1],
  ["server", "rejectNonStandardBodyWrites", true],
  ["server", "listening", false],
  ["server", "_connections", 0],
  ["server", "httpAllowHalfOpen", true],
];

const deletions: [keyof Targets, string][] = [
  ["res", "statusCode"],
  ["res", "sendDate"],
  ["res", "shouldKeepAlive"],
  ["res", "req"],
  ["res", "finished"],
  ["req", "complete"],
  ["req", "socket"],
  ["req", "_dumped"],
  ["req", "_consuming"],
];

const incompleteResponses = new Set([
  "res._hasBody = false",
  "res.finished = true",
  "res.destroyed = true",
  'res._trailer = "X-T: 1\\r\\n"',
]);

const stores: Store[] = [
  { name: "no store", apply() {} },
  ...assignments.map(([target, property, value]) => ({
    name: `${target}.${property} = ${formatValue(value)}`,
    apply: (targets: Targets) => void (targets[target][property] = value),
  })),
  ...deletions.map(([target, property]) => ({
    name: `delete ${target}.${property}`,
    apply: (targets: Targets) => void delete targets[target][property],
  })),
  {
    name: "res.strictContentLength = true with a longer Content-Length",
    apply({ res }) {
      res.strictContentLength = true;
      res.setHeader("Content-Length", 9);
    },
  },
  {
    name: "res.outputData = [a queued chunk]",
    apply({ res }) {
      res.outputData = [{ data: "zz", encoding: "latin1", callback: null }];
    },
  },
  {
    name: "res.req = another object",
    apply({ res }) {
      res.req = { method: "HEAD", headers: {} };
    },
  },
  {
    name: "res._events = {}",
    apply({ res }) {
      res._events = {};
      res._eventsCount = 0;
    },
  },
  {
    name: "properties frameworks add to res",
    apply({ res }) {
      res.locals = { a: 1 };
      res.app = {};
    },
  },
  {
    name: "req.httpVersion = 1.0",
    apply({ req }) {
      req.httpVersion = "1.0";
      req.httpVersionMajor = 1;
      req.httpVersionMinor = 0;
    },
  },
  {
    name: 'req.headers = { connection: "close" }',
    apply({ req }) {
      req.headers = { connection: "close" };
    },
  },
  {
    name: 'req.headers.connection = "close"',
    apply({ req }) {
      req.headers.connection = "close";
    },
  },
  {
    name: "req.rawHeaders = []",
    apply({ req }) {
      req.rawHeaders = [];
    },
  },
  {
    name: "req._events = {}",
    apply({ req }) {
      req._events = {};
      req._eventsCount = 0;
    },
  },
  {
    name: "properties frameworks add to req",
    apply({ req, res }) {
      req.params = {};
      req.body = 1;
      req.res = res;
      req.next = () => {};
    },
  },
  {
    name: "req._consuming = true and req._readableState = null",
    apply({ req }) {
      req._consuming = true;
      req._readableState = null;
    },
  },
  ...["req._dump", "req.resume", "req.removeAllListeners", "res.detachSocket"].map(path => ({
    name: `${path} = a function that throws`,
    apply(targets: Targets) {
      const [target, method] = path.split(".") as [keyof Targets, string];
      targets[target][method] = () => {
        throw new Error("thrown by a replaced method");
      };
    },
  })),
  {
    name: "req.socket = another socket",
    apply({ req }) {
      req.socket = new net.Socket();
    },
  },
  {
    name: "req.socket = {}",
    apply({ req }) {
      req.socket = {};
    },
  },
  {
    name: "req._readableState = {}",
    apply({ req }) {
      req._readableState = {};
    },
  },
  {
    name: "readableState.errored = an error",
    apply({ readableState }) {
      readableState.errored = new Error("stored by the test");
    },
  },
  {
    name: "socket._events = {}",
    apply({ socket }) {
      socket._events = {};
      socket._eventsCount = 0;
    },
  },
  {
    name: "properties programs add to the socket",
    apply({ socket }) {
      socket.id = "x";
    },
  },
].map(store => ({ ...store, leavesResponseIncomplete: incompleteResponses.has(store.name) }));

const responders: Record<string, (res: ServerResponse) => void> = {
  "end(body)": res => void res.end("ok"),
  "writeHead(), write(), end()": res => {
    res.writeHead(res.statusCode, { "content-type": "text/plain", "content-length": "2" });
    res.write("ok");
    res.end(null);
  },
  "write(), end(body)": res => {
    res.write("o");
    res.end("k");
  },
};

const [moment = "before", listeners = "none", filter = ""] = process.argv.slice(2);

const report = new Report();
report.recordUncaughtErrors();

let store: Store;
let respond: (res: ServerResponse) => void;
let exchange: { req: IncomingMessage; res: ServerResponse; socket: Socket } | undefined;

const server = http.createServer((req, res) => {
  if (req.url === "/warm-up") return void res.end("ok");
  const log = report.current;
  const socket = req.socket;
  exchange = { req, res, socket };
  if (listeners !== "none") {
    res.on("finish", () => {});
    res.on("close", () => {});
  }
  if (listeners === "both") {
    req.on("end", () => {});
    req.on("close", () => {});
  }
  const targets = { req, res, socket, server, readableState: (req as any)._readableState };
  let failed = false;
  const step = (name: string, run: () => void) => {
    const outcome = attempt(() => (run(), "done"));
    failed ||= outcome !== "done";
    log(name, outcome);
  };
  const applyStore = () =>
    log(
      "store:",
      attempt(() => (store.apply(targets), "done")),
    );
  if (moment === "before") {
    applyStore();
    step("respond:", () => respond(res));
  } else if (moment === "after") {
    step("respond:", () => respond(res));
    applyStore();
  } else if (moment === "microtask") {
    step("respond:", () => respond(res));
    queueMicrotask(applyStore);
  } else {
    step("write:", () => res.write("o"));
    applyStore();
    step("end:", () => res.end("k"));
  }
  log("when the listener returns:", exchangeState(req, res));
  if (failed || store.leavesResponseIncomplete) setImmediate(() => socket.destroy());
});

const serverFields = [
  ...new Set(assignments.filter(([target]) => target === "server").map(([, property]) => property)),
];
const serverDefaults = serverFields.map(property => [property, (server as any)[property]] as const);

function forgetExchange() {
  exchange = undefined;
}

function lastSocket() {
  return exchange?.socket;
}

function logExchangeState(log: Log, moment: string) {
  if (exchange) log(moment, exchangeState(exchange.req, exchange.res));
}

runProbe(async () => {
  const port = await listen(server);
  const reused = new ReusedConnection(port);

  for (const currentStore of stores.filter(({ name }) => name.includes(filter))) {
    for (const [responderName, responder] of Object.entries(
      moment === "between" ? { "write(), end(body)": () => {} } : responders,
    )) {
      store = currentStore;
      respond = responder;
      forgetExchange();
      const log = report.start(`${store.name}, ${responderName}`);
      const changesConnection = /socket|^server\./.test(store.name);
      if (changesConnection) reused.discard();
      const connection = changesConnection ? await RawHttpConnection.connect(port) : await reused.acquire();
      for (let request = 0; request < 3; request++) {
        report.startBlock();
        connection.send(get("/"));
        const response = await readOrGiveUp(connection);
        log("response:", formatResponse(response));
        logExchangeState(log, "after the response:");
        if (response.startsWith("closed") || response === "no response") break;
      }
      report.startBlock();
      if (changesConnection) {
        connection[Symbol.dispose]();
        await untilDestroyed(lastSocket());
        logExchangeState(log, "after the connection closed:");
      } else {
        log("the connection serves another request:", await reused.release());
      }
      for (const [property, value] of serverDefaults) attempt(() => ((server as any)[property] = value));
    }
  }

  reused.discard();
  server.close();
  server.closeAllConnections();
  report.print();
});
