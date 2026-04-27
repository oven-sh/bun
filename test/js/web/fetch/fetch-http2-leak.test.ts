import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import { join } from "node:path";

let server: http2.Http2SecureServer;
let url: string;
const sessions = new Set<http2.ServerHttp2Session>();

beforeAll(async () => {
  const body = Buffer.alloc(64 * 1024, "x");
  server = http2.createSecureServer({ ...tls, allowHTTP1: false }, (req, res) => {
    if (req.url === "/__destroy_sessions") {
      for (const s of sessions) s.destroy();
      sessions.clear();
      // The session carrying this request was just destroyed; no response.
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

async function runFixture(scenario: "get" | "post" | "abort") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", join(import.meta.dir, "fetch-http2-leak-fixture.ts")],
    env: { ...bunEnv, SERVER: url, SCENARIO: scenario, COUNT: "200", BATCH: "20" },
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
