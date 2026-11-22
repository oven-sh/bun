import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExeAtLeast } from "harness";
import { STATUS_CODES } from "node:http";
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

describe.concurrent(
  "the first write() or end() of a response stores the default statusMessage, as writeHead() does",
  () => {
    const fixture = join(import.meta.dir, "node-http-status-message-of-an-implicit-head-fixture.ts");
    const asInNode = `end(chunk):
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
end():
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
end(callback):
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
end(""):
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
write(chunk), end():
    after write(): headersSent true, statusMessage "OK"
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
write(""), end():
    after write(): headersSent true, statusMessage "OK"
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
a HEAD request, end(chunk):
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
an HTTP/1.0 request, write(chunk), end():
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
statusCode = 404, end():
    after the listener: headersSent true, statusMessage "Not Found"
    at 'finish': statusMessage "Not Found"
    stored: ["Not Found"]
    on the wire: HTTP/1.1 404 Not Found
statusCode = 204, end():
    after the listener: headersSent true, statusMessage "No Content"
    at 'finish': statusMessage "No Content"
    stored: ["No Content"]
    on the wire: HTTP/1.1 204 No Content
statusCode = 599, end():
    after the listener: headersSent true, statusMessage "unknown"
    at 'finish': statusMessage "unknown"
    stored: ["unknown"]
    on the wire: HTTP/1.1 599 unknown
statusCode = 306, end():
    after the listener: headersSent true, statusMessage "unknown"
    at 'finish': statusMessage "unknown"
    stored: ["unknown"]
    on the wire: HTTP/1.1 306 unknown
statusCode = 509, write(chunk), end():
    after the listener: headersSent true, statusMessage "Bandwidth Limit Exceeded"
    at 'finish': statusMessage "Bandwidth Limit Exceeded"
    stored: ["Bandwidth Limit Exceeded"]
    on the wire: HTTP/1.1 509 Bandwidth Limit Exceeded
statusMessage = "", end():
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["", "OK"]
    on the wire: HTTP/1.1 200 OK
statusMessage = null, write(chunk), end():
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: [null, "OK"]
    on the wire: HTTP/1.1 200 OK
statusMessage = "Custom", end():
    after the listener: headersSent true, statusMessage "Custom"
    at 'finish': statusMessage "Custom"
    stored: ["Custom"]
    on the wire: HTTP/1.1 200 Custom
statusCode = 404, statusMessage = "OK", end():
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 404 OK
flushHeaders(), end():
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
writeHead(200), end():
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
STATUS_CODES[298] is written, end(chunk):
    after the listener: headersSent true, statusMessage "Fine"
    at 'finish': statusMessage "Fine"
    stored: ["Fine"]
    on the wire: HTTP/1.1 298 Fine
a writeHead() of the program's own, end(chunk):
    writeHead() is entered with statusMessage undefined
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
a writeHead() of the program's own, write(chunk), end():
    writeHead() is entered with statusMessage undefined
    after the listener: headersSent true, statusMessage "OK"
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
destroy(), end(chunk):
    after the listener: headersSent false, statusMessage undefined
    stored: []
    on the wire: nothing
destroy(), end():
    after the listener: headersSent true, statusMessage "OK"
    stored: ["OK"]
    on the wire: nothing
destroy(), write(chunk):
    after the listener: headersSent false, statusMessage undefined
    stored: []
    on the wire: nothing
end(123), statusCode = 500, end(chunk):
    throws ERR_INVALID_ARG_TYPE
    then headersSent false, statusMessage undefined
    after the listener: headersSent true, statusMessage "Internal Server Error"
    at 'finish': statusMessage "Internal Server Error"
    stored: ["Internal Server Error"]
    on the wire: HTTP/1.1 500 Internal Server Error
write({}), statusCode = 500, end(chunk):
    throws ERR_INVALID_ARG_TYPE
    then headersSent false, statusMessage undefined
    after the listener: headersSent true, statusMessage "Internal Server Error"
    at 'finish': statusMessage "Internal Server Error"
    stored: ["Internal Server Error"]
    on the wire: HTTP/1.1 500 Internal Server Error
statusCode = 99, end(), statusCode = 500, end():
    throws ERR_HTTP_INVALID_STATUS_CODE
    then headersSent false, statusMessage undefined
    after the listener: headersSent true, statusMessage "Internal Server Error"
    at 'finish': statusMessage "Internal Server Error"
    stored: ["Internal Server Error"]
    on the wire: HTTP/1.1 500 Internal Server Error
statusCode = 1000, write(chunk), statusCode = 500, end():
    throws ERR_HTTP_INVALID_STATUS_CODE
    then headersSent false, statusMessage undefined
    after the listener: headersSent true, statusMessage "Internal Server Error"
    at 'finish': statusMessage "Internal Server Error"
    stored: ["Internal Server Error"]
    on the wire: HTTP/1.1 500 Internal Server Error
67 status codes, each sent in 4 ways:
    the client receives the text of STATUS_CODES or 'unknown', and the response keeps it
108 answers, each with and without writeHead(statusCode) in front:
    the same statusMessage and the same status line
16 chunks, each given to a first end() and a first write():
    refused or taken as behind writeHead()
over a connection that the program hands over, end(chunk):
    after the listener: headersSent true, statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
over a connection that the program hands over, statusCode = 404, write(chunk), end():
    after the listener: headersSent true, statusMessage "Not Found"
    stored: ["Not Found"]
    on the wire: HTTP/1.1 404 Not Found
over a connection that the program hands over, statusCode = 599, end():
    after the listener: headersSent true, statusMessage "unknown"
    stored: ["unknown"]
    on the wire: HTTP/1.1 599 unknown
over a connection that the program hands over, STATUS_CODES[200] is written, statusMessage = "OK", end(chunk):
    after the listener: headersSent true, statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
a response that waits its turn, end(chunk):
    at 'finish': statusMessage "OK"
    stored: ["OK"]
    on the wire: HTTP/1.1 200 OK
a response that waits its turn, statusCode = 404, write(chunk), end():
    at 'finish': statusMessage "Not Found"
    stored: ["Not Found"]
    on the wire: HTTP/1.1 404 Not Found
`;
    const inBunAlone = `What follows is what Bun does. Node.js does otherwise, or not the same in every release.
STATUS_CODES[200] is written, end(chunk):
    after the listener: headersSent true, statusMessage "Fine"
    at 'finish': statusMessage "Fine"
    stored: ["Fine"]
    on the wire: HTTP/1.1 200 Fine
STATUS_CODES[404] is written, write(chunk), end():
    after the listener: headersSent true, statusMessage "Nowhere"
    at 'finish': statusMessage "Nowhere"
    stored: ["Nowhere"]
    on the wire: HTTP/1.1 404 Nowhere
STATUS_CODES[200] is written with a line break, a Content-Length, write(chunk), end(chunk):
    throws ERR_INVALID_CHAR
    then headersSent false, statusMessage "Fi\\nne"
    after the listener: headersSent true, statusMessage "Mended"
    at 'finish': statusMessage "Mended"
    on the wire: HTTP/1.1 200 Mended
rejectNonStandardBodyWrites: statusCode = 204, end(chunk), statusCode = 500, end():
    throws ERR_HTTP_BODY_NOT_ALLOWED
    then headersSent false, statusMessage undefined
    after the listener: headersSent true, statusMessage "Internal Server Error"
    at 'finish': statusMessage "Internal Server Error"
    stored: ["Internal Server Error"]
    on the wire: HTTP/1.1 500 Internal Server Error
rejectNonStandardBodyWrites: statusCode = 304, write(chunk), statusCode = 500, end():
    throws ERR_HTTP_BODY_NOT_ALLOWED
    then headersSent false, statusMessage undefined
    after the listener: headersSent true, statusMessage "Internal Server Error"
    at 'finish': statusMessage "Internal Server Error"
    stored: ["Internal Server Error"]
    on the wire: HTTP/1.1 500 Internal Server Error
`;

    test("in Bun", async () => {
      await using proc = Bun.spawn({ cmd: [bunExe(), fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe(asInNode + inBunAlone);
      expect(exitCode).toBe(0);
    });

    // The lines were recorded with Node.js v26.3.0 and v26.12.1.
    const node = nodeExeAtLeast("26.3.0");
    test.skipIf(!node)("in Node.js", async () => {
      await using proc = Bun.spawn({ cmd: [node!, fixture], env: bunEnv, stdout: "pipe", stderr: "ignore" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe(asInNode);
      expect(exitCode).toBe(0);
    });
  },
);

// `nativeStatusTexts` in src/js/internal/http.ts is STATUS_CODES without the status codes that differ here.
test("the reason phrases that the native handle writes by itself are those of STATUS_CODES, but for three status codes", async () => {
  const source = await Bun.file(join(import.meta.dir, "../../../../src/runtime/server/HTTPStatusText.rs")).text();
  const native: Record<string, string | undefined> = Object.fromEntries(
    Array.from(source.matchAll(/^\s*(\d+) => Some\(b"\1 ([^"]*)"\),$/gm), match => [match[1], match[2]]),
  );
  expect(Object.keys(native).length).toBeGreaterThan(60);
  const differing: Record<string, [native: string | undefined, table: string | undefined]> = {};
  for (const code of new Set([...Object.keys(native), ...Object.keys(STATUS_CODES)])) {
    if (native[code] !== STATUS_CODES[code]) differing[code] = [native[code], STATUS_CODES[code]];
  }
  expect(differing).toEqual({
    101: ["Switching protocols", "Switching Protocols"],
    306: ["Switch Proxy", undefined],
    509: [undefined, "Bandwidth Limit Exceeded"],
  });
});
