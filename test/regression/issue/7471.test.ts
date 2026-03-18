import { test, expect, describe } from "bun:test";
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

  test("receives full options object", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");
        let receivedOpts = null;
        const server = http.createServer((req, res) => res.end("ok"));
        server.listen(0, () => {
          const port = server.address().port;
          http.get({
            host: "127.0.0.1",
            port,
            path: "/check",
            createConnection: (opts) => {
              receivedOpts = { host: opts.host, port: opts.port };
              return net.connect(opts);
            },
          }, (res) => {
            res.resume();
            res.on("end", () => {
              console.log(JSON.stringify(receivedOpts));
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
    expect(r.host).toBe("127.0.0.1");
    expect(typeof r.port).toBe("number");
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

  test("handles response with no body (204)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");
        const server = http.createServer((req, res) => {
          res.writeHead(204);
          res.end();
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
    expect(r).toEqual({ data: "", status: 204 });
    expect(exitCode).toBe(0);
  });

  test("emits socket event with real socket", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");
        const server = http.createServer((req, res) => res.end("ok"));
        server.listen(0, () => {
          const req = http.get({
            port: server.address().port,
            createConnection: (opts) => net.connect(opts),
          }, (res) => {
            res.resume();
            res.on("end", () => server.close());
          });
          req.on("socket", (sock) => {
            console.log(JSON.stringify({ isSocket: sock instanceof net.Socket }));
          });
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const r = JSON.parse(stdout.trim());
    expect(r.isSocket).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("handles custom headers", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");
        const server = http.createServer((req, res) => {
          res.end(JSON.stringify({
            xCustom: req.headers["x-custom"],
            accept: req.headers["accept"],
          }));
        });
        server.listen(0, () => {
          http.get({
            port: server.address().port,
            headers: { "X-Custom": "test-value", "Accept": "application/json" },
            createConnection: (opts) => net.connect(opts),
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              console.log(d);
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
    expect(r).toEqual({ xCustom: "test-value", accept: "application/json" });
    expect(exitCode).toBe(0);
  });

  test("response headers are parsed correctly", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");
        const server = http.createServer((req, res) => {
          res.writeHead(201, "Created", {
            "X-Response-Id": "abc123",
            "Content-Type": "text/plain",
          });
          res.end("created");
        });
        server.listen(0, () => {
          http.get({
            port: server.address().port,
            createConnection: (opts) => net.connect(opts),
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              console.log(JSON.stringify({
                status: res.statusCode,
                statusMsg: res.statusMessage,
                xId: res.headers["x-response-id"],
                ct: res.headers["content-type"],
                data: d,
              }));
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
    expect(r).toEqual({
      status: 201,
      statusMsg: "Created",
      xId: "abc123",
      ct: "text/plain",
      data: "created",
    });
    expect(exitCode).toBe(0);
  });

  test("handles chunked extensions and trailer headers", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");

        // Use a raw TCP server to send a response with chunked extensions and trailers
        const server = net.createServer((sock) => {
          sock.on("data", () => {
            sock.write(
              "HTTP/1.1 200 OK\\r\\n" +
              "Transfer-Encoding: chunked\\r\\n" +
              "Trailer: X-Checksum\\r\\n" +
              "\\r\\n" +
              "5;ext=val\\r\\nhello\\r\\n" +
              "6\\r\\n world\\r\\n" +
              "0\\r\\n" +
              "X-Checksum: abc123\\r\\n" +
              "\\r\\n"
            );
            sock.end();
          });
        });
        server.listen(0, () => {
          http.get({
            port: server.address().port,
            createConnection: (opts) => net.connect(opts),
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              console.log(JSON.stringify({
                data: d,
                status: res.statusCode,
                trailers: res.trailers,
              }));
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
    expect(r.data).toBe("hello world");
    expect(r.status).toBe(200);
    expect(r.trailers).toEqual({ "x-checksum": "abc123" });
    expect(exitCode).toBe(0);
  });

  test("handles 100 Continue before final response", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("http");
        const net = require("net");
        // Raw TCP server that sends 100 Continue then 200
        const server = net.createServer((sock) => {
          sock.on("data", () => {
            sock.write("HTTP/1.1 100 Continue\\r\\n\\r\\nHTTP/1.1 200 OK\\r\\nContent-Length: 4\\r\\n\\r\\ndone");
            sock.end();
          });
        });
        server.listen(0, () => {
          let infoReceived = false;
          const req = http.request({
            port: server.address().port,
            method: "POST",
            headers: { "Expect": "100-continue" },
            createConnection: (opts) => net.connect(opts),
          }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
              console.log(JSON.stringify({ data: d, status: res.statusCode, infoReceived }));
              server.close();
            });
          });
          req.on("information", (info) => {
            infoReceived = info.statusCode === 100;
          });
          req.end("body");
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const r = JSON.parse(stdout.trim());
    expect(r).toEqual({ data: "done", status: 200, infoReceived: true });
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
          // Echo back the content-length header(s) the server received
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
