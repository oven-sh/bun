import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("http.request createConnection", () => {
  test("is called for GET requests", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");
        let called = false;
        const server = http.createServer((req, res) => res.end("hello"));
        server.listen(0, () => {
          http.get({
            port: server.address().port,
            path: "/test",
            createConnection: (opts) => { called = true; return net.connect(opts); },
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              console.log(JSON.stringify({ called, data: d, status: res.statusCode }));
              server.close();
            });
          });
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const r = JSON.parse(stdout.trim());
    expect(r).toEqual({ called: true, data: "hello", status: 200 });
    expect(exitCode).toBe(0);
  });

  test("works with POST body", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");
        const server = http.createServer((req, res) => {
          let b = "";
          req.on("data", (c) => b += c);
          req.on("end", () => res.end("echo:" + b));
        });
        server.listen(0, () => {
          const req = http.request({
            port: server.address().port,
            method: "POST",
            createConnection: (opts) => net.connect(opts),
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              console.log(JSON.stringify({ data: d, status: res.statusCode }));
              server.close();
            });
          });
          req.end("payload");
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const r = JSON.parse(stdout.trim());
    expect(r).toEqual({ data: "echo:payload", status: 200 });
    expect(exitCode).toBe(0);
  });

  test("works with unix socket", async () => {
    if (process.platform === "win32") return;
    using dir = tempDir("bun-test-7471", {});
    const sockPath = join(String(dir), "test.sock");

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");
        const sockPath = ${JSON.stringify(sockPath)};
        let called = false;
        const server = http.createServer((req, res) => res.end("unix ok"));
        server.listen(sockPath, () => {
          http.get({
            socketPath: sockPath,
            path: "/",
            createConnection: (opts) => { called = true; return net.connect(opts); },
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              console.log(JSON.stringify({ called, data: d }));
              server.close();
            });
          });
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const r = JSON.parse(stdout.trim());
    expect(r).toEqual({ called: true, data: "unix ok" });
    expect(exitCode).toBe(0);
  });

  test("handles chunked transfer encoding", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");
        const server = http.createServer((req, res) => {
          res.writeHead(200, { "Transfer-Encoding": "chunked" });
          res.write("chunk1");
          res.write("chunk2");
          res.end("chunk3");
        });
        server.listen(0, () => {
          http.get({
            port: server.address().port,
            createConnection: (opts) => net.connect(opts),
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              console.log(JSON.stringify({ data: d, status: res.statusCode }));
              server.close();
            });
          });
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const r = JSON.parse(stdout.trim());
    expect(r).toEqual({ data: "chunk1chunk2chunk3", status: 200 });
    expect(exitCode).toBe(0);
  });

  test("does not duplicate Content-Length when caller sets it", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");
        const server = http.createServer((req, res) => {
          const cl = req.headers["content-length"];
          res.end("cl:" + cl);
        });
        server.listen(0, () => {
          const body = "hello";
          const req = http.request({
            port: server.address().port,
            method: "POST",
            headers: { "Content-Length": Buffer.byteLength(body) },
            createConnection: (opts) => net.connect(opts),
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              console.log(JSON.stringify({ data: d }));
              server.close();
            });
          });
          req.end(body);
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const r = JSON.parse(stdout.trim());
    expect(r.data).toBe("cl:5");
    expect(exitCode).toBe(0);
  });

  test("works without createConnection (no regression)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const server = http.createServer((req, res) => res.end("normal"));
        server.listen(0, () => {
          http.get({ port: server.address().port }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              console.log(JSON.stringify({ data: d, status: res.statusCode }));
              server.close();
            });
          });
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const r = JSON.parse(stdout.trim());
    expect(r).toEqual({ data: "normal", status: 200 });
    expect(exitCode).toBe(0);
  });
});
