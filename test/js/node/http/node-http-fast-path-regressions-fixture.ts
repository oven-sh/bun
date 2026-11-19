import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

type Log = (...entries: unknown[]) => void;

interface Scenario {
  configure?(server: Server, log: Log): void;
  handle(req: IncomingMessage, res: ServerResponse & Record<string, any>, log: Log): void;
}

const lengthOfFive = { "content-type": "text/plain", "content-length": "5" };

function codeOf(run: () => unknown) {
  try {
    run();
    return "no error";
  } catch (error: any) {
    return error.code ?? error.message;
  }
}

function logEmittedEvents(emitter: any, name: string, log: Log) {
  const emit = emitter.emit;
  emitter.emit = function (event: string | symbol) {
    log(`${name} ${String(event)}`);
    return emit.apply(this, arguments);
  };
}

const scenarios: Record<string, Scenario> = {
  "string-keep-alive-timeout": {
    configure(server) {
      server.keepAliveTimeout = "5000" as any;
    },
    handle(req, res) {
      res.end("ok");
    },
  },
  "replaced-status-message": {
    configure() {
      http.STATUS_CODES[200] = "Alright";
    },
    handle(req, res, log) {
      if (req.url === "/with-headers") res.writeHead(200, { "content-length": "2" });
      else res.writeHead(200);
      res.end("ok");
      log(req.url, res.statusMessage);
    },
  },
  "null-request-before-end": {
    handle(req, res) {
      res.req = null;
      res.end("ok");
    },
  },
  "deleted-request-before-end": {
    handle(req, res) {
      delete res.req;
      res.end("ok");
    },
  },
  "null-request-after-end": {
    handle(req, res) {
      res.end("ok");
      res.req = null;
    },
  },
  "null-request-between-write-and-end": {
    handle(req, res) {
      res.write("o");
      res.req = null;
      res.end("k");
    },
  },
  "null-socket-parser": {
    handle(req, res) {
      (req.socket as any).parser = null;
      res.end("ok");
    },
  },
  "null-socket-server": {
    handle(req, res) {
      (req.socket as any).server = null;
      res.end("ok");
    },
  },
  "undefined-response-events": {
    handle(req, res) {
      res._events = undefined;
      res.end("ok");
    },
  },
  "assigned-header-text": {
    handle(req, res, log) {
      res._header = "HTTP/1.1 299 Mine\r\nContent-Length: 2\r\n\r\n";
      log(codeOf(() => res.writeHead(200, { "content-length": "2" })));
      req.socket.destroy();
    },
  },
  "closed-flag-before-end": {
    handle(req, res) {
      res._closed = true;
      res.end("ok");
    },
  },
  "writable-length-with-content-length": {
    handle(req, res, log) {
      const [, shape, size] = req.url!.split("/");
      if (shape === "seven-headers") for (let i = 0; i < 7; i++) res.setHeader("X-H" + i, "v");
      if (shape === "forty-headers") for (let i = 0; i < 40; i++) res.setHeader("X-H" + i, "v");
      if (shape === "array-value") res.setHeader("X-A", ["1", "2"]);
      if (shape === "removed-header") {
        res.setHeader("X-A", "1");
        res.removeHeader("X-A");
      }
      if (shape === "appended-header") res.appendHeader("X-A", "1");
      if (shape === "headers-read-first") res.getHeaders();
      const body = Buffer.alloc(Number(size), "x").toString();
      res.setHeader("Content-Length", body.length);
      const canWriteMore = res.write(body);
      log(req.url, canWriteMore, res.writableLength, res.writableNeedDrain);
      res.end();
    },
  },
  "writable-length-after-first-write": {
    handle(req, res, log) {
      res.writeHead(200, lengthOfFive);
      res.write("hello");
      log(res.writableLength, req.socket.bytesWritten > 0);
      res.end();
    },
  },
  "header-names-after-removing-every-header": {
    handle(req, res, log) {
      res.appendHeader("x-n0", "v4");
      res.removeHeader("x-n0");
      log(res._headerNames);
      res.end("ok");
    },
  },
  "empty-array-content-length": {
    handle(req, res) {
      res.setHeader("content-length", []);
      res.write("ok");
      res.end();
    },
  },
  "event-names-without-listeners": {
    handle(req, res, log) {
      log(req.eventNames(), res.eventNames(), req.listenerCount("data"), res.listenerCount("finish"));
      res.end("ok");
    },
  },
  "deprecated-header-accessors": {
    handle(req, res, log) {
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("X-A", "1");
      log(res._headerNames, res._headers, res._renderHeaders());
      res._headers = { "x-b": "2" };
      log(res.getHeaders());
      res.end("ok");
    },
  },
  "content-length-field": {
    handle(req, res, log) {
      res.writeHead(200, { "content-length": "2" });
      res.write("ok");
      res.end(null);
      log(res._contentLength);
    },
  },
  "replaced-write-head": {
    handle(req, res) {
      const writeHead = res.writeHead;
      res.writeHead = function () {
        this.setHeader("X-On-Headers", "yes");
        return writeHead.apply(this, arguments as any);
      } as any;
      if (req.url === "/write") res.write("o");
      if (req.url === "/flush-headers") res.flushHeaders();
      res.end(req.url === "/write" ? "k" : "ok");
    },
  },
  "replaced-set-header": {
    handle(req, res, log) {
      const setHeader = res.setHeader;
      res.setHeader = function (name: string) {
        log(name);
        return setHeader.apply(this, arguments as any);
      } as any;
      res.writeHead(200, { "x-a": "1", "content-length": "2" });
      res.end("ok");
    },
  },
  "replaced-emit": {
    handle(req, res, log) {
      logEmittedEvents(res, "res", log);
      logEmittedEvents(req, "req", log);
      if (req.url === "/immediate") setImmediate(() => res.end("ok"));
      else res.end("ok");
    },
  },
  "replaced-prototype-emit": {
    configure(server, log) {
      logEmittedEvents(http.ServerResponse.prototype, "res", log);
    },
    handle(req, res) {
      res.end("ok");
    },
  },
  "replaced-detach-socket-after-end": {
    handle(req, res, log) {
      res.end("ok");
      const detachSocket = res.detachSocket;
      res.detachSocket = function (socket: any) {
        log("detachSocket");
        return detachSocket.call(this, socket);
      };
    },
  },
  "throw-after-write": {
    configure(server, log) {
      process.on("uncaughtException", error => log("uncaught", error.message));
    },
    handle(req, res) {
      res.writeHead(200, lengthOfFive);
      res.write("hello");
      setImmediate(() => res.end());
      throw new Error("thrown by the request listener");
    },
  },
  "socket-end-after-write": {
    handle(req, res) {
      res.writeHead(200, lengthOfFive);
      res.write("hello");
      req.socket.end();
    },
  },
  "socket-write-after-write": {
    handle(req, res) {
      res.writeHead(200, lengthOfFive);
      res.write("hello");
      req.socket.write("RAW");
      res.end();
      req.socket.end();
    },
  },
  "empty-header-name": {
    handle(req, res, log) {
      log(codeOf(() => res.setHeader("", "v")));
      res.end("ok");
    },
  },
  "end-after-socket-destroy": {
    handle(req, res, log) {
      for (const event of ["finish", "close", "error"]) res.on(event, () => log("res " + event));
      for (const event of ["aborted", "close"]) req.on(event, () => log("req " + event));
      req.on("error", (error: any) => log("req error " + error.code));
      req.socket.destroy();
      res.end("hi", () => log("end callback"));
    },
  },
  "mutated-request-arrays": {
    handle(req, res, log) {
      log(req.rawHeaders.length, req.rawTrailers.length, Object.keys(req.headers), Object.keys(req.trailers));
      req.rawHeaders.push("X-Leaked", "1");
      req.rawTrailers.push("X-Leaked", "1");
      req.headers["x-leaked"] = "1";
      req.trailers["x-leaked"] = "1";
      res.end("ok");
    },
  },
  "remove-all-listeners-after-body": {
    handle(req, res) {
      req.on("data", () => {});
      req.on("end", () => {
        res.removeAllListeners();
        res.end("ok");
      });
    },
  },
};

process.noDeprecation = true;

const scenario = scenarios[process.argv[2]];
const entries: unknown[][] = [];
const log: Log = (...entry) => void entries.push(entry);
const exchanges: [IncomingMessage, ServerResponse][] = [];

const server = http.createServer((req, res) => {
  if (req.url === "/warm-up") return void res.end("ok");
  exchanges.push([req, res]);
  scenario.handle(req, res, log);
});
scenario.configure?.(server, log);

process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  server.close(() =>
    setImmediate(() =>
      console.log(
        JSON.stringify({
          log: entries,
          requestsDestroyed: exchanges.map(([req]) => req.destroyed),
          responsesDestroyed: exchanges.map(([, res]) => res.destroyed),
        }),
      ),
    ),
  );
});

server.listen(0, "127.0.0.1", () => console.log((server.address() as any).port));
