// Standalone server for fetch-http2-leak.test.ts.
//
// Runs in its own process so the node:http2 event loop isn't sharing a thread
// with the test's Bun.spawn() orchestration — when both live in one process the
// server intermittently leaves a few streams unanswered under load (observed on
// macOS 14 and aarch64 Linux), which is a node:http2-server-side issue
// unrelated to the H2 client lifetimes the leak test is measuring.

import { tls } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import zlib from "node:zlib";

const body = Buffer.alloc(64 * 1024, "x");
const gzBody = zlib.gzipSync(body);
const sessions = new Set<http2.ServerHttp2Session>();

const server = http2.createSecureServer({ ...tls, allowHTTP1: false }, (req, res) => {
  if (req.url === "/__destroy_sessions") {
    for (const s of sessions) s.destroy();
    sessions.clear();
    return;
  }
  if (req.url === "/redirect") {
    res.writeHead(307, { location: "/" });
    res.end();
    return;
  }
  if (req.url === "/gzip") {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.end(gzBody);
    return;
  }
  if (req.method === "POST") {
    let n = 0;
    req.on("data", c => (n += c.length));
    req.on("end", () => res.end(Buffer.alloc(n)));
    return;
  }
  res.end(body);
});

server.on("session", s => {
  sessions.add(s);
  s.on("close", () => sessions.delete(s));
  s.on("error", () => {});
});
server.on("stream", s => s.on("error", () => {}));
server.on("error", () => {});
server.on("sessionError", () => {});
server.on("clientError", () => {});
server.on("secureConnection", sock => sock.on("error", () => {}));

server.listen(0);
await once(server, "listening");
process.stdout.write(`https://localhost:${(server.address() as import("node:net").AddressInfo).port}\n`);

// Stay alive until the parent kills us.
process.stdin.resume();
