import http, { type IncomingMessage } from "node:http";
import { RawHttpConnection, get } from "../raw-http-client.ts";
import {
  Report,
  attempt,
  createRandom,
  formatResponse,
  formatValue,
  listen,
  pick,
  readOrGiveUp,
  runProbe,
  shuffle,
} from "./probe.ts";

const [seedText = "1", countText = "40"] = process.argv.slice(2);
const seed = Number(seedText);
const count = Number(countText);

const headerNames = [
  "content-type",
  "Content-Type",
  "user-agent",
  "User-Agent",
  "referer",
  "authorization",
  "etag",
  "from",
  "if-modified-since",
  "if-unmodified-since",
  "last-modified",
  "location",
  "max-forwards",
  "proxy-authorization",
  "retry-after",
  "server",
  "age",
  "expires",
  "content-length-x",
  "accept",
  "Accept",
  "accept-encoding",
  "accept-language",
  "cookie",
  "Cookie",
  "COOKIE",
  "set-cookie",
  "Set-Cookie",
  "x-a",
  "X-A",
  "x-b",
  "x-forwarded-for",
  "via",
  "cache-control",
  "pragma",
  "te",
  "warning",
  "x-1",
  "x_under",
  "x.dot",
  "x!bang",
  "origin",
  "dnt",
  "sec-fetch-mode",
  "connection-x",
  "keep-alive",
];
const otherMethods = [
  "POST",
  "PUT",
  "DELETE",
  "OPTIONS",
  "PATCH",
  "PROPFIND",
  "M-SEARCH",
  "QUERY",
  "get",
  "FOO",
  "TRACE",
];
const otherUrls = [
  "/a?b=c&d=e",
  "/%E4%F6%20x",
  "//x//y",
  "/caf\xe9",
  "http://other.example/abs?q=1",
  "/a#frag",
  "/" + Buffer.alloc(3000, "u").toString(),
  "/a;b=c",
  "/?",
  "/..%2f..",
  "*",
  "/a\\b",
  "/a|b",
  "/{x}",
];

function drawValue(random: () => number) {
  const x = random();
  if (x < 0.35) return "v" + Math.floor(random() * 9);
  if (x < 0.45) return "";
  if (x < 0.52) return "  padded  ";
  if (x < 0.57) return "\ttabbed\t";
  if (x < 0.63) return "a, b,c";
  if (x < 0.68) return "caf\xe9 \xfc";
  if (x < 0.72) return Buffer.alloc(2000, "x").toString();
  if (x < 0.77) return "a=1; b=2";
  if (x < 0.8) return '"quoted, text"';
  if (x < 0.83) return "with: colon";
  if (x < 0.85) return "0";
  return "w" + Math.floor(random() * 99);
}

function drawRequest(random: () => number, index: number) {
  const method = random() < 0.6 ? "GET" : pick(random, otherMethods);
  const url = random() < 0.5 ? "/p" + index : pick(random, otherUrls);
  const lines: string[] = [];
  const hostDraw = random();
  if (hostDraw < 0.9) lines.push("Host: localhost");
  if (hostDraw < 0.04) lines.push("Host: second");
  for (let i = Math.floor(random() * (random() < 0.2 ? 30 : 8)); i > 0; i--) {
    const separator = random() < 0.9 ? ": " : pick(random, [":", ":  ", ":\t"]);
    lines.push(pick(random, headerNames) + separator + drawValue(random));
  }
  if (/POST|PUT|PATCH|QUERY/.test(method)) lines.push("Content-Length: 0");
  shuffle(random, lines);
  return `${method} ${url} HTTP/1.1\r\n${lines.map(line => line + "\r\n").join("")}\r\n`;
}

const readers: Record<string, (req: IncomingMessage) => unknown[]> = {
  headers: req => [req.headers],
  rawHeaders: req => [req.rawHeaders],
  headersDistinct: req => [req.headersDistinct],
  requestLine: req => [req.method, req.url, req.httpVersion, req.httpVersionMajor, req.httpVersionMinor],
  headerKeys: req => [Object.keys(req.headers)],
  singleHeaders: req => [req.headers["x-a"], req.headers.cookie, req.headers["set-cookie"], req.headers.host],
  identity: req => [
    Object.getPrototypeOf(req.headers) === Object.prototype,
    req.headers === req.headers,
    req.rawHeaders === req.rawHeaders,
  ],
  trailers: req => [req.trailers, req.rawTrailers],
};

const report = new Report();
report.recordUncaughtErrors();
let readerRandom = createRandom(seed);

const server = http.createServer((req, res) => {
  const log = report.current;
  const order = shuffle(readerRandom, Object.keys(readers)).slice(0, 2 + Math.floor(readerRandom() * 7));
  for (const name of order)
    log(
      name,
      attempt(() =>
        readers[name](req)
          .map(value => formatValue(value))
          .join(" "),
      ),
    );
  res.end("ok");
});

server.on("clientError", (error: any, socket) => {
  report.current("clientError", error.code);
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

runProbe(async () => {
  const port = await listen(server);

  for (let index = 0; index < count; index++) {
    const random = createRandom(seed * 1000003 + index * 7919);
    readerRandom = createRandom(seed * 31 + index * 977);
    const log = report.start(`seed ${seed}, connection ${index}`);
    using connection = await RawHttpConnection.connect(port);
    for (const request of [get("/warm-up"), drawRequest(random, 0), drawRequest(random, 1), drawRequest(random, 2)]) {
      log("request:", formatValue(request.slice(0, request.indexOf("\r\n"))));
      connection.send(request);
      const response = await readOrGiveUp(connection);
      log("response:", formatResponse(response));
      if (response.startsWith("closed") || response === "no response") break;
    }
  }

  server.close();
  server.closeAllConnections();
  report.print();
});
