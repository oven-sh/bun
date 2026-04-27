import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import { join } from "node:path";
import zlib from "node:zlib";

let server: http2.Http2SecureServer;
let url: string;
const sessions = new Set<http2.ServerHttp2Session>();

beforeAll(async () => {
  const body = Buffer.alloc(64 * 1024, "x");
  const gzBody = zlib.gzipSync(body);
  server = http2.createSecureServer({ ...tls, allowHTTP1: false }, (req, res) => {
    if (req.url === "/__destroy_sessions") {
      for (const s of sessions) s.destroy();
      sessions.clear();
      // The session carrying this request was just destroyed; no response.
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
  // The abort scenario tears connections down mid-handshake; the server
  // surfaces those as ECONNRESET. They're expected, not test failures.
  server.on("error", () => {});
  server.on("sessionError", () => {});
  server.on("clientError", () => {});
  server.on("secureConnection", sock => sock.on("error", () => {}));
  server.listen(0);
  await once(server, "listening");
  url = `https://localhost:${(server.address() as import("node:net").AddressInfo).port}`;
});

afterAll(() => {
  for (const s of sessions) s.destroy();
  server.close();
});

async function runFixture(scenario: string) {
  // BATCH is kept low: at 20 concurrent streams the macOS runner wedges with
  // a handful of streams stuck mid-response (server-side node:http2 under
  // load, not the client path being measured). The leak assertion only needs
  // many sequential request lifetimes, not high parallelism.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", join(import.meta.dir, "fetch-http2-leak-fixture.ts")],
    env: { ...bunEnv, SERVER: url, SCENARIO: scenario, COUNT: "200", BATCH: "8" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("--pass--");
  expect(exitCode).toBe(0);
}

test("h2 ClientSession/Stream do not leak across batched GETs", () => runFixture("get"));
test("h2 ClientSession/Stream do not leak across batched POSTs", () => runFixture("post"));
test("h2 ClientSession/Stream do not leak across aborted requests", () => runFixture("abort"));
test("h2 ClientSession/Stream do not leak across streamed-response reads", () => runFixture("stream-response"));
test("h2 ClientSession/Stream do not leak across streamed-request uploads", () => runFixture("stream-request"));
test("h2 ClientSession/Stream do not leak across same-origin redirects", () => runFixture("redirect"));
test("h2 ClientSession/Stream do not leak across gzip-encoded responses", () => runFixture("gzip"));
