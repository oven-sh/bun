import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("what a program stores on a response, its request or its server after the first write() does not change the head", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "node-http-head-is-decided-at-the-first-write-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`nothing between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.sendDate = false between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.sendDate = false before:
    however it is sent: HTTP/1.1 200 OK | content-length | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.sendDate = false before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.shouldKeepAlive = false between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.shouldKeepAlive = false before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: close || the whole body || closes
res.shouldKeepAlive = false before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: close || the whole body || closes
res._keepAliveTimeout = 0 between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._keepAliveTimeout = 0 before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive || the whole body || answers again
res._keepAliveTimeout = 0 before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive || the whole body || answers again
res._keepAliveTimeout = 9000 between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._keepAliveTimeout = 9000 before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=9 || the whole body || answers again
res._keepAliveTimeout = 9000 before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=9 || the whole body || answers again
res._keepAliveTimeout = "9000" between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._keepAliveTimeout = "9000" before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=9 || the whole body || answers again
res._keepAliveTimeout = "9000" before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=9 || the whole body || answers again
res._maxRequestsPerSocket = 7 between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._maxRequestsPerSocket = 7 before:
    however it is sent: HTTP/1.1 200 OK | content-length | Connection: keep-alive | Keep-Alive: timeout=5, max=7 | Date || the whole body || answers again
res._maxRequestsPerSocket = 7 before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Connection: keep-alive | Keep-Alive: timeout=5, max=7 | Date || the whole body || answers again
res.maxRequestsOnConnectionReached = true between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.maxRequestsOnConnectionReached = true before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: close || the whole body || answers again
res.maxRequestsOnConnectionReached = true before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: close || the whole body || answers again
res.useChunkedEncodingByDefault = false between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.useChunkedEncodingByDefault = false before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.useChunkedEncodingByDefault = false before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._hasBody = false between:
    setHeader(), write(), end() | setHeader(), write(), flushHeaders(), end() | setHeader(), write(), end() in a tick | setHeader(), write(), end() in a later turn | writeHead(), write(), end() | writeHead(), write(), flushHeaders(), end() | writeHead(), write(), end() in a tick | writeHead(), write(), end() in a later turn: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
    setHeader(), write(), end(body) | setHeader(), write(), write(), end() | writeHead(), write(), end(body) | writeHead(), write(), write(), end(): HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || "ok" || answers again
res._hasBody = false before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || "" || answers again
res._hasBody = false before, and taken back between:
    setHeader(), write(), end() | setHeader(), write(), end(body) | setHeader(), write(), flushHeaders(), end() | setHeader(), write(), end() in a tick | setHeader(), write(), end() in a later turn | writeHead(), write(), end() | writeHead(), write(), end(body) | writeHead(), write(), flushHeaders(), end() | writeHead(), write(), end() in a tick | writeHead(), write(), end() in a later turn: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || "" || answers again
    setHeader(), write(), write(), end() | writeHead(), write(), write(), end(): HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || "ok" || answers again
res._removedConnection = true between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._removedConnection = true before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date || the whole body || answers again
res._removedConnection = true before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date || the whole body || answers again
res._removedContLen = true between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._removedContLen = true before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._removedContLen = true before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._removedTE = true between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._removedTE = true before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._removedTE = true before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.statusCode = 404 between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.statusCode = 404 before:
    setHeader(), write(), end() | setHeader(), write(), end(body) | setHeader(), write(), write(), end() | setHeader(), write(), flushHeaders(), end() | setHeader(), write(), end() in a tick | setHeader(), write(), end() in a later turn: HTTP/1.1 404 Not Found | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
    writeHead(), write(), end() | writeHead(), write(), end(body) | writeHead(), write(), write(), end() | writeHead(), write(), flushHeaders(), end() | writeHead(), write(), end() in a tick | writeHead(), write(), end() in a later turn: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.statusCode = 404 before, and taken back between:
    setHeader(), write(), end() | setHeader(), write(), end(body) | setHeader(), write(), write(), end() | setHeader(), write(), flushHeaders(), end() | setHeader(), write(), end() in a tick | setHeader(), write(), end() in a later turn: HTTP/1.1 404 Not Found | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
    writeHead(), write(), end() | writeHead(), write(), end(body) | writeHead(), write(), write(), end() | writeHead(), write(), flushHeaders(), end() | writeHead(), write(), end() in a tick | writeHead(), write(), end() in a later turn: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.statusMessage = "Other" between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.statusMessage = "Other" before:
    however it is sent: HTTP/1.1 200 Other | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.statusMessage = "Other" before, and taken back between:
    however it is sent: HTTP/1.1 200 Other | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.chunkedEncoding = true between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.chunkedEncoding = true before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.chunkedEncoding = true before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._contentLength = 5 between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._contentLength = 5 before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._contentLength = 5 before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._last = true between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._last = true before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res._last = true before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.strictContentLength = true between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.strictContentLength = true before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
res.strictContentLength = true before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
req.httpVersionMinor = 0 between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
req.httpVersionMinor = 0 before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
req.httpVersionMinor = 0 before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
req.httpVersionMajor = 0 between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
req.httpVersionMajor = 0 before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
req.httpVersionMajor = 0 before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
req.headers.connection = close between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
req.headers.connection = close before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
req.headers.connection = close before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
server.keepAliveTimeout = 9000 between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
server.keepAliveTimeout = 9000 before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
server.keepAliveTimeout = 9000 before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
a header stored in the table of headers between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
a header stored in the table of headers before:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
a header stored in the table of headers before, and taken back between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
setHeader() between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again (setHeader() throws ERR_HTTP_HEADERS_SENT)
appendHeader() between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again (appendHeader() throws ERR_HTTP_HEADERS_SENT)
setHeaders() between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again (setHeaders() throws ERR_HTTP_HEADERS_SENT)
removeHeader() between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again (removeHeader() throws ERR_HTTP_HEADERS_SENT)
writeHead() between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again (writeHead() throws ERR_HTTP_HEADERS_SENT)
addTrailers() between:
    however it is sent: HTTP/1.1 200 OK | content-length | Date | Connection: keep-alive | Keep-Alive: timeout=5 || the whole body || answers again
`);
  expect(exitCode).toBe(0);
});
