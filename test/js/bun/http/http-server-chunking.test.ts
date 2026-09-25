import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { isPosix } from "harness";

/**
 * Lets a test wait until bytes it wrote to one loopback connection have been
 * read by their in-process receiver, without guessing at a delay. Two orderings
 * make it work: loopback delivers in the order things were written, so once a
 * byte pushed through this spare connection has shown up in JS, anything
 * written before it had reached its socket too and was readable in the same
 * poll; and an immediate queued while that poll's batch is being dispatched
 * runs only once the whole batch, the receiver's read included, is done.
 *
 * Neither half works alone. An immediate queued from ordinary JS runs before
 * the loop polls again, and an already-due timer fires in the tick that armed
 * it, so a second write paced by either one lands in the same read as the first.
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
  /** What `req.text()` resolved to. */
  body?: string;
  /** What `req.text()` rejected with, when the parser gave up on the body instead. */
  error?: string;
}

/** What a pending `req.text()` rejects with once the parser has closed the connection. */
const BODY_REJECTED = "AbortError: The connection was closed.";

/**
 * Sends `segments` over one connection to a Bun.serve whose handler echoes the
 * request body, and resolves once the server has closed the connection (every
 * request asks for `Connection: close`, so a successful exchange ends that way
 * too).
 *
 * Each segment reaches the server in its own read: the next one is written only
 * once the server has read the previous one and whatever it wrote back in
 * reaction has reached `received`. Once the server has answered or hung up, the
 * remaining segments stay unsent. They are still worth listing for the
 * rejection cases: a server that wrongly kept the request going gets them and
 * is caught answering 200, while one that rightly rejected it is left alone.
 */
async function exchange(segments: string[], options: { maxRequestBodySize?: number } = {}) {
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
          // By now the parser has answered and closed the connection itself;
          // a 500 showing up in `status` means it did not.
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
    hostname: server.hostname,
    port: server.port,
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
    // First tick: the server has read the segment (and written any reaction).
    // Second tick: that reaction has been read into `received` on this side.
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
    // Guards the premise of every split-segment case below. If the writes
    // coalesced, those cases would still pass, just against unsplit input.
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
      // The parser used to spin when a read ended between the \r and \n of a
      // chunk-size line instead of remembering the \r and resuming.
      name: "a chunk-size CRLF split after the CR",
      segments: [chunkedRequest(), "5\r", "\nHello\r\n0\r\n\r\n"],
      body: "Hello",
    },
    {
      // Same split, resuming out of the chunk-extension state this time.
      name: "a chunk-size CRLF split after the CR of a line with an extension",
      segments: [chunkedRequest(), "5;ext=val\r", "\nHello\r\n0\r\n\r\n"],
      body: "Hello",
    },
    {
      // 80 KiB of extension bytes per message, but the 16 KiB cap is per chunk
      // (llhttp resets its counter on every chunk header), so this goes
      // through. The over-the-cap counterpart is the 413 case further down.
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

  test.concurrent.each([
    {
      // "TestX" arrives with one byte of the chunk terminator still to come, so
      // the X has to be caught by the partial-read path. Had it been let
      // through, the second segment would complete a 200 for "Test".
      name: "a chunk-data terminator whose CR is some other byte",
      segments: [chunkedRequest() + "4\r\nTestX", "\n0\r\n\r\n"],
      seen: [{ path: "/", error: BODY_REJECTED }],
    },
    {
      // A byte <= 0x20 other than \r in chunk-size position must fail on the
      // spot. It used to be left behind in the parser's fallback buffer, where
      // it corrupted the next request on the connection.
      name: "a bare LF in chunk-size position",
      segments: [chunkedRequest() + "\n"],
      seen: [{ path: "/", error: BODY_REJECTED }],
    },
    {
      // RFC 7230 4.1: chunk-size = 1*HEXDIG. An empty chunk-size line used to
      // parse as the last chunk, so whatever followed the bogus terminator was
      // read as a second request. It must never reach the handler.
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
      // The same verdict when the line arrives on its own, with the parser
      // suspended before and after it. A server that took the line for the
      // last chunk would go on to answer the final CRLF with a 200.
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
      // The remaining-body counter doubles as the chunked decoder's state word.
      // A Content-Length of 2^59 would set the decoder's "has hex digit" bit
      // and route a fixed-length body through the chunked decoder, which would
      // then take the bytes after the CRLFs for a second request. It has to be
      // refused at header time, before fetch() runs at all.
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
      seen,
    });
  });

  test.concurrent("answers 413 to a chunk extension over the 16 KiB per-chunk cap", async () => {
    // Extension bytes do not count toward maxRequestBodySize, so without a cap
    // of their own a client could stream them indefinitely on one connection.
    // llhttp caps them at 16 KiB per chunk. The body is 2 bytes against a 1 MiB
    // limit, so this 413 can only be the extension cap.
    const segments = [chunkedRequest() + `2;${Buffer.alloc(20 * 1024, "e").toString()}\r\nhi\r\n0\r\n\r\n`];
    expect(await exchange(segments, { maxRequestBodySize: 1024 * 1024 })).toEqual({
      status: "HTTP/1.1 413 Payload Too Large",
      body: "",
      seen: [{ path: "/", error: BODY_REJECTED }],
    });
  });
});

describe.if(isPosix)("HTTP server handles fragmented requests", () => {
  test.concurrent("parses pipelined requests trickling in through a tiny send buffer", async () => {
    // The parser used to answer 400 when a read ended right after the request
    // line, with the header block still on its way. A 1-byte send buffer gets
    // the requests across in pieces of a few bytes, so over 20 pipelined
    // requests the read boundaries fall at offsets all over the request.
    const connections = 10;
    const requestsPerConnection = 20;
    // Keyed by request path, which names the connection the request came in on.
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
        // The server closes the connection after the last response, which is
        // how the client below knows it has everything.
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
        hostname: server.hostname,
        port: server.port,
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
