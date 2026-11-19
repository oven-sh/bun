import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { RawHttpConnection, get } from "../raw-http-client.ts";
import {
  type Log,
  Report,
  ReusedConnection,
  attempt,
  endAfterTwoTurns,
  exchangeState,
  formatResponse,
  formatValue,
  listen,
  readOrGiveUp,
  readUntilCloseOrGiveUp,
  runProbe,
  untilDestroyed,
} from "./probe.ts";

const values: Record<string, unknown> = {
  "a numeric string": "5000",
  "a status code string": "201",
  "an empty string": "",
  "0": 0,
  "1": 1,
  "-1": -1,
  "1.5": 1.5,
  "NaN": NaN,
  "Infinity": Infinity,
  "null": null,
  "undefined": undefined,
  "true": true,
  "false": false,
  "a bigint": 10n,
  "an empty object": {},
  "an empty array": [],
  "an array of one string": ["1"],
  "an object with toString()": {
    toString() {
      return "fromToString";
    },
  },
  "an object with valueOf()": {
    valueOf() {
      return 201;
    },
  },
  "a String object": Object("b"),
  "a Number object": Object(7),
  "a Date": new Date(0),
  "a Buffer": Buffer.from("bf"),
  "a Uint8Array": new Uint8Array([111, 107]),
  "an ArrayBuffer": new Uint8Array([111, 107]).buffer,
  "a DataView": new DataView(new Uint8Array([111, 107]).buffer),
  "a function": function f() {},
  "a symbol": Symbol("s"),
};

type Use = (
  req: IncomingMessage & Record<string, any>,
  res: ServerResponse & Record<string, any>,
  value: any,
  log: Log,
) => void;

function thenEnd(use: (res: ServerResponse & Record<string, any>, value: any) => void): Use {
  return (req, res, value) => {
    use(res, value);
    res.end("ok");
  };
}

function thenWriteAndEnd(use: (res: ServerResponse & Record<string, any>, value: any) => void): Use {
  return (req, res, value) => {
    use(res, value);
    res.write("o");
    res.end("k");
  };
}

const uses: Record<string, Use> = {
  "res.end(value)": (req, res, value) => void res.end(value),
  "res.end(body, value)": (req, res, value) => void res.end("ok", value),
  "res.end(body, encoding, value)": (req, res, value) => void res.end("ok", "utf8", value),
  "res.write(value)": (req, res, value) => {
    res.write(value);
    res.end();
  },
  "res.write(body, value)": (req, res, value) => {
    res.write("ok", value);
    res.end();
  },
  "res.writeHead(value)": thenEnd((res, value) => res.writeHead(value)),
  "res.writeHead(200, value)": thenEnd((res, value) => res.writeHead(200, value)),
  "res.writeHead(200, message, value)": thenEnd((res, value) => res.writeHead(200, "M", value)),
  "res.writeHead(200, { name: value })": thenEnd((res, value) => res.writeHead(200, { "x-v": value })),
  "res.writeHead(200, { content-length: value })": thenEnd((res, value) =>
    res.writeHead(200, { "content-length": value }),
  ),
  "res.writeHead(200, [name, value])": thenEnd((res, value) => res.writeHead(200, ["x-v", value])),
  "res.setHeader(name, value)": thenEnd((res, value) => res.setHeader("x-v", value)),
  "res.setHeader(value, text)": thenEnd((res, value) => res.setHeader(value, "1")),
  "res.setHeader(content-length, value)": thenEnd((res, value) => res.setHeader("content-length", value)),
  "res.setHeader(content-length, value), write()": (req, res, value) => {
    res.setHeader("content-length", value);
    res.write("ok");
    res.end();
  },
  "res.setHeader(connection, value)": thenEnd((res, value) => res.setHeader("connection", value)),
  "res.setHeader(transfer-encoding, value)": thenEnd((res, value) => res.setHeader("transfer-encoding", value)),
  "res.setHeader(date, value)": thenEnd((res, value) => res.setHeader("date", value)),
  "res.setHeader(keep-alive, value)": thenEnd((res, value) => res.setHeader("keep-alive", value)),
  "res.appendHeader(name, value)": thenEnd((res, value) => res.appendHeader("x-v", value)),
  "res.removeHeader(value)": thenEnd((res, value) => {
    res.setHeader("x-a", "1");
    res.removeHeader(value);
  }),
  "res.getHeader(value)": (req, res, value, log) => {
    res.setHeader("x-a", "1");
    log(formatValue(res.getHeader(value)), formatValue(res.hasHeader(value)));
    res.end("ok");
  },
  "res.setHeaders(value)": thenEnd((res, value) => res.setHeaders(value)),
  "res.statusCode = value": thenEnd((res, value) => (res.statusCode = value)),
  "res.statusCode = value, writeHead()": thenEnd((res, value) => {
    res.statusCode = value;
    res.writeHead(res.statusCode, { "content-length": "2" });
  }),
  "res.statusMessage = value": thenEnd((res, value) => (res.statusMessage = value)),
  "res.sendDate = value": thenEnd((res, value) => (res.sendDate = value)),
  "res.shouldKeepAlive = value": thenEnd((res, value) => (res.shouldKeepAlive = value)),
  "res.strictContentLength = value": thenEnd((res, value) => {
    res.strictContentLength = value;
    res.setHeader("content-length", 9);
  }),
  "res.chunkedEncoding = value": thenWriteAndEnd((res, value) => (res.chunkedEncoding = value)),
  "res.useChunkedEncodingByDefault = value": thenWriteAndEnd((res, value) => (res.useChunkedEncodingByDefault = value)),
  "res._keepAliveTimeout = value": thenEnd((res, value) => (res._keepAliveTimeout = value)),
  "res._contentLength = value": thenEnd((res, value) => (res._contentLength = value)),
  "res.setTimeout(value)": thenEnd((res, value) => res.setTimeout(value)),
  "req.setTimeout(value)": (req, res, value) => {
    req.setTimeout(value);
    res.end("ok");
  },
  "socket.setTimeout(value)": (req, res, value) => {
    req.socket.setTimeout(value);
    res.end("ok");
  },
  "res.addTrailers(value)": (req, res, value) => {
    res.write("o");
    res.addTrailers(value);
    res.end("k");
  },
  "res.writeContinue(value)": thenEnd((res, value) => res.writeContinue(value)),
  "res.writeEarlyHints(value)": thenEnd((res, value) => res.writeEarlyHints(value)),
  "res.setDefaultEncoding(value)": thenEnd((res, value) => res.setDefaultEncoding?.(value)),
  "res.flushHeaders(value)": thenEnd((res, value) => (res.flushHeaders as any)(value)),
  "res.destroy(value)": (req, res, value) => {
    res.on("error", () => {});
    res.destroy(value);
  },
  "req.destroy(value)": (req, res, value) => {
    req.on("error", () => {});
    req.destroy(value);
  },
  "req.setEncoding(value)": (req, res, value) => {
    req.setEncoding(value);
    res.end("ok");
  },
  "res.on(value)": thenEnd((res, value) => res.on(value, () => {})),
  "res.emit(value)": thenEnd((res, value) => res.emit(value)),
  "res.setMaxListeners(value)": thenEnd((res, value) => res.setMaxListeners(value)),
};

