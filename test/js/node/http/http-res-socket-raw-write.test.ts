import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Per Node's http docs (https://nodejs.org/api/http.html#messagesocket),
// `res.socket` and its alias `res.connection` are the underlying network
// socket. Writing to them sends raw bytes that bypass HTTP framing — which
// Node apps and frameworks (e.g. Playwright's TestServer fixture) rely on to
// emit malformed HTTP responses (duplicate headers with mixed case, etc.)
// that res.writeHead can't construct.
//
// This used to be silently dropped in Bun (FakeSocket._write was an empty
// function and NodeHTTPServerSocket._write only wrote when streaming was on,
// and even then went through HttpResponse::write which prepends framing).

async function spawnAndCollect(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("res.connection.write delivers raw bytes to the wire", async () => {
  const { stdout, stderr, exitCode } = await spawnAndCollect(`
    const http = require("node:http");
    const net = require("node:net");
    const server = http.createServer((req, res) => {
      const conn = res.connection;
      conn.write("HTTP/1.1 200 OK\\r\\n");
      conn.write("Name-A: v1\\r\\n");
      conn.write("Name-a: v2\\r\\n");
      conn.write("Content-Length: 5\\r\\n");
      conn.write("Connection: close\\r\\n");
      conn.write("\\r\\n");
      conn.write("hello");
      conn.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
      });
      const chunks = [];
      sock.on("data", d => chunks.push(d));
      sock.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        process.stdout.write(body);
        server.close();
      });
    });
  `);
  expect(stderr).toBe("");
  expect(stdout).toContain("HTTP/1.1 200 OK");
  // Both header cases are delivered exactly as written — this is the load-
  // bearing assertion: writeHead would dedupe these.
  expect(stdout).toContain("Name-A: v1");
  expect(stdout).toContain("Name-a: v2");
  expect(stdout).toContain("hello");
  expect(exitCode).toBe(0);
});

test("res.socket alias is the same socket object as res.connection", async () => {
  const { stdout, stderr, exitCode } = await spawnAndCollect(`
    const http = require("node:http");
    const net = require("node:net");
    const server = http.createServer((req, res) => {
      // Both names should refer to the same underlying socket. Writing via
      // res.socket should reach the wire just like res.connection.
      console.log("same:" + (res.socket === res.connection));
      const sock = res.socket;
      sock.write("HTTP/1.1 418 I'm a teapot\\r\\nContent-Length: 4\\r\\nConnection: close\\r\\n\\r\\nteap");
      sock.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const c = net.connect(port, "127.0.0.1", () => {
        c.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
      });
      const chunks = [];
      c.on("data", d => chunks.push(d));
      c.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        console.log("body:" + JSON.stringify(body));
        server.close();
      });
    });
  `);
  expect(stderr).toBe("");
  expect(stdout).toContain("same:true");
  expect(stdout).toContain("418 I'm a teapot");
  expect(stdout).toContain("teap");
  expect(exitCode).toBe(0);
});

test("standard res.writeHead/end path still produces a well-formed response", async () => {
  // Regression guard: don't break the normal HTTP path.
  const { stdout, stderr, exitCode } = await spawnAndCollect(`
    const http = require("node:http");
    const server = http.createServer((req, res) => {
      res.writeHead(201, "Created", { "x-custom": "foo", "content-type": "text/plain" });
      res.write("hel");
      res.end("lo");
    });
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      const r = await fetch("http://127.0.0.1:" + port + "/");
      console.log("status:" + r.status);
      console.log("statusText:" + r.statusText);
      console.log("xcustom:" + r.headers.get("x-custom"));
      console.log("ct:" + r.headers.get("content-type"));
      console.log("body:" + (await r.text()));
      server.close();
    });
  `);
  expect(stderr).toBe("");
  expect(stdout).toContain("status:201");
  expect(stdout).toContain("statusText:Created");
  expect(stdout).toContain("xcustom:foo");
  expect(stdout).toContain("ct:text/plain");
  expect(stdout).toContain("body:hello");
  expect(exitCode).toBe(0);
});

test("multiple raw chunks are delivered in order", async () => {
  // Stress: many small writes to the underlying socket should all arrive
  // intact and in order, with the bytes the user wrote (and only those).
  const { stdout, stderr, exitCode } = await spawnAndCollect(`
    const http = require("node:http");
    const net = require("node:net");
    const server = http.createServer((req, res) => {
      const sock = res.connection;
      sock.write("HTTP/1.1 200 OK\\r\\n");
      sock.write("Content-Length: 26\\r\\n");
      sock.write("Connection: close\\r\\n");
      sock.write("\\r\\n");
      for (let i = 0; i < 26; i++) {
        sock.write(String.fromCharCode(97 + i));
      }
      sock.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const c = net.connect(port, "127.0.0.1", () => {
        c.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
      });
      const chunks = [];
      c.on("data", d => chunks.push(d));
      c.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        // Find the body after the header terminator.
        const idx = body.indexOf("\\r\\n\\r\\n");
        process.stdout.write("body:" + body.slice(idx + 4));
        server.close();
      });
    });
  `);
  expect(stderr).toBe("");
  expect(stdout).toContain("body:abcdefghijklmnopqrstuvwxyz");
  expect(exitCode).toBe(0);
});
