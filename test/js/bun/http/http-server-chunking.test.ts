import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { isPosix } from "harness";

/**
 * `tick()` resolves once an in-process receiver has read everything written to loopback before the call.
 * It sends one byte over a spare loopback connection. Loopback delivers in write order, so when that byte
 * arrives, the earlier writes were readable in the same poll. The `setImmediate` then lets the rest of
 * that poll's callbacks run. `setImmediate` alone runs before the next poll, so the writes would coalesce.
 */
async function loopbackClock() {
  let arrived = () => {};
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data() {
        arrived();
      },
    },
  });
  const socket = await Bun.connect({
    hostname: listener.hostname,
    port: listener.port,
    socket: { data() {} },
  });
  return {
    async tick() {
      const { promise, resolve } = Promise.withResolvers<void>();
      arrived = resolve;
      socket.write(".");
      socket.flush();
      await promise;
      await new Promise<void>(resolve => setImmediate(resolve));
    },
    [Symbol.dispose]() {
      socket.end();
      listener.stop();
    },
  };
}

interface SeenRequest {
  path: string;
  /** Set when `req.text()` resolved. */
  body?: string;
  /** Set when `req.text()` rejected because the parser rejected the body. */
  error?: string;
}

/** A pending `req.text()` rejects with this when the parser closes the connection. */
const BODY_REJECTED = "AbortError: The connection was closed.";

/**
 * Sends `segments` over one connection to a Bun.serve that echoes the request body. Resolves when the
 * server closes the connection, which every request asks for with `Connection: close`.
 *
 * The server reads each segment separately. Once it has answered or hung up, the remaining segments
 * aren't sent. A server that wrongly accepts a bad segment still gets the rest and answers 200.
 */
async function exchange(segments: readonly string[], options: { maxRequestBodySize?: number } = {}) {
  const seen: SeenRequest[] = [];
  const handled: Promise<Response>[] = [];
  await using server = Bun.serve({
    ...options,
    port: 0,
    fetch(req) {
      const request: SeenRequest = { path: new URL(req.url).pathname };
      seen.push(request);
      const response = req.text().then(
        body => {
          request.body = body;
          return new Response("Got: " + body);
        },
        (error: Error) => {
          request.error = `${error.name}: ${error.message}`;
          // The parser already answered and closed the connection, so the client never sees this 500.
          return new Response(null, { status: 500 });
        },
      );
      handled.push(response);
      return response;
    },
  });

  let received = "";
  let closed = false;
  const { promise: closedPromise, resolve: onClose } = Promise.withResolvers<void>();
  using clock = await loopbackClock();
  using socket = await Bun.connect({
    hostname: server.hostname!,
    port: server.port!,
    socket: {
      data(_socket, chunk) {
        received += chunk.toString();
      },
      close() {
        closed = true;
        onClose();
      },
      error() {},
    },
  });

  for (const segment of segments) {
    if (received !== "" || closed) break;
    socket.write(segment);
    socket.flush();
    // After the first tick the server has read the segment and written any response.
    // After the second, that response is in `received`.
    await clock.tick();
    await clock.tick();
  }

  await closedPromise;
  await Promise.all(handled);

  const [status] = received.split("\r\n");
  const headersEnd = received.indexOf("\r\n\r\n");
  return { status, body: headersEnd === -1 ? "" : received.slice(headersEnd + 4), seen };
}

function chunkedRequest(path = "/") {
  return `POST ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n`;
}