const serverFields = [
  "keepAliveTimeout",
  "keepAliveTimeoutBuffer",
  "timeout",
  "headersTimeout",
  "requestTimeout",
  "maxRequestsPerSocket",
  "maxHeadersCount",
  "connectionsCheckingInterval",
  "rejectNonStandardBodyWrites",
  "insecureHTTPParser",
  "joinDuplicateHeaders",
  "highWaterMark",
  "requireHostHeader",
  "shouldUpgradeCallback",
  "optimizeEmptyRequests",
  "noDelay",
  "keepAlive",
  "keepAliveInitialDelay",
  "maxConnections",
  "maxHeaderSize",
  "httpAllowHalfOpen",
];

const startsTimer = /Timeout|timeout|Interval|Delay/;
const changesFraming =
  /content-length|transfer-encoding|connection|_contentLength|strictContentLength|hunkedEncoding|statusCode|writeHead\(value\)|addTrailers|writeContinue|writeEarlyHints|res\.end\(value\)|res\.write\(value\)/;

function isShortDelay(value: unknown) {
  if (typeof value === "symbol" || typeof value === "bigint") return false;
  const delay = Number(value);
  return delay > 0 && delay < 4000;
}

const [listeners = "none", filter = ""] = process.argv.slice(2);

const report = new Report();
report.recordUncaughtErrors();

let use: Use;
let value: unknown;
let closesAfterResponse = false;
let exchange: { req: IncomingMessage; res: ServerResponse; socket: Socket } | undefined;

const server = http.createServer((req, res) => {
  if (req.url === "/warm-up") return void res.end("ok");
  const log = report.current;
  if (closesAfterResponse) endAfterTwoTurns(req.socket);
  exchange = { req, res, socket: req.socket };
  if (listeners !== "none") {
    res.on("finish", () => {});
    res.on("close", () => {});
  }
  if (listeners === "both") {
    req.on("end", () => {});
    req.on("close", () => {});
  }
  const outcome = attempt(() => (use(req, res, value, log), "done"));
  log(outcome);
  if (outcome !== "done" && !res.writableEnded && !res.destroyed) {
    const fallback = attempt(() => (res.end("threw"), "done"));
    log("fallback:", fallback);
    if (fallback !== "done") req.socket.destroy();
  }
});

for (const field of serverFields) {
  uses[`server.${field} = value`] = (req, res, fieldValue) => {
    (server as any)[field] = fieldValue;
    res.end("ok");
  };
}
const serverDefaults = serverFields.map(field => [field, (server as any)[field]] as const);

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

  for (const [useName, currentUse] of Object.entries(uses)) {
    for (const [valueName, currentValue] of Object.entries(values)) {
      const name = `${useName}, ${valueName}`;
      if (!name.includes(filter)) continue;
      if (startsTimer.test(useName) && isShortDelay(currentValue)) continue;
      use = currentUse;
      value = currentValue;
      forgetExchange();
      closesAfterResponse = changesFraming.test(useName);
      const log = report.start(name);
      const changesConnection = /^socket\.|^server\.|setTimeout/.test(useName);
      if (changesConnection) reused.discard();
      const connection = changesConnection ? await RawHttpConnection.connect(port) : await reused.acquire();
      if (closesAfterResponse) {
        connection.send(get("/"));
        log("until the connection closed:", formatResponse(await readUntilCloseOrGiveUp(connection)));
        logExchangeState(log, "after the response:");
        reused.discard();
      } else {
        for (let request = 0; request < 3; request++) {
          report.startBlock();
          connection.send(get("/"));
          const response = await readOrGiveUp(connection);
          log("response:", formatResponse(response));
          logExchangeState(log, "after the response:");
          if (response.startsWith("closed") || response === "no response") break;
        }
        report.startBlock();
        if (changesConnection) connection[Symbol.dispose]();
        else log("the connection serves another request:", await reused.release());
      }
      if (changesConnection || closesAfterResponse) await untilDestroyed(lastSocket());
      for (const [field, fieldValue] of serverDefaults) attempt(() => ((server as any)[field] = fieldValue));
    }
  }

  reused.discard();
  server.close();
  server.closeAllConnections();
  report.print();
});
