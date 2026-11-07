import { once } from "node:events";
import http from "node:http";
import net from "node:net";

type Response = http.ServerResponse & Record<string | symbol, any>;
type Request = http.IncomingMessage & Record<string | symbol, any>;
type Step = (res: Response, req: Request) => void;

const notes: string[] = [];
function attempt(name: string, step: () => void) {
  try {
    step();
  } catch (error: any) {
    notes.push(`${name} throws ${error.code ?? error.name}`);
  }
}

let ended = () => {};
function end(res: Response, body?: string) {
  try {
    res.end(body);
  } finally {
    ended();
  }
}

// Each way sends a body behind a content-length. `between` runs after the first write().
const ways: [string, number, (res: Response, between: () => void) => void][] = [
  ["write(), end()", 2, (res, between) => (res.write("ok"), between(), end(res))],
  ["write(), end(body)", 4, (res, between) => (res.write("ok"), between(), end(res, "ok"))],
  ["write(), write(), end()", 4, (res, between) => (res.write("ok"), between(), res.write("ok"), end(res))],
  ["write(), flushHeaders(), end()", 2, (res, between) => (res.write("ok"), between(), res.flushHeaders(), end(res))],
  ["write(), end() in a tick", 2, (res, between) => (res.write("ok"), between(), process.nextTick(end, res))],
  ["write(), end() in a later turn", 2, (res, between) => (res.write("ok"), between(), setImmediate(end, res))],
];

function store(name: string, value: unknown, on: "res" | "req" = "res"): [string, Step, Step] {
  let original: unknown;
  return [
    `${on}.${name} = ${JSON.stringify(value)}`,
    (res, req) => {
      const holder = on === "res" ? res : req;
      original = holder[name];
      holder[name] = value;
    },
    (res, req) => void ((on === "res" ? res : req)[name] = original),
  ];
}

const outHeaders = (res: Response) => Object.getOwnPropertySymbols(res).find(key => key.description === "kOutHeaders");

// The name, the change, and what takes the change back.
const changes: [string, Step, Step | null][] = [
  ["nothing", () => {}, null],
  store("sendDate", false),
  store("shouldKeepAlive", false),
  store("_keepAliveTimeout", 0),
  store("_keepAliveTimeout", 9000),
  store("_keepAliveTimeout", "9000"),
  store("_maxRequestsPerSocket", 7),
  store("maxRequestsOnConnectionReached", true),
  store("useChunkedEncodingByDefault", false),
  store("_hasBody", false),
  store("_removedConnection", true),
  store("_removedContLen", true),
  store("_removedTE", true),
  store("statusCode", 404),
  store("statusMessage", "Other"),
  store("chunkedEncoding", true),
  store("_contentLength", 5),
  store("_last", true),
  store("strictContentLength", true),
  store("httpVersionMinor", 0, "req"),
  store("httpVersionMajor", 0, "req"),
  [
    "req.headers.connection = close",
    (_res, req) => void (req.headers.connection = "close"),
    (_res, req) => void delete req.headers.connection,
  ],
  [
    "server.keepAliveTimeout = 9000",
    () => void (server.keepAliveTimeout = 9000),
    () => void (server.keepAliveTimeout = 5000),
  ],
  [
    "a header stored in the table of headers",
    res => {
      const key = outHeaders(res);
      if (key !== undefined && res[key]) res[key]["x-late"] = ["X-Late", "1"];
    },
    res => {
      const key = outHeaders(res);
      if (key !== undefined && res[key]) delete res[key]["x-late"];
    },
  ],
  ["setHeader()", res => attempt("setHeader()", () => res.setHeader("x-late", "1")), null],
  ["appendHeader()", res => attempt("appendHeader()", () => res.appendHeader("x-late", "1")), null],
  ["setHeaders()", res => attempt("setHeaders()", () => res.setHeaders(new Map([["x-late", "1"]]))), null],
  ["removeHeader()", res => attempt("removeHeader()", () => res.removeHeader("content-length")), null],
  ["writeHead()", res => attempt("writeHead()", () => res.writeHead(404, { "x-late": "1" })), null],
  ["addTrailers()", res => attempt("addTrailers()", () => res.addTrailers({ "x-late": "1" })), null],
];

let respond: (req: Request, res: Response) => void;
const server = http.createServer((req, res) => respond(req as Request, res as Response));
await once(server.listen(0, "127.0.0.1"), "listening");
const port = (server.address() as any).port;

// The bytes of one response, and whether the connection answers a second request.
async function exchange(length: number): Promise<string> {
  const socket = net.connect(port, "127.0.0.1");
  let received = "";
  let wake = () => {};
  let isClosed = false;
  socket.setEncoding("latin1");
  socket.on("data", data => ((received += data), wake()));
  socket.on("error", () => {});
  socket.on("close", () => ((isClosed = true), wake()));
  const timer = setTimeout(() => ((isClosed = true), wake()), 10_000);
  const until = async (isThere: () => boolean) => {
    while (!isThere() && !isClosed) await new Promise<void>(resolve => (wake = resolve));
  };
  const hasEnded = new Promise<void>(resolve => (ended = resolve));
  socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  await hasEnded;
  await until(() => received.includes("\r\n\r\n"));
  await new Promise(resolve => setImmediate(resolve));
  respond = (_req, res) => void res.end("again");
  if (!isClosed) socket.write("GET /again HTTP/1.1\r\nHost: a\r\n\r\n");
  await until(() => received.endsWith("again"));
  clearTimeout(timer);
  socket.destroy();
  const answersAgain = received.endsWith("again");
  const first = answersAgain ? received.slice(0, received.lastIndexOf("HTTP/1.1 ")) : received;
  const headEnd = first.indexOf("\r\n\r\n");
  if (headEnd < 0) return `no head: ${JSON.stringify(first)}`;
  const head = first
    .slice(0, headEnd)
    .split("\r\n")
    .map(line => (/^date: /i.test(line) ? "Date" : line === `content-length: ${length}` ? "content-length" : line))
    .join(" | ");
  const body = first.slice(headEnd + 4);
  return `${head} || ${body === "okok".slice(0, length) ? "the whole body" : JSON.stringify(body)} || ${answersAgain ? "answers again" : "closes"}`;
}

for (const [name, change, undo] of changes) {
  for (const when of undo === null ? ["between"] : ["between", "before", "before, and taken back between"]) {
    const wires = new Map<string, string[]>();
    for (const sendsHead of ["setHeader()", "writeHead()"]) {
      for (const [way, length, send] of ways) {
        respond = (req, res) => {
          if (when !== "between") change(res, req);
          if (sendsHead === "setHeader()") res.setHeader("content-length", length);
          else res.writeHead(200, { "content-length": length });
          try {
            send(res, () => {
              if (when === "between") change(res, req);
              else if (when !== "before") undo!(res, req);
            });
          } catch (error: any) {
            notes.push(`the listener throws ${error.code ?? error.name}`);
            res.destroy();
            ended();
          }
        };
        let wire = await exchange(length);
        server.keepAliveTimeout = 5000;
        if (notes.length > 0) wire += ` (${notes.splice(0).join(", ")})`;
        if (!wires.has(wire)) wires.set(wire, []);
        wires.get(wire)!.push(`${sendsHead}, ${way}`);
      }
    }
    console.log(`${name} ${when}:`);
    for (const [wire, sent] of wires)
      console.log(`    ${wires.size === 1 ? "however it is sent" : sent.join(" | ")}: ${wire}`);
  }
}
server.close();
server.closeAllConnections();
