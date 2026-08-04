import { expect, test } from "bun:test";
import { tls as TLS_CERT } from "harness";
import http2 from "node:http2";
import tls from "node:tls";

// The HTTP/1.1 fallback of an allowHTTP1 h2 server drives the native HTTPParser,
// which flushes each full 32-slot header block through a separate callback and
// only hands the residual block to headers-complete. The fallback used to read
// only that residual block, so requests with more than 31 headers lost most of
// their headers (host, cookie, authorization, ...).

test("http2 allowHTTP1 fallback delivers every request header when there are more than 31", async () => {
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true }, (req, res) => {
    res.end(
      JSON.stringify({
        host: req.headers.host,
        cookie: req.headers.cookie,
        authorization: req.headers.authorization,
        first: req.headers["x-c0"],
        last: req.headers["x-c39"],
        count: Object.keys(req.headers).length,
      }),
    );
  });
  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  try {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const socket = tls.connect(
      { host: "localhost", port: (server.address() as any).port, ca: TLS_CERT.cert, ALPNProtocols: ["http/1.1"] },
      () => {
        // 44 request headers (host, cookie, authorization, connection + 40 x-c*),
        // which crosses the parser's 32-slot flush boundary at least once.
        let request =
          "GET / HTTP/1.1\r\nHost: example.test\r\nCookie: sid=abc123\r\nAuthorization: Bearer token-xyz\r\nConnection: close\r\n";
        for (let i = 0; i < 40; i++) request += `x-c${i}: value-${i}\r\n`;
        socket.write(request + "\r\n");
      },
    );
    const chunks: Buffer[] = [];
    socket.on("error", reject);
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
    const raw = await promise;
    const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
    expect(JSON.parse(body)).toEqual({
      host: "example.test",
      cookie: "sid=abc123",
      authorization: "Bearer token-xyz",
      first: "value-0",
      last: "value-39",
      count: 44,
    });
  } finally {
    server.close();
  }
});

test("http2 allowHTTP1 fallback does not leak a chunked request's trailers into the next keep-alive request", async () => {
  const seen: Array<{ path: string; trailer: string | undefined }> = [];
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true }, (req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({ path: req.url, trailer: req.headers["x-trailer"] as string | undefined });
      res.end(req.url);
    });
  });
  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  try {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = tls.connect(
      { host: "localhost", port: (server.address() as any).port, ca: TLS_CERT.cert, ALPNProtocols: ["http/1.1"] },
      () => {
        // Request 1: a chunked body with a trailing header, keep-alive.
        socket.write(
          "POST /a HTTP/1.1\r\nHost: h\r\nTransfer-Encoding: chunked\r\n\r\n" +
            "5\r\nhello\r\n0\r\nX-Trailer: secret\r\n\r\n",
        );
      },
    );
    const chunks: Buffer[] = [];
    let sentSecond = false;
    socket.on("error", reject);
    socket.on("data", chunk => {
      chunks.push(chunk);
      if (!sentSecond && Buffer.concat(chunks).includes("\r\n\r\n")) {
        sentSecond = true;
        // Request 2 on the same connection must not inherit request 1's trailer.
        socket.write("GET /b HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
      }
    });
    socket.on("end", () => resolve());
    await promise;
    expect(seen).toEqual([
      { path: "/a", trailer: undefined },
      { path: "/b", trailer: undefined },
    ]);
  } finally {
    server.close();
  }
});
