import type { EventEmitter } from "node:events";
import http, { type ServerResponse } from "node:http";
import stream from "node:stream";
import { RawHttpConnection, get, post } from "../raw-http-client.ts";
import { type Log, Report, formatResponse, formatValue, listen, nextTurn, readOrGiveUp, runProbe } from "./probe.ts";

const [forwarding = "pipe", observers = "all", agentKind = "keep-alive"] = process.argv.slice(2);

const report = new Report();
report.recordUncaughtErrors();

let eventsByEmitter = new Map<string, string[]>();

function observe(name: string, emitter: EventEmitter, events: string[]) {
  if (observers !== "all") return;
  const seen: string[] = [];
  eventsByEmitter.set(name, seen);
  for (const event of events) {
    emitter.on(event, (error?: any) => seen.push(event + (error instanceof Error ? " " + (error as any).code : "")));
  }
}

function recordPipelineResult(name: string, error: NodeJS.ErrnoException | null | undefined) {
  eventsByEmitter.set(name, [formatValue(error?.code)]);
}

function logEvents(log: Log) {
  for (const [name, seen] of [...eventsByEmitter].sort(([a], [b]) => (a < b ? -1 : 1)))
    log(`${name}:`, seen.join(", "));
  eventsByEmitter = new Map();
}

let streams: { destroyed: boolean }[] = [];

async function untilEveryStreamIsDestroyed() {
  for (let turn = 0; turn < 1000 && streams.some(stream => !stream.destroyed); turn++) await nextTurn();
  streams = [];
}

const afterTwoTurns = (run: () => void) => void setImmediate(() => setImmediate(run));
const largeBody = Buffer.alloc(200000, "b").toString();

const upstreamResponders: Record<string, (req: http.IncomingMessage, res: ServerResponse) => void> = {
  "text": (req, res) => void res.end("hello"),
  "json": (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end('{"a":1}');
  },
  "cookies": (req, res) => {
    res.setHeader("Set-Cookie", ["a=1", "b=2"]);
    res.setHeader("Vary", "Accept");
    res.writeHead(200, { "x-up": "1" });
    res.end("cookies");
  },
  "large": (req, res) => void res.end(largeBody),
  "stream": (req, res) => {
    res.write("one ");
    setImmediate(() => {
      res.write("two ");
      afterTwoTurns(() => res.end("three"));
    });
  },
  "no-content": (req, res) => {
    res.statusCode = 204;
    res.end();
  },
  "not-modified": (req, res) => {
    res.writeHead(304, { etag: "x" });
    res.end();
  },
  "redirect": (req, res) => {
    res.writeHead(302, { location: "/text" });
    res.end();
  },
  "server-error": (req, res) => {
    res.statusCode = 500;
    res.end("broken");
  },
  "delayed": (req, res) => afterTwoTurns(() => res.end("delayed")),
  "destroyed-midway": (req, res) => {
    res.write("part");
    afterTwoTurns(() => res.destroy());
  },
  "reset": req => void req.socket.destroy(),
  "echo": (req, res) => {
    res.setHeader("Content-Type", "text/plain");
    req.pipe(res);
  },
  "count": (req, res) => {
    let length = 0;
    req.on("data", chunk => (length += chunk.length));
    req.on("end", () => res.end(String(length)));
  },
};

const upstream = http.createServer((req, res) => {
  const log = report.current;
  streams.push(req, res);
  observe("upstream req", req, ["end", "close", "aborted", "error"]);
  observe("upstream res", res, ["finish", "close", "error"]);
  log("upstream listener", req.method!, req.url!, formatValue(req.headers["x-forwarded"]));
  upstreamResponders[req.url!.slice(1)](req, res);
});

const agent = new http.Agent({ keepAlive: agentKind === "keep-alive", maxSockets: 4 });
let upstreamPort = 0;

const front = http.createServer((req, res) => {
  const log = report.current;
  streams.push(req, res);
  observe("front req", req, ["end", "close", "aborted", "error"]);
  observe("front res", res, ["finish", "close", "error"]);
  const proxied = http.request(
    {
      port: upstreamPort,
      host: "127.0.0.1",
      method: req.method,
      path: req.url,
      agent,
      headers: { ...req.headers, "x-forwarded": "1" },
    },
    upstreamResponse => {
      streams.push(upstreamResponse);
      observe("client response", upstreamResponse, ["end", "close", "aborted", "error"]);
      log("client response", upstreamResponse.statusCode!, Object.keys(upstreamResponse.headers));
      res.writeHead(upstreamResponse.statusCode!, upstreamResponse.headers);
      upstreamResponse.on("close", () => {
        if (!upstreamResponse.complete) res.destroy();
      });
      if (forwarding === "pipe") {
        upstreamResponse.pipe(res);
      } else if (forwarding === "pipeline") {
        stream.pipeline(upstreamResponse, res, error => recordPipelineResult("response pipeline", error));
      } else {
        const chunks: Buffer[] = [];
        upstreamResponse.on("data", chunk => chunks.push(chunk));
        upstreamResponse.on("end", () => res.end(Buffer.concat(chunks)));
      }
    },
  );
  streams.push(proxied);
  observe("client request", proxied, ["socket", "finish", "close", "error", "abort"]);
  proxied.on("error", (error: any) => {
    if (res.headersSent) return void res.destroy();
    res.writeHead(502);
    res.end("bad gateway " + error.code);
  });
  if (forwarding === "pipeline")
    stream.pipeline(req, proxied, error => recordPipelineResult("request pipeline", error));
  else req.pipe(proxied);
});

runProbe(async () => {
  upstreamPort = await listen(upstream);
  const port = await listen(front);
  const chunkedBody = "Transfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n";

  const cases: [string, string, boolean?][] = [
    ...Object.keys(upstreamResponders)
      .filter(name => name !== "echo" && name !== "count")
      .map(name => [`GET ${name}`, get("/" + name)] as [string, string]),
    ["POST echo", post("/echo", "hello")],
    ["POST count", post("/count", "hello")],
    ["POST echo, chunked", `POST /echo HTTP/1.1\r\nHost: localhost\r\n${chunkedBody}`],
    ["POST count, chunked", `POST /count HTTP/1.1\r\nHost: localhost\r\n${chunkedBody}`],
    ["HEAD text", get("/text").replace("GET", "HEAD"), true],
  ];

  for (const [name, request, hasNoBody] of cases) {
    const log = report.start(name);
    using connection = await RawHttpConnection.connect(port);
    for (let i = 0; i < 3; i++) {
      report.startBlock();
      connection.send(request);
      const response = await readOrGiveUp(connection, { hasNoBody });
      log("response:", formatResponse(response));
      await untilEveryStreamIsDestroyed();
      logEvents(log);
      if (response.startsWith("closed") || response === "no response") break;
    }
  }

  agent.destroy();
  for (const server of [front, upstream]) {
    server.close();
    server.closeAllConnections();
  }
  report.print();
});
