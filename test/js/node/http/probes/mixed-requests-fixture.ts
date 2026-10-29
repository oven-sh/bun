import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { RawHttpConnection } from "../raw-http-client.ts";
import {
  type Log,
  Report,
  createRandom,
  exchangeState,
  formatResponse,
  formatValue,
  listen,
  pick,
  readOrGiveUp,
  runProbe,
} from "./probe.ts";

const [seedText = "1", countText = "40"] = process.argv.slice(2);
const seed = Number(seedText);
const count = Number(countText);

const responders: Record<string, (req: IncomingMessage, res: ServerResponse, log: Log) => void> = {
  "end": (req, res) => void res.end("ok"),
  "write-head-write-end": (req, res) => {
    res.writeHead(200, { "content-type": "text/plain", "content-length": "2" });
    res.write("ok");
    res.end(null);
  },
  "write-end": (req, res) => {
    res.write("o");
    res.end("k");
  },
  "two-immediates": (req, res) => void setImmediate(() => setImmediate(() => res.end("ok"))),
  "listeners": (req, res, log) => {
    for (const event of ["finish", "close"]) res.on(event, () => log("res " + event));
    req.on("close", () => log("req close"));
    res.end("ok");
  },
  "stream": (req, res) => {
    res.write("a");
    setImmediate(() => {
      res.write("b");
      process.nextTick(() => res.end("c"));
    });
  },
  "seven-headers": (req, res) => {
    for (let i = 0; i < 7; i++) res.setHeader("x-h" + i, i);
    res.removeHeader("x-h3");
    res.end("ok");
  },
  "empty": (req, res) => void res.end(),
  "status-204": (req, res) => {
    res.statusCode = 204;
    res.end();
  },
  "status-304": (req, res) => {
    res.writeHead(304, { etag: "x" });
    res.end();
  },
  "tick": (req, res) => void process.nextTick(() => res.end("ok")),
  "microtask": (req, res) => void queueMicrotask(() => res.end("ok")),
};
const responderNames = Object.keys(responders);

const report = new Report();
report.recordUncaughtErrors();
let exchanges: [IncomingMessage, ServerResponse][] = [];
let onRequest: (() => void) | undefined;

const server = http.createServer((req, res) => {
  const log = report.current;
  const [, kind, responder] = req.url!.split("?")[0].split("/");
  exchanges.push([req, res]);
  log(
    req.method!,
    formatValue(req.url!.slice(0, 40)),
    req.httpVersion,
    "headers",
    Object.keys(req.headers).length,
    req.rawHeaders.length,
    "shouldKeepAlive",
    res.shouldKeepAlive,
    "complete",
    req.complete,
  );
  if (/^(read|chunked|trailers|expect)/.test(kind)) {
    let length = 0;
    req.on("data", chunk => (length += chunk.length));
    req.on("end", () => {
      log("body", length, "trailers", req.trailers);
      responders[responder](req, res, log);
    });
  } else {
    responders[responder](req, res, log);
  }
  onRequest?.();
});

server.on("checkContinue", (req, res) => {
  report.current("checkContinue");
  res.writeContinue();
  server.emit("request", req, res);
});

runProbe(async () => {
  const port = await listen(server);
  const host = "Host: localhost\r\n";

  for (let index = 0; index < count; index++) {
    const random = createRandom(seed * 1000003 + index * 7919);
    const log = report.start(`seed ${seed}, connection ${index}`);
    using connection = await RawHttpConnection.connect(port);
    let isOpen = true;

    const read = async (responses: number, hasNoBody = false) => {
      for (let i = 0; i < responses && isOpen; i++) {
        const response = await readOrGiveUp(connection, { hasNoBody });
        log("response:", formatResponse(response));
        isOpen = !response.startsWith("closed") && response !== "no response";
      }
      for (const [req, res] of exchanges) log("after the response:", exchangeState(req, res));
      exchanges = [];
    };
    const exchange = async (request: string, hasNoBody = false) => {
      connection.send(request);
      await read(1, hasNoBody);
    };
    const untilRequestEvent = () => new Promise<void>(resolve => (onRequest = resolve));

    const requests = 5 + Math.floor(random() * 6);
    for (let i = 0; i < requests && isOpen; i++) {
      const x = random();
      const path = (kind: string) => `/${kind}/${pick(random, responderNames)}`;
      if (x < 0.3) await exchange(`GET ${path("get")} HTTP/1.1\r\n${host}\r\n`);
      else if (x < 0.4) await exchange(`POST ${path("read")} HTTP/1.1\r\n${host}Content-Length: 5\r\n\r\nhello`);
      else if (x < 0.48) await exchange(`POST ${path("unread")} HTTP/1.1\r\n${host}Content-Length: 5\r\n\r\nhello`);
      else if (x < 0.55)
        await exchange(
          `POST ${path("chunked")} HTTP/1.1\r\n${host}Transfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2;ext=1\r\nde\r\n0\r\n\r\n`,
        );
      else if (x < 0.59)
        await exchange(
          `POST ${path("trailers")} HTTP/1.1\r\n${host}Transfer-Encoding: chunked\r\nTrailer: X-T\r\n\r\n3\r\nabc\r\n0\r\nX-T: 1\r\n\r\n`,
        );
      else if (x < 0.65) await exchange(`HEAD ${path("head")} HTTP/1.1\r\n${host}\r\n`, true);
      else if (x < 0.69) {
        connection.send(`POST ${path("expect")} HTTP/1.1\r\n${host}Expect: 100-continue\r\nContent-Length: 3\r\n\r\n`);
        log("response:", formatResponse(await readOrGiveUp(connection)));
        await exchange("abc");
      } else if (x < 0.74) await exchange(`GET ${path("http10")} HTTP/1.0\r\n${host}Connection: keep-alive\r\n\r\n`);
      else if (x < 0.82) {
        const pipelined = random() < 0.6 ? 2 : 3;
        let text = "";
        for (let j = 0; j < pipelined; j++) text += `GET ${path("pipelined")} HTTP/1.1\r\n${host}\r\n`;
        connection.send(text);
        await read(pipelined);
      } else if (x < 0.85)
        await exchange(`GET ${path("upgrade")} HTTP/1.1\r\n${host}Connection: Upgrade\r\nUpgrade: nothing\r\n\r\n`);
      else if (x < 0.88)
        await exchange(`GET ${path("long-header")} HTTP/1.1\r\n${host}X-Long: ${Buffer.alloc(8000, "b")}\r\n\r\n`);
      else if (x < 0.91) await exchange(`GET ${path("query")}?${Buffer.alloc(800, "q=1&")} HTTP/1.1\r\n${host}\r\n`);
      else if (x < 0.94) await exchange(`DELETE ${path("delete")} HTTP/1.1\r\n${host}Content-Length: 0\r\n\r\n`);
      else if (x < 0.97) {
        const seen = untilRequestEvent();
        connection.send(`POST ${path("read-in-two-parts")} HTTP/1.1\r\n${host}Content-Length: 6\r\n\r\nabc`);
        await Promise.race([seen, connection.untilClosed()]);
        await exchange("def");
      } else {
        await exchange(`GET ${path("close")} HTTP/1.1\r\n${host}Connection: close\r\n\r\n`);
        break;
      }
    }
  }

  server.close();
  server.closeAllConnections();
  report.print();
});
