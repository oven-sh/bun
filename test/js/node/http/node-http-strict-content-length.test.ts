import { expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import tls from "node:tls";

// A strictContentLength mismatch on the first end()/write() must throw before
// any bytes reach the wire; throwing after the header block is corked leaves
// the client a response with no terminating CRLFCRLF to block on forever.

// Resolve on 'close' without once(): once() rejects if the socket ever emits
// 'error' (e.g. an RST from the server) before closing.
function waitForClose(sock: net.Socket): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  sock.on("close", () => resolve());
  return promise;
}

async function requestRaw(port: number): Promise<string> {
  const sock = net.connect(port, "127.0.0.1");
  sock.setNoDelay(true);
  const chunks: Buffer[] = [];
  sock.on("data", d => chunks.push(Buffer.from(d)));
  sock.on("error", () => {});
  const closed = waitForClose(sock);
  await once(sock, "connect");
  sock.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  await closed;
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
    // FIN a tick later so any erroneously-flushed bytes reach the client first.
    setImmediate(() => res.socket!.end());
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  const wire = await requestRaw((server.address() as net.AddressInfo).port);
  const result = await handled;

  expect({ ...result, wire }).toEqual({
    code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
    // writeHead() marks headers as sent (like Node.js); the invariant under
    // test is that nothing was actually *flushed*.
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
    setImmediate(() => res.socket!.end());
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
    // Nothing was flushed, so a correct-length end() still forms a valid response.
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
    setImmediate(() => res.socket!.end());
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

test("strictContentLength: an invalid chunk still throws the chunk-type error, not a length mismatch", async () => {
  const { promise: handled, resolve, reject } = Promise.withResolvers<string>();
  await using server = http.createServer((req, res) => {
    req.resume();
    res.strictContentLength = true;
    res.writeHead(200, { "content-length": "10" });
    try {
      // A duck-typed non-buffer: measuring its byteLength (3 !== 10) would
      // misreport this as a Content-Length mismatch.
      res.end({ byteLength: 3 } as any);
      reject(new Error("end() should have thrown"));
      return;
    } catch (e: any) {
      resolve(e.code);
    }
    setImmediate(() => res.socket!.end());
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  await requestRaw((server.address() as net.AddressInfo).port);

  expect(await handled).toBe("ERR_INVALID_ARG_TYPE");
});

// Bun's native write/end accepts every ArrayBuffer-like type (not just
// Uint8Array), so the pre-flush check must measure all of them too.
test.each([
  ["DataView", () => new DataView(new ArrayBuffer(2))],
  ["ArrayBuffer", () => new ArrayBuffer(2)],
  ["SharedArrayBuffer", () => new SharedArrayBuffer(2)],
  ["Int8Array", () => new Int8Array(2)],
  ["Uint8ClampedArray", () => new Uint8ClampedArray(2)],
  ["Float32Array", () => new Float32Array(2)],
] as const)(
  "strictContentLength: a short %s end() throws before any bytes reach the wire",
  async (_name, makeChunk) => {
    const { promise: handled, resolve, reject } = Promise.withResolvers<string>();
    await using server = http.createServer((req, res) => {
      req.resume();
      res.strictContentLength = true;
      res.writeHead(200, { "content-length": "100" });
      try {
        res.end(makeChunk() as any);
        reject(new Error("end() should have thrown"));
        return;
      } catch (e: any) {
        resolve(e.code);
      }
      setImmediate(() => res.socket!.end());
    });
    await once(server.listen(0, "127.0.0.1"), "listening");

    const wire = await requestRaw((server.address() as net.AddressInfo).port);
    const code = await handled;

    expect({ code, wire }).toEqual({ code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH", wire: "" });
  },
);

// The http2 allowHTTP1 fallback drives ServerResponse with a JS shim handle
// (createHttp1FallbackResponseHandle in http2.ts) that has no
// getBytesWritten(), so the pre-flush check must not assume a native handle.

async function h2FallbackRequestRaw(port: number): Promise<string> {
  const sock = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] });
  const chunks: Buffer[] = [];
  sock.on("data", d => chunks.push(Buffer.from(d)));
  sock.on("error", () => {});
  const closed = waitForClose(sock);
  await once(sock, "secureConnect");
  sock.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  await closed;
  return Buffer.concat(chunks).toString("binary");
}

test("strictContentLength: http2 allowHTTP1 fallback with matching length succeeds", async () => {
  const { promise: handled, resolve, reject } = Promise.withResolvers<void>();
  await using server = http2.createSecureServer({ ...tlsCert, allowHTTP1: true }, (req, res) => {
    try {
      res.strictContentLength = true;
      res.writeHead(200, { "content-length": "10" });
      res.end("1234567890");
      resolve();
    } catch (e) {
      reject(e);
    }
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  const wire = await h2FallbackRequestRaw((server.address() as net.AddressInfo).port);
  await handled;

  expect(wire).toContain("1234567890");
});

test("strictContentLength: http2 allowHTTP1 fallback mismatch throws the right error", async () => {
  const { promise: handled, resolve, reject } = Promise.withResolvers<string>();
  await using server = http2.createSecureServer({ ...tlsCert, allowHTTP1: true }, (req, res) => {
    res.strictContentLength = true;
    res.writeHead(200, { "content-length": "10" });
    try {
      res.end("hi");
      reject(new Error("end() should have thrown"));
      return;
    } catch (e: any) {
      resolve(`${e.constructor.name}:${e.code}`);
    }
    setImmediate(() => res.socket!.end());
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  await h2FallbackRequestRaw((server.address() as net.AddressInfo).port);

  expect(await handled).toBe("Error:ERR_HTTP_CONTENT_LENGTH_MISMATCH");
});
