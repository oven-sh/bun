import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

async function withRawServer(fn: (port: number) => void | Promise<void>) {
  const srv = net.createServer(s => {
    s.on("data", () => s.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
    s.on("error", () => {});
  });
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  const port = (srv.address() as net.AddressInfo).port;
  try {
    await fn(port);
  } finally {
    await new Promise<void>(r => srv.close(() => r()));
  }
}

test("ERR_HTTP_CONTENT_LENGTH_MISMATCH message matches Node.js", async () => {
  await withRawServer(port => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      agent: false,
      headers: { "Content-Length": 5 },
    });
    req.on("error", () => {});
    req.strictContentLength = true;
    let err: any;
    try {
      req.end("abc");
    } catch (e) {
      err = e;
    }
    req.destroy();
    expect(err).toBeDefined();
    expect(err.code).toBe("ERR_HTTP_CONTENT_LENGTH_MISMATCH");
    expect(err.message).toBe(
      "Response body's content-length of 3 byte(s) does not match the content-length of 5 byte(s) set in header",
    );
  });
});

test("ERR_HTTP_TRAILER_INVALID message matches Node.js", async () => {
  await withRawServer(port => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "GET",
      agent: false,
      headers: { Trailer: "X-T" },
    });
    req.on("error", () => {});
    let err: any;
    try {
      req.end();
    } catch (e) {
      err = e;
    }
    req.destroy();
    expect(err).toBeDefined();
    expect(err.code).toBe("ERR_HTTP_TRAILER_INVALID");
    expect(err.message).toBe("Trailers are invalid with this transfer encoding");
  });
});
