import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, STATUS_CODES, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;

function sendJson(res: ServerResponse, value: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}

const handlers: Record<string, Handler> = {
  "GET /headers"(req, res) {
    res.setHeader("X-One", "1");
    res.setHeader("X-Many", ["a", "b"]);
    res.setHeader("X-Gone", "soon");
    res.removeHeader("x-gone");
    res.appendHeader("X-One", "2");
    sendJson(res, {
      names: res.getHeaderNames(),
      one: res.getHeader("x-one"),
      has: [res.hasHeader("X-MANY"), res.hasHeader("x-gone")],
      sent: res.headersSent,
      raw: req.rawHeaders.filter((_, index) => index % 2 === 0).map(name => name.toLowerCase()).sort(),
      version: req.httpVersion,
      custom: req.headers["x-custom"] ?? null,
      cookies: req.headers.cookie ?? null,
    });
  },
  "GET /write-head"(req, res) {
    res.writeHead(201, "Made", { "Content-Type": "text/plain", "X-Pairs": "yes" });
    res.end(`${res.statusCode} ${res.statusMessage} ${res.headersSent}`);
  },
  "GET /write-head-pairs"(req, res) {
    res.writeHead(200, ["Content-Type", "text/plain", "Set-Cookie", "a=1", "Set-Cookie", "b=2"]);
    res.end("pairs");
  },
  "GET /status"(req, res, url) {
    const code = Number(url.searchParams.get("code"));
    res.writeHead(code, { "Content-Type": "text/plain" });
    res.end(STATUS_CODES[code] ?? "unknown");
  },
  "GET /chunks"(req, res) {
    res.setHeader("Content-Type", "text/plain");
    res.write("one,");
    res.write(Buffer.from("two,"));
    res.write(new Uint8Array([116, 104, 114, 101, 101]), () => res.end("!"));
  },
  async "GET /drain"(req, res) {
    res.setHeader("Content-Type", "application/octet-stream");
    const block = Buffer.alloc(64 * 1024, "x");
    for (let n = 0; n < 32; n++) if (!res.write(block)) await once(res, "drain");
    res.end();
  },
  async "GET /piped"(req, res) {
    res.setHeader("Content-Type", "text/plain");
    const upper = new Transform({
      transform(chunk, encoding, done) {
        done(null, String(chunk).toUpperCase());
      },
    });
    await pipeline(Readable.from(["a", "b", "c"].map(letter => letter.repeat(3) + "\n")), upper, res);
  },
  "GET /gzip"(req, res) {
    const body = gzipSync("compressed ".repeat(50));
    res.writeHead(200, { "Content-Type": "text/plain", "Content-Encoding": "gzip", "Content-Length": body.length });
    res.end(body);
  },
  "GET /empty"(req, res) {
    res.writeHead(204);
    res.end();
  },
  "GET /late-header"(req, res) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    let thrown = "nothing";
    try {
      res.setHeader("X-Late", "1");
    } catch (error) {
      thrown = (error as NodeJS.ErrnoException).code ?? String(error);
    }
    res.end(thrown);
  },
  "GET /bad-header"(req, res) {
    const thrown: string[] = [];
    for (const [name, value] of [["bad name", "x"], ["x-bad", "line\nbreak"], ["", "x"]] as const) {
      try {
        res.setHeader(name, value);
      } catch (error) {
        thrown.push((error as NodeJS.ErrnoException).code ?? String(error));
      }
    }
    sendJson(res, thrown);
  },
  "GET /events"(req, res) {
    const seen: string[] = [];
    res.on("finish", () => seen.push("finish"));
    res.on("close", () => seen.push("close"));
    req.on("end", () => seen.push("request end"));
    req.resume();
    setImmediate(() => sendJson(res, { seen, complete: req.complete, writable: res.writable, ended: res.writableEnded }));
  },
  "GET /socket"(req, res) {
    sendJson(res, { address: req.socket.remoteAddress, family: req.socket.remoteFamily, port: typeof req.socket.remotePort, encrypted: "encrypted" in req.socket });
  },
  async "POST /echo"(req, res) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    sendJson(res, { bytes: body.length, sha1: createHash("sha1").update(body).digest("hex"), type: req.headers["content-type"] ?? null, length: req.headers["content-length"] ?? null });
  },
  "POST /events"(req, res) {
    let bytes = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (bytes += chunk.length));
    req.on("end", () => sendJson(res, { characters: bytes, complete: req.complete }));
  },
  async "POST /back"(req, res) {
    res.setHeader("Content-Type", req.headers["content-type"] ?? "application/octet-stream");
    await pipeline(req, res);
  },
  "POST /ignored"(req, res) {
    sendJson(res, { read: false }, 202);
  },
  "GET /throws"() {
    throw new RangeError("out of range");
  },
  async "GET /rejects"() {
    throw new TypeError("not this type");
  },
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const handler = handlers[`${req.method === "HEAD" ? "GET" : req.method} ${url.pathname}`];
  if (!handler) return sendJson(res, { missing: url.pathname, method: req.method }, 404);
  try {
    Promise.resolve(handler(req, res, url)).catch((error: Error) => sendJson(res, { rejected: error.name, message: error.message }, 500));
  } catch (error) {
    sendJson(res, { thrown: (error as Error).name, message: (error as Error).message }, 500);
  }
});

server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  console.log("listening", (server.address() as AddressInfo).port);
});