describe.if(isPosix)("HTTP server handles chunked transfer encoding", () => {
  test.concurrent("writes separated by a loopbackClock() tick arrive as separate reads", async () => {
    // If the writes coalesced, the split-segment cases below would still pass, but on unsplit input.
    const reads: string[] = [];
    using listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(_socket, chunk) {
          reads.push(chunk.toString());
        },
      },
    });
    using clock = await loopbackClock();
    using socket = await Bun.connect({
      hostname: listener.hostname,
      port: listener.port,
      socket: { data() {} },
    });

    for (const segment of ["first", "second", "third"]) {
      socket.write(segment);
      socket.flush();
      await clock.tick();
    }

    expect(reads).toEqual(["first", "second", "third"]);
  });

  test.concurrent.each([
    {
      name: "a chunk-data CRLF split after the CR",
      segments: [chunkedRequest() + "4\r\nWiki\r", "\n0\r\n\r\n"],
      body: "Wiki",
    },
    {
      // The parser has to remember the \r and resume instead of spinning.
      name: "a chunk-size CRLF split after the CR",
      segments: [chunkedRequest(), "5\r", "\nHello\r\n0\r\n\r\n"],
      body: "Hello",
    },
    {
      // Same split, but the parser resumes from the chunk-extension state.
      name: "a chunk-size CRLF split after the CR of a line with an extension",
      segments: [chunkedRequest(), "5;ext=val\r", "\nHello\r\n0\r\n\r\n"],
      body: "Hello",
    },
    {
      // 80 KiB of extension bytes in total, but the 16 KiB cap is per chunk, as in llhttp.
      name: "an 8 KiB chunk extension on each of 10 chunks",
      segments: [
        chunkedRequest() +
          Array(10)
            .fill(`1;${Buffer.alloc(8 * 1024, "e").toString()}\r\nA\r\n`)
            .join("") +
          "0\r\n\r\n",
      ],
      body: "AAAAAAAAAA",
    },
  ])("accepts $name", async ({ segments, body }) => {
    expect(await exchange(segments)).toEqual({
      status: "HTTP/1.1 200 OK",
      body: "Got: " + body,
      seen: [{ path: "/", body }],
    });
  });

  // RFC 9112 7.1.2: header lines can follow the last chunk, up to an empty line. Bun.serve discards them.
  // "/next" only runs if the parser found the end of the trailer section.
  const keepAlive = "POST /first HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n";
  const next = "GET /next HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n";
  test.concurrent.each([
    { name: "in one read", segments: [keepAlive + "0\r\nX-Trail: one\r\nX-More: two\r\n\r\n" + next] },
    {
      name: "split inside a field name",
      segments: [keepAlive + "0\r\nX", "-Trail: one\r\nX-More: two\r\n\r\n" + next],
    },
    {
      name: "split after each line",
      segments: [keepAlive + "0\r\n", "X-Trail: one\r\n", "X-More: two\r\n", "\r\n" + next],
    },
    {
      name: "split after a field line's CR",
      segments: [keepAlive + "0\r\nX-Trail: one\r", "\nX-More: two\r\n\r\n" + next],
    },
    { name: "split after the empty line's CR", segments: [keepAlive + "0\r\nX-Trail: one\r\n\r", "\n" + next] },
    { name: "after a last chunk with an extension", segments: [keepAlive + "0;ext=v\r\nX-Trail: one\r\n\r\n" + next] },
  ])("accepts a trailer section $name", async ({ segments }) => {
    const { status, seen } = await exchange(segments);
    expect({ status, seen }).toEqual({
      status: "HTTP/1.1 200 OK",
      seen: [
        { path: "/first", body: "hello" },
        { path: "/next", body: "" },
      ],
    });
  });

  test.concurrent.each([
    {
      // The read ends one byte into the chunk terminator, so the partial-read path has to reject the X.
      // Otherwise the second segment completes a 200 for "Test".
      name: "a chunk-data terminator whose CR is some other byte",
      segments: [chunkedRequest() + "4\r\nTestX", "\n0\r\n\r\n"],
      seen: [{ path: "/", error: BODY_REJECTED }],
    },
    {
      // A byte <= 0x20 other than \r must fail right away. Left in the parser's fallback buffer, it
      // would corrupt the next request on the connection.
      name: "a bare LF in chunk-size position",
      segments: [chunkedRequest() + "\n"],
      seen: [{ path: "/", error: BODY_REJECTED }],
    },
    {
      // RFC 7230 4.1: chunk-size = 1*HEXDIG. Parsing an empty chunk-size line as the last chunk would
      // turn the bytes after it into a second request.
      name: "a chunk-size line with no hex digits, followed by a smuggled request",
      segments: [chunkedRequest("/first") + "\r\n\r\nGET /smuggled HTTP/1.1\r\nHost: x\r\n\r\n"],
      seen: [{ path: "/first", error: BODY_REJECTED }],
    },
    {
      name: "a chunk-size line with only an extension, followed by a smuggled request",
      segments: [chunkedRequest("/first") + ";a=b\r\n\r\nGET /smuggled HTTP/1.1\r\nHost: x\r\n\r\n"],
      seen: [{ path: "/first", error: BODY_REJECTED }],
    },
    {
      // A server that parsed the line as the last chunk would answer the final CRLF with a 200.
      name: "a chunk-size line with no hex digits, arriving in its own segment",
      segments: [chunkedRequest(), "\r\n", "\r\n"],
      seen: [{ path: "/", error: BODY_REJECTED }],
    },
    {
      name: "a chunk-size line with only an extension, arriving in its own segment",
      segments: [chunkedRequest(), ";a=b\r\n", "\r\n"],
      seen: [{ path: "/", error: BODY_REJECTED }],
    },
    {
      name: "a bare LF in the trailer section",
      segments: [chunkedRequest() + "5\r\nhello\r\n0\r\nX-T: 9\n\r\n"],
      seen: [{ path: "/", error: BODY_REJECTED }],
    },
    {
      name: "a CR without LF in the trailer section",
      segments: [chunkedRequest() + "5\r\nhello\r\n0\r\nX-T: 9\rZ\r\n\r\n"],
      seen: [{ path: "/", error: BODY_REJECTED }],
    },
    {
      name: "a trailer line without a colon, split across reads",
      segments: [chunkedRequest() + "5\r\nhello\r\n0\r\nX-T: 9\r\njust", "text\r", "\n\r", "\n"],
      seen: [{ path: "/", error: BODY_REJECTED }],
    },
    {
      // remainingStreamingBytes is shared between Content-Length and chunked state. 2^59 would set
      // STATE_HAS_HEXDIG and route a fixed-length body into the chunked decoder, so the parser has to
      // reject it before fetch() runs.
      name: "a Content-Length that aliases the chunked decoder's state bits",
      segments: [
        "GET /first HTTP/1.1\r\nHost: x\r\nContent-Length: 576460752303423488\r\n\r\n",
        "\r\n\r\nGET /smuggled HTTP/1.1\r\nHost: x\r\n\r\n",
      ],
      seen: [],
    },
  ])("answers 400 to $name", async ({ segments, seen }) => {
    expect(await exchange(segments)).toEqual({
      status: "HTTP/1.1 400 Bad Request",
      body: "",
      seen: [...seen],
    });
  });

  test.concurrent("answers 413 to a chunk extension over the 16 KiB per-chunk cap", async () => {
    // Extension bytes don't count toward maxRequestBodySize, so they need their own cap. The body is
    // 2 bytes against a 1 MiB limit, so this 413 can only come from the extension cap.
    const segments = [chunkedRequest() + `2;${Buffer.alloc(20 * 1024, "e").toString()}\r\nhi\r\n0\r\n\r\n`];
    expect(await exchange(segments, { maxRequestBodySize: 1024 * 1024 })).toEqual({
      status: "HTTP/1.1 413 Payload Too Large",
      body: "",
      seen: [{ path: "/", error: BODY_REJECTED }],
    });
  });

  // The header size limit (16 KiB by default) also bounds the trailer section.
  const bigTrailer = Buffer.alloc(17 * 1024, "X-T: " + Buffer.alloc(200, "v").toString() + "\r\n").toString();
  test.concurrent.each([
    { name: "in one read", segments: [chunkedRequest() + "0\r\n" + bigTrailer + "\r\n"] },
    {
      // Each half is under the limit, so the count has to carry over to the second read.
      name: "across two reads",
      segments: [chunkedRequest() + "0\r\n" + bigTrailer.slice(0, 8 * 1024), bigTrailer.slice(8 * 1024) + "\r\n"],
    },
  ])("answers 431 to a trailer section over the header size limit, $name", async ({ segments }) => {
    expect(await exchange(segments)).toEqual({
      status: "HTTP/1.1 431 Request Header Fields Too Large",
      body: "",
      seen: [{ path: "/", error: BODY_REJECTED }],
    });
  });
});

