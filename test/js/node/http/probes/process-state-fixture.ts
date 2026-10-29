import events from "node:events";
import http, { type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import stream from "node:stream";
import { Worker } from "node:worker_threads";
import { RawHttpConnection, get } from "../raw-http-client.ts";
import { type Log, Report, attempt, formatResponse, formatValue, listen, readOrGiveUp, runProbe } from "./probe.ts";

const mode = process.argv[2] ?? "unchanged";

type Responder = (res: ServerResponse & Record<string, any>, req: IncomingMessage, log: Log) => void;

const responders: Record<string, Responder> = {
  "end(body)": res => void res.end("ok"),
  "statusCode = 201": res => {
    res.statusCode = 201;
    res.end("ok");
  },
  "writeHead(200, headers)": res => {
    res.writeHead(200, { "content-type": "text/plain", "content-length": "2" });
    res.end("ok");
  },
  "writeHead(202, headers) without a length": res => {
    res.writeHead(202, { "x-a": "1" });
    res.end("ok");
  },
  "array and appended headers": res => {
    res.setHeader("x-n1", ["a", "b"]);
    res.setHeader("set-cookie", ["c=1", "d=2"]);
    res.setHeader("x-n2", "v");
    res.appendHeader("x-n2", "w");
    res.end("ok");
  },
  "write(), end(body)": res => {
    res.setHeader("x-n1", "one");
    res.write("o");
    res.end("k");
  },
  "statusCode = 299": res => {
    res.statusCode = 299;
    res.end("ok");
  },
  "statusMessage": res => {
    res.statusCode = 200;
    res.statusMessage = "Mine";
    res.end("ok");
  },
  "finish and close listeners": (res, req, log) => {
    res.on("finish", () => log("finish"));
    res.on("close", () => log("close"));
    res.end("ok");
  },
  "high-water marks": (res, req, log) => {
    log(
      "high-water marks",
      res.writableHighWaterMark,
      req.readableHighWaterMark,
      req.socket.writableHighWaterMark,
      req.socket.readableHighWaterMark,
    );
    log("write() returns", res.write("hello"), "writableNeedDrain", res.writableNeedDrain, res.writableLength);
    res.end();
  },
  "three listeners per event": (res, req) => {
    for (let i = 0; i < 3; i++) {
      res.on("finish", () => {});
      req.on("close", () => {});
      req.socket.on("timeout", () => {});
    }
    res.end("ok");
  },
  "async finish listener that rejects": (res, req, log) => {
    res.on("finish", async () => {
      throw new Error("rejected by an async listener");
    });
    res.on("error", error => log("res error", error.message));
    res.end("ok");
  },
  "write() after end()": (res, req, log) => {
    res.end("ok");
    log(attempt(() => res.write("late")));
    res.on("error", (error: any) => log("res error", error.code));
  },
  "deprecated _headers getter": (res, req, log) => {
    res.setHeader("x-a", "1");
    log(attempt(() => res._headers));
    res.end("ok");
  },
};

const report = new Report();

function listener(): RequestListener {
  return (req, res: ServerResponse & Record<string, any>) => {
    const log = report.current;
    const outcome = attempt(() => (responders[decodeURIComponent(req.url!.slice(1))](res, req, log), "done"));
    log(outcome, "statusMessage", formatValue(res.statusMessage), "keep-alive", formatValue(res._keepAliveTimeout));
  };
}

function replaceStatusCodes() {
  http.STATUS_CODES[200] = "Alright";
  http.STATUS_CODES[201] = "Made";
  http.STATUS_CODES[299] = "Odd";
  delete http.STATUS_CODES[202];
}

const changesBeforeListening: Record<string, () => void> = {
  "status-codes": replaceStatusCodes,
  "prototype-defaults": () => {
    (http.ServerResponse.prototype as any).statusMessage = "FromPrototype";
    (http.OutgoingMessage.prototype as any).extra = 1;
    (http.IncomingMessage.prototype as any).extra = 2;
  },
  "prototype-send-date": () =>
    void Object.defineProperty(http.OutgoingMessage.prototype, "sendDate", {
      value: false,
      writable: true,
      configurable: true,
    }),
  "replaced-validators": () => {
    attempt(() => {
      (http as any).validateHeaderName = () => {
        throw new Error("replaced validateHeaderName");
      };
      (http as any).validateHeaderValue = () => {
        throw new Error("replaced validateHeaderValue");
      };
    });
  },
  "empty-methods": () => void (http.METHODS.length = 0),
  "max-header-size": () => void attempt(() => ((http as any).maxHeaderSize = 10)),
  "replaced-emit-warning": () =>
    void (process.emitWarning = (warning: any) => report.current("emitWarning", String(warning).slice(0, 60))),
  "default-max-listeners-1": () => void (events.defaultMaxListeners = 1),
  "default-max-listeners-0": () => void (events.defaultMaxListeners = 0),
  "capture-rejections": () => void (events.captureRejections = true),
  "default-high-water-mark-1": () => stream.setDefaultHighWaterMark(false, 1),
  "throw-deprecation": () => void (process.throwDeprecation = true),
  "stack-trace-limit-0": () => void (Error.stackTraceLimit = 0),
  "prepare-stack-trace": () => void (Error.prepareStackTrace = () => "prepared"),
  "replaced-date": () => {
    const OriginalDate = Date;
    globalThis.Date = class extends OriginalDate {
      constructor(...args: any[]) {
        super(...((args.length ? args : [0]) as [number]));
      }
      static now() {
        return 0;
      }
    } as DateConstructor;
  },
};

const changesAfterSixRequests: Record<string, () => void> = {
  "status-codes-changed-later": replaceStatusCodes,
  "default-high-water-mark-changed-later": () => stream.setDefaultHighWaterMark(false, 3),
};

function createServers(): Server[] {
  switch (mode) {
    case "server-subclass": {
      class LoggingServer extends http.Server {
        emit(event: string, ...args: any[]) {
          if (event === "request") report.current("LoggingServer.emit request");
          return super.emit(event, ...args);
        }
      }
      return [new LoggingServer({}, listener())];
    }
    case "empty-server-subclass": {
      class EmptySubclass extends http.Server {}
      return [new EmptySubclass(listener())];
    }
    case "server-called-without-new":
      return [(http.Server as any)(listener())];
    case "server-with-another-prototype": {
      const server = http.createServer(listener());
      Object.setPrototypeOf(server, Object.create(http.Server.prototype, { tag: { value: "swapped" } }));
      return [server];
    }
    case "two-servers":
      return [
        http.createServer({ uniqueHeaders: ["x-n1", "x-n2", "set-cookie"], keepAliveTimeout: 9000 }, listener()),
        http.createServer({ keepAliveTimeout: 30000 }, listener()),
      ];
    case "two-servers-with-joined-headers":
      return [
        http.createServer({ uniqueHeaders: ["x-n1", "x-n2", "set-cookie"], keepAliveTimeout: 9000 }, listener()),
        http.createServer(
          { joinDuplicateHeaders: true, keepAliveTimeout: 0, rejectNonStandardBodyWrites: true },
          listener(),
        ),
      ];
    default:
      return [http.createServer(listener())];
  }
}

if (mode === "worker") {
  const worker = new Worker(import.meta.filename, { argv: ["unchanged"] });
  worker.on("error", error => {
    console.error(error);
    process.exit(1);
  });
} else {
  runProbe(async () => {
    report.recordUncaughtErrors();
    process.on("warning", warning => report.current("warning", warning.name, warning.message.slice(0, 100)));
    process.noDeprecation = false;
    const servers = createServers();
    changesBeforeListening[mode]?.();
    const ports: number[] = [];
    for (const server of servers) ports.push(await listen(server));

    const names = Object.keys(responders);
    for (const [index, name] of names.entries()) {
      if (index === 2) changesAfterSixRequests[mode]?.();
      const log = report.start(name);
      const connections: RawHttpConnection[] = [];
      for (const port of ports) connections.push(await RawHttpConnection.connect(port));
      for (let request = 0; request < 3; request++) {
        report.startBlock();
        for (const connection of connections) {
          connection.send(get("/" + encodeURIComponent(name)));
          log("response:", formatResponse(await readOrGiveUp(connection)));
        }
      }
      for (const connection of connections) connection[Symbol.dispose]();
    }

    for (const server of servers) {
      server.close();
      server.closeAllConnections();
    }
    report.print();
  });
}
