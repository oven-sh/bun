import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

// When res.strictContentLength is set and the first end()/write() call
// detects a mismatch, Node throws before any bytes reach the wire. Bun was
// calling handle.writeHead() inside the same cork block as handle.end()/
// handle.write(), so the throw happened *after* the status line and headers
// (without the terminating blank line) were already buffered and flushed on
// uncork, leaving the client with a syntactically incomplete HTTP message it
// would block on until its own timeout.

async function requestRaw(port: number): Promise<string> {
  const sock = net.connect(port, "127.0.0.1");
  sock.setNoDelay(true);
  const chunks: Buffer[] = [];
  sock.on("data", d => chunks.push(Buffer.from(d)));
  sock.on("error", () => {});
  await once(sock, "connect");
  sock.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  await once(sock, "close");
  return Buffer.concat(chunks).toString("binary");
}

test("strictContentLength: short end() throws before any bytes reach the wire", async () => {
  const { promise: handled, resolve, reject } = Promise.withResolvers<{ code: string; headersSent: boolean }>();
  await using server = http.createServer((req, res) => {
    req.resume();
    res.strictContentLength = true;
    res.writeHead(200, { "content-length": "10" });
    try {
      res.end("hi");
      reject(new Error("end() should have thrown"));
      return;
    } catch (e: any) {
      resolve({ code: e.code, headersSent: res.headersSent });
    }
    // Close the underlying connection on a later tick so any already-flushed
    // bytes reach the client before the socket goes away.
    setImmediate(() => res.socket!.destroy());
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  const wire = await requestRaw((server.address() as net.AddressInfo).port);
  const result = await handled;

  expect({ ...result, wire }).toEqual({
    code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
    // writeHead() already marked headers as sent (like Node.js); the point is
    // that nothing was actually *flushed*.
    headersSent: true,
    wire: "",
  });
});

test("strictContentLength: over-long write() throws before any bytes reach the wire", async () => {
  const { promise: handled, resolve, reject } = Promise.withResolvers<{ code: string; headersSent: boolean }>();
  await using server = http.createServer((req, res) => {
    req.resume();
    res.strictContentLength = true;
    res.writeHead(200, { "content-length": "5" });
    try {
      res.write("hello world");
      reject(new Error("write() should have thrown"));
      return;
    } catch (e: any) {
      resolve({ code: e.code, headersSent: res.headersSent });
    }
    setImmediate(() => res.socket!.destroy());
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  const wire = await requestRaw((server.address() as net.AddressInfo).port);
  const result = await handled;

  expect({ ...result, wire }).toEqual({
    code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
    headersSent: true,
    wire: "",
  });
});

test("strictContentLength: response can be recovered after a rejected end()", async () => {
  const { promise: handled, resolve, reject } = Promise.withResolvers<string>();
  await using server = http.createServer((req, res) => {
    req.resume();
    res.strictContentLength = true;
    res.writeHead(200, { "content-length": "10" });
    try {
      res.end("hi");
      reject(new Error("end() should have thrown"));
      return;
    } catch (e: any) {
      resolve(e.code);
    }
    // Nothing was flushed, so a subsequent end() with the right length
    // produces a well-formed response.
    res.end("1234567890");
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  const port = (server.address() as net.AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}/`);
  const body = await res.text();
  const code = await handled;

  expect({ code, status: res.status, body }).toEqual({
    code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
    status: 200,
    body: "1234567890",
  });
});

test("strictContentLength: end() with no chunk and unmet Content-Length throws before flushing headers", async () => {
  const { promise: handled, resolve, reject } = Promise.withResolvers<{ code: string; headersSent: boolean }>();
  await using server = http.createServer((req, res) => {
    req.resume();
    res.strictContentLength = true;
    res.writeHead(200, { "content-length": "10" });
    try {
      res.end();
      reject(new Error("end() should have thrown"));
      return;
    } catch (e: any) {
      resolve({ code: e.code, headersSent: res.headersSent });
    }
    setImmediate(() => res.socket!.destroy());
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  const wire = await requestRaw((server.address() as net.AddressInfo).port);
  const result = await handled;

  expect({ ...result, wire }).toEqual({
    code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
    headersSent: true,
    wire: "",
  });
});