describe.if(isPosix)("HTTP server handles fragmented requests", () => {
  test.concurrent("parses pipelined requests trickling in through a tiny send buffer", async () => {
    // A 1-byte send buffer delivers the requests a few bytes at a time, so over 20 pipelined requests
    // the reads end at offsets all over the request, including right after the request line.
    const connections = 10;
    const requestsPerConnection = 20;
    // Keyed by request path. Each connection uses its own path.
    const seen: Record<string, { method: string; headers: Record<string, string> }[]> = {};
    await using server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        (seen[new URL(req.url).pathname] ??= []).push({
          method: req.method,
          headers: Object.fromEntries(req.headers),
        });
        return new Response("ok");
      },
    });

    const headers = { host: `127.0.0.1:${server.port}`, "user-agent": "Bun-Test", accept: "*/*" };
    function request(connection: number, index: number) {
      return (
        `GET /connection-${connection} HTTP/1.1\r\n` +
        `Host: ${headers.host}\r\nUser-Agent: ${headers["user-agent"]}\r\nAccept: ${headers.accept}\r\n` +
        // The server closes the connection after the last response, so the client knows it has them all.
        (index === requestsPerConnection - 1 ? "Connection: close\r\n" : "") +
        "\r\n"
      );
    }

    async function drive(connection: number): Promise<string[]> {
      const wire = Buffer.from(
        Array.from({ length: requestsPerConnection }, (_, index) => request(connection, index)).join(""),
      );
      let offset = 0;
      function writeUntilFull(socket: Bun.Socket) {
        while (offset < wire.length) {
          const written = socket.write(wire, offset, 1);
          if (written === 0) break; // drain() picks up from here
          offset += written;
          socket.flush();
        }
      }

      let received = "";
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      await Bun.connect({
        hostname: server.hostname!,
        port: server.port!,
        socket: {
          open(socket) {
            setSocketOptions(socket, 1 /* SO_SNDBUF */, 1);
            writeUntilFull(socket);
          },
          drain: writeUntilFull,
          data(_socket, chunk) {
            received += chunk.toString();
          },
          close() {
            resolve(received);
          },
          error(_socket, error) {
            reject(error);
          },
        },
      });
      return (await promise).match(/HTTP\/1\.1 [^\r]*/g) ?? [];
    }

    const statuses = await Promise.all(Array.from({ length: connections }, (_, connection) => drive(connection)));

    const expectedRequests = Array.from({ length: requestsPerConnection }, (_, index) => ({
      method: "GET",
      headers: index === requestsPerConnection - 1 ? { ...headers, connection: "close" } : headers,
    }));
    expect({ statuses, seen }).toEqual({
      statuses: Array.from({ length: connections }, () => Array(requestsPerConnection).fill("HTTP/1.1 200 OK")),
      seen: Object.fromEntries(
        Array.from({ length: connections }, (_, connection) => [`/connection-${connection}`, expectedRequests]),
      ),
    });
  });
});
