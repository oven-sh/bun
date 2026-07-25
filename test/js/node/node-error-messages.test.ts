import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";

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

test("ERR_HTTP_TRAILER_INVALID message matches Node.js", () => {
  const req = http.request({ port: 1, method: "POST", createConnection: () => new net.Socket() });
  req.on("error", () => {});
  req.setHeader("Content-Length", "5");
  req.setHeader("Trailer", "X-Foo");
  let err: any;
  try {
    req.flushHeaders();
  } catch (e) {
    err = e;
  }
  req.destroy();
  expect({ code: err?.code, message: err?.message }).toEqual({
    code: "ERR_HTTP_TRAILER_INVALID",
    message: "Trailers are invalid with this transfer encoding",
  });
});

test("ERR_HTTP_CONTENT_LENGTH_MISMATCH message matches Node.js", () => {
  const req = http.request({ port: 1, method: "POST", createConnection: () => new net.Socket() });
  req.on("error", () => {});
  req.strictContentLength = true;
  req.setHeader("Content-Length", "5");
  req.flushHeaders();
  let err: any;
  try {
    req.write("hello world");
  } catch (e) {
    err = e;
  }
  req.destroy();
  expect({ code: err?.code, message: err?.message }).toEqual({
    code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
    message:
      "Response body's content-length of 11 byte(s) does not match the content-length of 5 byte(s) set in header",
  });
});

test("ERR_STREAM_DESTROYED message from http ServerResponse matches Node.js", async () => {
  const { promise, resolve } = Promise.withResolvers<any>();
  const server = http.createServer((req, res) => {
    res.destroy();
    res.write("x", resolve);
  });
  server.listen(0);
  await once(server, "listening");
  const sock = net.connect((server.address() as net.AddressInfo).port);
  sock.on("error", () => {});
  sock.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
  const err = await promise;
  sock.destroy();
  await new Promise<void>(r => server.close(() => r()));
  expect({ code: err?.code, message: err?.message }).toEqual({
    code: "ERR_STREAM_DESTROYED",
    message: "Cannot call write after a stream was destroyed",
  });
});
