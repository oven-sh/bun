import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import http2 from "node:http2";

// Node.js error codes are produced in C++ (ErrorCode.cpp jsFunctionMakeErrorWithCode).
// Codes with no message template fall through to "use the first JS argument verbatim
// as .message", so a call site that passes template args instead of the full sentence
// yields a broken message, and a call site that passes the full sentence into a code
// that *is* templated gets the template wrapper applied twice. These tests pin the
// messages to Node.js's format for the codes that were observably wrong.

test("ERR_HTTP2_UNSUPPORTED_PROTOCOL message matches Node.js", () => {
  let err: any;
  try {
    http2.connect("gopher://127.0.0.1:1");
  } catch (e) {
    err = e;
  }
  expect(err?.code).toBe("ERR_HTTP2_UNSUPPORTED_PROTOCOL");
  expect(err?.message).toBe('protocol "gopher:" is unsupported.');
});

test.concurrent("ERR_HTTP_TRAILER_INVALID message matches Node.js", async () => {
  const fixture = `
    const http = require("node:http");
    const req = http.request({ port: 1, method: "POST", createConnection: () => new (require("node:net").Socket)() });
    req.on("error", () => {});
    req.setHeader("Content-Length", "5");
    req.setHeader("Trailer", "X-Foo");
    try {
      req.flushHeaders();
      console.log("NO THROW");
    } catch (e) {
      console.log(e.code + "|" + e.message);
    }
    process.exit(0);
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: "ERR_HTTP_TRAILER_INVALID|Trailers are invalid with this transfer encoding",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("ERR_HTTP_CONTENT_LENGTH_MISMATCH message matches Node.js", async () => {
  const fixture = `
    const http = require("node:http");
    const req = http.request({ port: 1, method: "POST", createConnection: () => new (require("node:net").Socket)() });
    req.on("error", () => {});
    req.strictContentLength = true;
    req.setHeader("Content-Length", "5");
    req.flushHeaders();
    try {
      req.write("hello world");
      console.log("NO THROW");
    } catch (e) {
      console.log(e.code + "|" + e.message);
    }
    process.exit(0);
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout:
      "ERR_HTTP_CONTENT_LENGTH_MISMATCH|Response body's content-length of 11 byte(s) does not match the content-length of 5 byte(s) set in header",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("ERR_STREAM_DESTROYED message from http ServerResponse matches Node.js", async () => {
  const fixture = `
    const http = require("node:http");
    const net = require("node:net");
    const server = http.createServer((req, res) => {
      res.destroy();
      res.write("x", err => {
        console.log(err.code + "|" + err.message);
        server.close();
        process.exit(0);
      });
    });
    server.listen(0, function () {
      const sock = net.connect(this.address().port);
      sock.on("error", () => {});
      sock.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
    });
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: "ERR_STREAM_DESTROYED|Cannot call write after a stream was destroyed",
    stderr: "",
    exitCode: 0,
  });
});
