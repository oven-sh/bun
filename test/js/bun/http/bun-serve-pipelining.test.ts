import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir, tls } from "harness";
import { once } from "node:events";
import { connect as netConnect } from "node:net";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";

// A request pipelined behind a response that was still in flight (the handler had
// not returned yet, or it had and uWS was still draining a body that did not fit
// in the socket buffer) used to make uWS close the connection the moment it
// parsed the second request head: the in-flight response was truncated and the
// second request never answered. Such a request is now held until the response
// ahead of it completes and is dispatched then, so responses stay in request
// order (RFC 9112 9.3.2); one held behind a Connection: close request is dropped
// with the connection (RFC 9112 9.6), and what is held behind a request that
// turns the connection into a WebSocket goes to that WebSocket, as frames.

type RawResponse = { statusLine: string; headers: Record<string, string>; body: string };

// Splits the byte stream into responses framed by Content-Length or chunked
// encoding (a 101 has no body). Content-Length bodies are accumulated as chunks
// so a multi-megabyte body does not get re-concatenated on every read; the
// chunked bodies here are small and are simply re-scanned.
class ResponseReader {
  responses: RawResponse[] = [];
  // Bytes after the last complete response that do not form a head yet (after
  // a 101 these are WebSocket frames).
  unparsed: Buffer = Buffer.alloc(0);
  // How many of the next responses answer a HEAD request: such a response has
  // the framing headers of the GET response and no body (RFC 9112 6.3).
  headResponses = 0;
  #head: { statusLine: string; headers: Record<string, string> } | undefined;
  #chunked = false;
  #pendingChunked: Buffer = Buffer.alloc(0);
  #bodyChunks: Buffer[] = [];
  #bodyHave = 0;
  #bodyNeed = 0;

  push(chunk: Buffer) {
    while (chunk.length > 0) {
      if (!this.#head) {
        this.unparsed = Buffer.concat([this.unparsed, chunk]);
        const headEnd = this.unparsed.indexOf("\r\n\r\n");
        if (headEnd === -1) return;
        const [statusLine, ...lines] = this.unparsed.subarray(0, headEnd).toString("latin1").split("\r\n");
        const headers: Record<string, string> = {};
        for (const line of lines) {
          const colon = line.indexOf(":");
          headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
        }
        this.#head = { statusLine, headers };
        const hasBody = this.headResponses === 0;
        if (!hasBody) this.headResponses--;
        this.#chunked = hasBody && headers["transfer-encoding"] === "chunked";
        this.#bodyNeed = hasBody ? Number(headers["content-length"] ?? 0) : 0;
        chunk = this.unparsed.subarray(headEnd + 4);
        this.unparsed = Buffer.alloc(0);
      }
      if (this.#chunked) {
        const rest = this.#takeChunkedBody(chunk);
        if (rest === undefined) return;
        chunk = rest;
      } else {
        const take = chunk.subarray(0, this.#bodyNeed - this.#bodyHave);
        this.#bodyChunks.push(take);
        this.#bodyHave += take.length;
        chunk = chunk.subarray(take.length);
        if (this.#bodyHave < this.#bodyNeed) return;
      }
      this.responses.push({ ...this.#head, body: Buffer.concat(this.#bodyChunks).toString("latin1") });
      this.#head = undefined;
      this.#bodyChunks = [];
      this.#bodyHave = 0;
    }
  }

  // Returns what follows the body once all of it has arrived, through the
  // terminating zero-size chunk (nothing here sends trailers); else undefined.
  #takeChunkedBody(chunk: Buffer): Buffer | undefined {
    const pending = (this.#pendingChunked = Buffer.concat([this.#pendingChunked, chunk]));
    const parts: Buffer[] = [];
    let pos = 0;
    while (true) {
      const sizeLineEnd = pending.indexOf("\r\n", pos);
      if (sizeLineEnd === -1) return undefined;
      const size = parseInt(pending.subarray(pos, sizeLineEnd).toString("latin1"), 16);
      pos = sizeLineEnd + 2;
      if (pending.length < pos + size + 2) return undefined;
      if (size === 0) break;
      parts.push(pending.subarray(pos, pos + size));
      pos += size + 2;
    }
    this.#bodyChunks = parts;
    this.#pendingChunked = Buffer.alloc(0);
    return pending.subarray(pos + 2);
  }
}

type Target = ({ port: number; hostname: string } | { unix: string }) & { tls?: { ca: string } };

class RawClient extends ResponseReader {
  closed = false;
  #socket!: Awaited<ReturnType<typeof Bun.connect>>;
  #waiters: { condition: (client: RawClient) => boolean; resolve: () => void; reject: (error: Error) => void }[] = [];

  static async connect(target: Target): Promise<RawClient> {
    const client = new RawClient();
    const handshake = Promise.withResolvers<void>();
    client.#socket = await Bun.connect({
      ...target,
      socket: {
        handshake: (_socket, success, error) => (success ? handshake.resolve() : handshake.reject(error)),
        data: (_socket, chunk) => {
          client.push(chunk);
          client.#settle();
        },
        close: () => {
          client.closed = true;
          client.#settle();
        },
        error: (_socket, error) => client.#fail(error),
        connectError: (_socket, error) => client.#fail(error),
      },
    });
    if (target.tls) await handshake.promise;
    return client;
  }

  write(data: string | Uint8Array) {
    const length = typeof data === "string" ? Buffer.byteLength(data, "latin1") : data.byteLength;
    expect(this.#socket.write(data)).toBe(length);
  }

  // Resolves once `condition` holds, or as soon as the server closes the
  // connection, so that the assertions after it report what actually arrived.
  until(condition: (client: RawClient) => boolean): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.#waiters.push({ condition, resolve, reject });
    this.#settle();
    return promise;
  }

  #settle() {
    this.#waiters = this.#waiters.filter(waiter => {
      if (!this.closed && !waiter.condition(this)) return true;
      waiter.resolve();
      return false;
    });
  }

  #fail(error: Error) {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiters) waiter.reject(error);
  }

  [Symbol.dispose]() {
    this.#socket.end();
  }
}

// The parking/replay code is instantiated once per uWS socket flavor (plain and
// TLS); a unix listener is the transport whose send buffer is smallest.
type Transport = {
  name: "tcp" | "tls" | "unix";
  supported: boolean;
  listen(dir: string): object;
  target(server: Bun.Server<undefined>, dir: string): Target;
  probe(server: Bun.Server<undefined>, dir: string): Promise<Response>;
};
const tcp = { port: 0, hostname: "127.0.0.1" };
const transports: Transport[] = [
  {
    name: "tcp",
    supported: true,
    listen: () => tcp,
    target: server => ({ port: server.port!, hostname: "127.0.0.1" }),
    probe: server => fetch(`${server.url}probe`),
  },
  {
    name: "tls",
    supported: true,
    listen: () => ({ ...tcp, tls }),
    target: server => ({ port: server.port!, hostname: "127.0.0.1", tls: { ca: tls.cert } }),
    probe: server => fetch(`${server.url}probe`, { tls: { ca: tls.cert } }),
  },
  {
    name: "unix",
    supported: isPosix,
    listen: dir => ({ unix: join(dir, "pipeline.sock") }),
    target: (_server, dir) => ({ unix: join(dir, "pipeline.sock") }),
    probe: (_server, dir) => fetch("http://localhost/probe", { unix: join(dir, "pipeline.sock") }),
  },
];
const tcpOnly = transports[0];

const request = (path: string, extraHeaders = "") => `GET ${path} HTTP/1.1\r\nHost: x\r\n${extraHeaders}\r\n`;
const ok = (body: string) => ({ statusLine: "HTTP/1.1 200 OK", body });
const summarize = ({ statusLine, body }: RawResponse) => ({ statusLine, body });

// Every handler below answers any path it does not treat specially with this.
const plainResponse = (req: Request) => new Response(`body of ${new URL(req.url).pathname}`);

// A node:net or node:tls client, for the tests that look at how the stream ends:
// with the server's FIN (`ended`) or with an error such as ECONNRESET. With
// `allowHalfOpen` the client does not answer the server's FIN with its own, so
// a lingering close stays open until the test ends the socket.
async function connectNodeSocket(
  transport: Transport,
  server: Bun.Server<undefined>,
  dir: string,
  options: { allowHalfOpen?: boolean } = {},
) {
  const socket =
    transport.name === "tls"
      ? tlsConnect({ port: server.port!, host: "127.0.0.1", ca: tls.cert, rejectUnauthorized: false, ...options })
      : transport.name === "unix"
        ? netConnect({ path: join(dir, "pipeline.sock"), ...options })
        : netConnect({ port: server.port!, host: "127.0.0.1", ...options });
  const reader = new ResponseReader();
  const seen: { ended: boolean; error?: string } = { ended: false };
  socket.on("data", chunk => reader.push(chunk));
  // `ended` settles on every terminal event, not on 'end' alone: a connection
  // that is reset never ends, and a test awaiting it would reach its timeout
  // instead of failing on what `seen` recorded.
  const terminal = Promise.withResolvers<void>();
  const ended = terminal.promise;
  socket.on("end", () => ((seen.ended = true), terminal.resolve()));
  socket.on("error", (error: NodeJS.ErrnoException) => ((seen.error = error.code), terminal.resolve()));
  const closed = new Promise<void>(resolve => socket.on("close", () => (terminal.resolve(), resolve())));
  await once(socket, transport.name === "tls" ? "secureConnect" : "connect");
  // Resolves once the kernel has the bytes.
  const write = (data: string) => new Promise<void>(resolve => socket.write(data, () => resolve()));
  return { socket, reader, seen, ended, closed, write };
}

// A round trip on a separate connection. Anything the pipelining client wrote
// before this was readable on the server before the probe was even sent, so by
// the time the probe has been answered the server has read it (and, with the
// request ahead of it still pending, parked it). It also moves the test past the
// microtask checkpoint Bun runs inside a dispatch: releasing a handler straight
// from its `entered` promise would complete the response while the parser is
// still inside that request's dispatch, which is the ordinary synchronous
// pipelining path rather than the one under test.
async function probe(transport: Transport, server: Bun.Server<undefined>, dir: string) {
  expect(await (await transport.probe(server, dir)).text()).toBe("body of /probe");
}

// A handler that parks on `/hold*` paths until the test releases that path, and
// records the order in which requests reached JS.
function holdingHandler() {
  type Gate = ReturnType<typeof Promise.withResolvers<void>>;
  const hits: string[] = [];
  const entered = new Map<string, Gate>();
  const released = new Map<string, Gate>();
  const gate = (map: Map<string, Gate>, path: string) => {
    let resolvers = map.get(path);
    if (!resolvers) map.set(path, (resolvers = Promise.withResolvers<void>()));
    return resolvers;
  };
  return {
    hits,
    entered: (path: string) => gate(entered, path).promise,
    release: (path: string) => gate(released, path).resolve(),
    async fetch(req: Request) {
      const path = new URL(req.url).pathname;
      hits.push(path);
      if (path.startsWith("/hold")) {
        gate(entered, path).resolve();
        await gate(released, path).promise;
      }
      return plainResponse(req);
    },
  };
}

// Large enough that the first tryEnd() cannot hand the whole body to the kernel
// on any transport (loopback TCP takes at most a few MiB, a unix socket a couple
// hundred KiB), so the rest of the body is still being drained through
// onWritable when the second request head is parsed.
const BIG_BODY_LENGTH = 16 * 1024 * 1024;

const big = Buffer.alloc(BIG_BODY_LENGTH, "x").toString("latin1");

// The ways a big response body reaches the socket. The handler is synchronous
// in each case, so the response is complete as far as the app is concerned when
// the second head is parsed; what is still outstanding is the body transfer:
// uWS draining a buffered body's tail through onWritable, or the runtime's file
// pump (sendfile over plain TCP on Linux, read+write chunks elsewhere) for a
// Bun.file() returned from the handler or served by a file route.
type BigBody = {
  name: string;
  // How /big is served (`dir` holds big.txt). `hits` records every request
  // that reaches the fetch handler; a route answers /big without it.
  serve(dir: string, hits: string[]): { fetch(req: Request): Response; routes?: Record<string, Response> };
  expectedHits: string[];
};
const recordingHandler = (hits: string[], bigResponse?: () => Response) => (req: Request) => {
  const path = new URL(req.url).pathname;
  hits.push(path);
  return path === "/big" && bigResponse ? bigResponse() : plainResponse(req);
};
const bigBodies: BigBody[] = [
  {
    name: "a buffered body",
    serve: (_dir, hits) => ({ fetch: recordingHandler(hits, () => new Response(big)) }),
    expectedHits: ["/big", "/small"],
  },
  {
    name: "a Bun.file() body returned from the handler",
    serve: (dir, hits) => ({ fetch: recordingHandler(hits, () => new Response(Bun.file(join(dir, "big.txt")))) }),
    expectedHits: ["/big", "/small"],
  },
  {
    name: "a Bun.file() route",
    serve: (dir, hits) => ({
      routes: { "/big": new Response(Bun.file(join(dir, "big.txt"))) },
      fetch: recordingHandler(hits),
    }),
    expectedHits: ["/small"],
  },
];

describe.each(transports)("$name", transport => {
  describe.each(bigBodies)("$name", bigBody => {
    it.if(transport.supported)(
      "larger than the socket buffer is delivered whole to a client that pipelined a request behind it, which is then answered",
      async () => {
        using dir = tempDir("serve-pipelining", { "big.txt": big });
        const hits: string[] = [];
        using server = Bun.serve({ ...transport.listen(String(dir)), ...bigBody.serve(String(dir), hits) });
        using client = await RawClient.connect(transport.target(server, String(dir)));

        client.write(request("/big") + request("/small"));
        await client.until(c => c.responses.length === 2);

        expect({
          hits,
          closed: client.closed,
          responses: client.responses.map(({ statusLine, headers, body }) => ({
            statusLine,
            contentLength: headers["content-length"],
            bodyLength: body.length,
            bodyIsIntact: body === big || body === "body of /small",
          })),
        }).toEqual({
          hits: bigBody.expectedHits,
          closed: false,
          responses: [
            {
              statusLine: "HTTP/1.1 200 OK",
              contentLength: String(BIG_BODY_LENGTH),
              bodyLength: BIG_BODY_LENGTH,
              bodyIsIntact: true,
            },
            { statusLine: "HTTP/1.1 200 OK", contentLength: "14", bodyLength: 14, bodyIsIntact: true },
          ],
        });
      },
    );
  });

  it.if(transport.supported)(
    "requests pipelined behind an async handler are dispatched one at a time, each after the response ahead of it",
    async () => {
      using dir = tempDir("serve-pipelining", {});
      const handler = holdingHandler();
      using server = Bun.serve({ ...transport.listen(String(dir)), fetch: handler.fetch });
      using client = await RawClient.connect(transport.target(server, String(dir)));
      // (Or the server giving up on the connection, which is the failure mode.)
      const enteredOrClosed = (path: string) => Promise.race([handler.entered(path), client.until(c => c.closed)]);

      // All three heads arrive in one read.
      client.write(request("/hold/1") + request("/hold/2") + request("/hold/3"));
      await enteredOrClosed("/hold/1");
      await probe(transport, server, String(dir));
      expect(handler.hits).toEqual(["/hold/1", "/probe"]);

      // Completing a response dispatches exactly the next request, which parks
      // the one behind it again.
      handler.release("/hold/1");
      await enteredOrClosed("/hold/2");
      await probe(transport, server, String(dir));
      expect(handler.hits).toEqual(["/hold/1", "/probe", "/hold/2", "/probe"]);
      await client.until(c => c.responses.length === 1);

      handler.release("/hold/2");
      await enteredOrClosed("/hold/3");
      expect(handler.hits).toEqual(["/hold/1", "/probe", "/hold/2", "/probe", "/hold/3"]);

      handler.release("/hold/3");
      await client.until(c => c.responses.length === 3);
      expect({ closed: client.closed, responses: client.responses.map(summarize) }).toEqual({
        closed: false,
        responses: [ok("body of /hold/1"), ok("body of /hold/2"), ok("body of /hold/3")],
      });
    },
  );

  // The response ahead is still being produced by the app: a streaming body that
  // ends when the test says so. Ending it makes the response sink resume() the
  // socket itself (it releases a request-body pause), which must not reopen reads
  // over the held request; the replay that follows is what reopens them.
  it.if(transport.supported)(
    "a request pipelined behind a streaming response is answered once the stream ends",
    async () => {
      using dir = tempDir("serve-pipelining", {});
      const hits: string[] = [];
      const streaming = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<void>();
      using server = Bun.serve({
        ...transport.listen(String(dir)),
        fetch(req) {
          const path = new URL(req.url).pathname;
          hits.push(path);
          if (path !== "/stream") return plainResponse(req);
          let pulls = 0;
          return new Response(
            new ReadableStream({
              async pull(controller) {
                if (pulls++ === 0) {
                  controller.enqueue("first,");
                  streaming.resolve();
                  return;
                }
                await finish.promise;
                controller.enqueue("second");
                controller.close();
              },
            }),
          );
        },
      });
      using client = await RawClient.connect(transport.target(server, String(dir)));

      client.write(request("/stream") + request("/after"));
      await Promise.race([streaming.promise, client.until(c => c.closed)]);
      await probe(transport, server, String(dir));
      expect({ hits, closed: client.closed }).toEqual({ hits: ["/stream", "/probe"], closed: false });

      finish.resolve();
      await client.until(c => c.responses.length === 2);
      expect({
        hits,
        closed: client.closed,
        responses: client.responses.map(({ statusLine, headers, body }) => ({
          statusLine,
          framing: headers["transfer-encoding"] ?? `content-length ${headers["content-length"]}`,
          body,
        })),
      }).toEqual({
        hits: ["/stream", "/probe", "/after"],
        closed: false,
        responses: [
          { statusLine: "HTTP/1.1 200 OK", framing: "chunked", body: "first,second" },
          { statusLine: "HTTP/1.1 200 OK", framing: "content-length 14", body: "body of /after" },
        ],
      });
    },
  );

  // The client ends its side right behind the requests and reads on. Over TLS its
  // close_notify is decrypted in the same read as the requests, so the server sees
  // the end of the stream while /small is held and /big is still draining. The
  // requests came before the end, so both are answered before the server closes.
  it.if(transport.supported)(
    "a request held behind a draining response is answered for a client that has already ended its side",
    async () => {
      using dir = tempDir("serve-pipelining", {});
      const hits: string[] = [];
      using server = Bun.serve({
        ...transport.listen(String(dir)),
        fetch: recordingHandler(hits, () => new Response(big)),
      });
      const client = await connectNodeSocket(transport, server, String(dir));

      client.socket.end(request("/big") + request("/small"));
      await client.closed;

      expect({
        hits,
        responses: client.reader.responses.map(({ statusLine, body }) => ({
          statusLine,
          bodyLength: body.length,
          bodyIsIntact: body === big || body === "body of /small",
        })),
      }).toEqual({
        hits: ["/big", "/small"],
        responses: [
          { statusLine: "HTTP/1.1 200 OK", bodyLength: BIG_BODY_LENGTH, bodyIsIntact: true },
          { statusLine: "HTTP/1.1 200 OK", bodyLength: 14, bodyIsIntact: true },
        ],
      });
    },
  );

  // Reads are paused while a request is held, so what the client writes after that
  // stays unread. A close over unread bytes resets the connection, and the kernel
  // then drops the part of the response that it has not sent yet. The two tests
  // below close a connection in that state: the server has to read those bytes
  // first. In the first test the first /never is the request that is held, and the
  // second one is what stays unread.
  it.if(transport.supported)(
    "a response that closes the connection arrives whole when the client wrote more while it was pending",
    async () => {
      using dir = tempDir("serve-pipelining", {});
      const handler = holdingHandler();
      using server = Bun.serve({
        ...transport.listen(String(dir)),
        async fetch(req) {
          const response = await handler.fetch(req);
          return new URL(req.url).pathname === "/hold"
            ? new Response(big, { headers: { Connection: "close" } })
            : response;
        },
      });
      const client = await connectNodeSocket(transport, server, String(dir));

      await client.write(request("/hold"));
      await handler.entered("/hold");
      for (let i = 0; i < 2; i++) {
        await client.write(request("/never"));
        await probe(transport, server, String(dir));
      }

      handler.release("/hold");
      await client.closed;
      expect({
        hits: handler.hits,
        seen: client.seen,
        responses: client.reader.responses.map(({ body }) => ({ bodyLength: body.length, bodyIsIntact: body === big })),
      }).toEqual({
        hits: ["/hold", "/probe", "/probe"],
        seen: { ended: true },
        responses: [{ bodyLength: BIG_BODY_LENGTH, bodyIsIntact: true }],
      });
    },
  );

  it.if(transport.supported)(
    "a held Connection: close request is answered and the connection ends cleanly when the client wrote more meanwhile",
    async () => {
      using dir = tempDir("serve-pipelining", {});
      const handler = holdingHandler();
      using server = Bun.serve({ ...transport.listen(String(dir)), fetch: handler.fetch });
      const client = await connectNodeSocket(transport, server, String(dir));

      await client.write(request("/hold") + request("/closing", "Connection: close\r\n"));
      await handler.entered("/hold");
      for (let i = 0; i < 2; i++) {
        await client.write(request("/never"));
        await probe(transport, server, String(dir));
      }

      handler.release("/hold");
      await client.closed;
      expect({
        hits: handler.hits,
        seen: client.seen,
        responses: client.reader.responses.map(summarize),
      }).toEqual({
        hits: ["/hold", "/probe", "/probe", "/closing"],
        seen: { ended: true },
        responses: [ok("body of /hold"), ok("body of /closing")],
      });
    },
  );
});

it("a request arriving in a later read while the handler is still running waits for the response", async () => {
  const handler = holdingHandler();
  using server = Bun.serve({ ...tcp, fetch: handler.fetch });
  using client = await RawClient.connect(tcpOnly.target(server, ""));

  client.write(request("/hold"));
  await handler.entered("/hold");
  client.write(request("/after"));
  await probe(tcpOnly, server, "");
  expect(handler.hits).toEqual(["/hold", "/probe"]);

  handler.release("/hold");
  await client.until(c => c.responses.length === 2);
  expect({ hits: handler.hits, closed: client.closed, responses: client.responses.map(summarize) }).toEqual({
    hits: ["/hold", "/probe", "/after"],
    closed: false,
    responses: [ok("body of /hold"), ok("body of /after")],
  });
});

it("a request pipelined behind a request body that the handler is still consuming waits for the response", async () => {
  const seen: string[] = [];
  const bodyRead = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  using server = Bun.serve({
    ...tcp,
    async fetch(req) {
      if (new URL(req.url).pathname !== "/upload") return plainResponse(req);
      seen.push(await req.text());
      bodyRead.resolve();
      await release.promise;
      return new Response(`uploaded ${seen[0]}`);
    },
  });
  using client = await RawClient.connect(tcpOnly.target(server, ""));

  client.write("POST /upload HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\n");
  // The body and the next request share a read: the body belongs to the upload
  // and must reach its handler, the request behind it must wait.
  client.write("hello" + request("/after"));
  await Promise.race([bodyRead.promise, client.until(c => c.closed)]);
  await probe(tcpOnly, server, "");
  expect({ seen, closed: client.closed }).toEqual({ seen: ["hello"], closed: false });

  release.resolve();
  await client.until(c => c.responses.length === 2);
  expect({ closed: client.closed, responses: client.responses.map(summarize) }).toEqual({
    closed: false,
    responses: [ok("uploaded hello"), ok("body of /after")],
  });
});

// Other ways the response ahead is produced. Each ends through its own path in
// the server, and each has to release the held request like a plain 200 does.
it("a request pipelined behind a handler that throws after an await is answered after the 500", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const hits: string[] = [];
  using server = Bun.serve({
    ...tcp,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      hits.push(path);
      if (path !== "/throw") return plainResponse(req);
      entered.resolve();
      await release.promise;
      throw new Error("boom");
    },
    error: error => new Response(`handled ${error.message}`, { status: 500 }),
  });
  using client = await RawClient.connect(tcpOnly.target(server, ""));

  client.write(request("/throw") + request("/after"));
  await Promise.race([entered.promise, client.until(c => c.closed)]);
  await probe(tcpOnly, server, "");
  expect({ hits, closed: client.closed }).toEqual({ hits: ["/throw", "/probe"], closed: false });

  release.resolve();
  await client.until(c => c.responses.length === 2);
  expect({ hits, closed: client.closed, responses: client.responses.map(summarize) }).toEqual({
    hits: ["/throw", "/probe", "/after"],
    closed: false,
    responses: [{ statusLine: "HTTP/1.1 500 Internal Server Error", body: "handled boom" }, ok("body of /after")],
  });
});

it("a request pipelined behind a HEAD request waits for its response", async () => {
  const handler = holdingHandler();
  using server = Bun.serve({ ...tcp, fetch: handler.fetch });
  using client = await RawClient.connect(tcpOnly.target(server, ""));

  client.headResponses = 1;
  client.write("HEAD /hold HTTP/1.1\r\nHost: x\r\n\r\n" + request("/after"));
  await Promise.race([handler.entered("/hold"), client.until(c => c.closed)]);
  await probe(tcpOnly, server, "");
  expect({ hits: handler.hits, closed: client.closed }).toEqual({ hits: ["/hold", "/probe"], closed: false });

  handler.release("/hold");
  await client.until(c => c.responses.length === 2);
  expect({
    hits: handler.hits,
    closed: client.closed,
    responses: client.responses.map(({ statusLine, headers, body }) => ({
      statusLine,
      contentLength: headers["content-length"],
      body,
    })),
  }).toEqual({
    hits: ["/hold", "/probe", "/after"],
    closed: false,
    responses: [
      { statusLine: "HTTP/1.1 200 OK", contentLength: "13", body: "" },
      { statusLine: "HTTP/1.1 200 OK", contentLength: "14", body: "body of /after" },
    ],
  });
});

// The server answers the Expect header with 100 Continue when it dispatches the
// request, so an interim response is already on the wire when the request behind
// it is held.
describe.each([
  { name: "whose body is in the same write", bodyWaitsFor100: false },
  { name: "whose body follows the 100 Continue", bodyWaitsFor100: true },
])("a request pipelined behind a request with Expect: 100-continue $name", ({ bodyWaitsFor100 }) => {
  it("waits for the final response", async () => {
    const seen: string[] = [];
    const bodyRead = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    using server = Bun.serve({
      ...tcp,
      async fetch(req) {
        if (new URL(req.url).pathname !== "/upload") return plainResponse(req);
        seen.push(await req.text());
        bodyRead.resolve();
        await release.promise;
        return new Response(`uploaded ${seen[0]}`);
      },
    });
    using client = await RawClient.connect(tcpOnly.target(server, ""));

    const head = "POST /upload HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 5\r\n\r\n";
    if (bodyWaitsFor100) {
      client.write(head);
      await client.until(c => c.responses.length === 1);
      client.write("hello" + request("/after"));
    } else {
      client.write(head + "hello" + request("/after"));
    }
    await Promise.race([bodyRead.promise, client.until(c => c.closed)]);
    await probe(tcpOnly, server, "");
    expect({ seen, closed: client.closed }).toEqual({ seen: ["hello"], closed: false });

    release.resolve();
    await client.until(c => c.responses.length === 3);
    expect({ closed: client.closed, responses: client.responses.map(summarize) }).toEqual({
      closed: false,
      responses: [{ statusLine: "HTTP/1.1 100 Continue", body: "" }, ok("uploaded hello"), ok("body of /after")],
    });
  });
});

// The parser reports the end of a request message to the server, and that is
// where the server decides to hold what follows. It reports no end for a head
// that declares Content-Length: 0 and was completed from the parser's buffer for
// a head split across reads, so the decision must not depend on that report.
it("a request pipelined behind a split head with Content-Length: 0 waits for the response", async () => {
  const handler = holdingHandler();
  using server = Bun.serve({ ...tcp, fetch: handler.fetch });
  using client = await RawClient.connect(tcpOnly.target(server, ""));

  client.write("POST /hold HTTP/1.1\r\nHost: x\r\nContent-Le");
  // The server has read the first part of the head once this is answered.
  await probe(tcpOnly, server, "");
  client.write("ngth: 0\r\n\r\n" + request("/after"));
  await Promise.race([handler.entered("/hold"), client.until(c => c.closed)]);
  await probe(tcpOnly, server, "");
  expect({ hits: handler.hits, closed: client.closed }).toEqual({ hits: ["/probe", "/hold", "/probe"], closed: false });

  handler.release("/hold");
  await client.until(c => c.responses.length === 2);
  expect({ hits: handler.hits, closed: client.closed, responses: client.responses.map(summarize) }).toEqual({
    hits: ["/probe", "/hold", "/probe", "/after"],
    closed: false,
    responses: [ok("body of /hold"), ok("body of /after")],
  });
});

// The held bytes are re-parsed from the top when they are released: a request
// with a body gets its body back, and whatever is behind it is held again while
// that request's own response is pending (here until a Connection: close request
// ends the connection after its response).
it("a held request with a body is dispatched with its body, and the request behind it waits for that response in turn", async () => {
  const handler = holdingHandler();
  const uploads: string[] = [];
  using server = Bun.serve({
    ...tcp,
    async fetch(req) {
      if (new URL(req.url).pathname !== "/upload") return handler.fetch(req);
      handler.hits.push("/upload");
      uploads.push(await req.text());
      return new Response(`uploaded ${uploads.at(-1)}`);
    },
  });
  using client = await RawClient.connect(tcpOnly.target(server, ""));

  client.write(
    request("/hold") +
      "POST /upload HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello" +
      request("/last", "Connection: close\r\n"),
  );
  await Promise.race([handler.entered("/hold"), client.until(c => c.closed)]);
  await probe(tcpOnly, server, "");
  expect({ hits: handler.hits, closed: client.closed }).toEqual({ hits: ["/hold", "/probe"], closed: false });

  handler.release("/hold");
  await client.until(c => c.closed);
  expect({ hits: handler.hits, uploads, responses: client.responses.map(summarize) }).toEqual({
    hits: ["/hold", "/probe", "/upload", "/last"],
    uploads: ["hello"],
    responses: [ok("body of /hold"), ok("uploaded hello"), ok("body of /last")],
  });
});

it("held bytes that are not a valid request get the error response after the response ahead of them, not instead of it", async () => {
  const handler = holdingHandler();
  using server = Bun.serve({ ...tcp, fetch: handler.fetch });
  using client = await RawClient.connect(tcpOnly.target(server, ""));

  client.write(request("/hold") + "GET /bad HTTP/9.9\r\nHost: x\r\n\r\n");
  await Promise.race([handler.entered("/hold"), client.until(c => c.closed)]);
  await probe(tcpOnly, server, "");
  expect({ hits: handler.hits, closed: client.closed }).toEqual({ hits: ["/hold", "/probe"], closed: false });

  handler.release("/hold");
  await client.until(c => c.closed);
  expect({ hits: handler.hits, responses: client.responses.map(summarize) }).toEqual({
    hits: ["/hold", "/probe"],
    responses: [ok("body of /hold"), { statusLine: "HTTP/1.1 505 HTTP Version Not Supported", body: "" }],
  });
});

describe("a request pipelined behind a Connection: close request", () => {
  // (An HTTP/1.0 request line marks the connection the same way.)
  const closingThenAnother = request("/hold", "Connection: close\r\n") + request("/never");

  it("is dropped when the response ahead of it completes later", async () => {
    const handler = holdingHandler();
    using server = Bun.serve({ ...tcp, fetch: handler.fetch });
    using client = await RawClient.connect(tcpOnly.target(server, ""));

    client.write(closingThenAnother);
    await Promise.race([handler.entered("/hold"), client.until(c => c.closed)]);
    await probe(tcpOnly, server, "");
    expect({ hits: handler.hits, closed: client.closed }).toEqual({ hits: ["/hold", "/probe"], closed: false });

    handler.release("/hold");
    await client.until(c => c.closed);
    expect({ hits: handler.hits, responses: client.responses.map(summarize) }).toEqual({
      hits: ["/hold", "/probe"],
      responses: [ok("body of /hold")],
    });
  });

  it("is dropped when the response ahead of it completes synchronously", async () => {
    const hits: string[] = [];
    using server = Bun.serve({
      ...tcp,
      fetch(req) {
        hits.push(new URL(req.url).pathname);
        return plainResponse(req);
      },
    });
    using client = await RawClient.connect(tcpOnly.target(server, ""));

    client.write(closingThenAnother);
    // Answering /never would keep the connection open, so also stop on its response.
    await client.until(c => c.closed || c.responses.length === 2);
    expect({ hits, closed: client.closed, responses: client.responses.map(summarize) }).toEqual({
      hits: ["/hold"],
      closed: true,
      responses: [ok("body of /hold")],
    });
  });

  // The server drops what arrives behind the closing request, and it has to keep
  // reading to drop it. A close over bytes that were left unread resets the
  // connection, and a unix socket reports that to the client behind the complete
  // response.
  it.if(isPosix)("is read and dropped while the response is pending, so the connection ends cleanly", async () => {
    using dir = tempDir("serve-pipelining", {});
    const unix = transports.find(transport => transport.name === "unix")!;
    const handler = holdingHandler();
    using server = Bun.serve({ ...unix.listen(String(dir)), fetch: handler.fetch });
    const client = await connectNodeSocket(unix, server, String(dir));

    await client.write(request("/hold", "Connection: close\r\n"));
    await handler.entered("/hold");
    // Two later reads. The server has taken each one when its probe is answered.
    for (let i = 0; i < 2; i++) {
      await client.write(request("/never"));
      await probe(unix, server, String(dir));
    }

    handler.release("/hold");
    await client.closed;
    expect({ hits: handler.hits, seen: client.seen, responses: client.reader.responses.map(summarize) }).toEqual({
      hits: ["/hold", "/probe", "/probe"],
      seen: { ended: true },
      responses: [ok("body of /hold")],
    });
  });
});

// A response without a body completes while its socket is still corked, and its
// close then runs from HttpResponse::cork(), not from the gates the tests above
// go through. The client wrote more while a request was held, so the server has
// to read that before it closes. On a unix socket the reset shows as an error
// behind the response. A response this small is out before a TCP reset can cut it.
it.if(isPosix)(
  "a HEAD response that closes the connection ends it cleanly when the client wrote more while it was pending",
  async () => {
    using dir = tempDir("serve-pipelining", {});
    const unix = transports.find(transport => transport.name === "unix")!;
    const handler = holdingHandler();
    using server = Bun.serve({
      ...unix.listen(String(dir)),
      async fetch(req) {
        const response = await handler.fetch(req);
        if (new URL(req.url).pathname === "/hold") response.headers.set("Connection", "close");
        return response;
      },
    });
    const client = await connectNodeSocket(unix, server, String(dir));
    client.reader.headResponses = 1;

    await client.write("HEAD /hold HTTP/1.1\r\nHost: x\r\n\r\n");
    await handler.entered("/hold");
    // The first /never is held, the second one stays unread.
    for (let i = 0; i < 2; i++) {
      await client.write(request("/never"));
      await probe(unix, server, String(dir));
    }

    handler.release("/hold");
    await client.closed;
    expect({
      hits: handler.hits,
      seen: client.seen,
      responses: client.reader.responses.map(({ statusLine, headers, body }) => ({
        statusLine,
        connection: headers["connection"],
        body,
      })),
    }).toEqual({
      hits: ["/hold", "/probe", "/probe"],
      seen: { ended: true },
      responses: [{ statusLine: "HTTP/1.1 200 OK", connection: "close", body: "" }],
    });
  },
);

// More behind the parked requests than the server's receive buffer takes: the rest
// waits in the client's kernel and arrives when the server reads. A close right
// after one read is ahead of those bytes, and they reset the connection while
// the end of the big response is still unsent. So the close lingers: the server
// sends its FIN, drops what still comes, and closes on the client's FIN. The
// server runs in its own process, because a client on the server's event loop
// cannot write while the server closes.
it("a close lingers while the client still sends what it queued behind the parked requests", async () => {
  const serverSource = `
    const big = Buffer.alloc(${BIG_BODY_LENGTH}, "x");
    const gates = new Map();
    const gate = name => gates.get(name) ?? gates.set(name, Promise.withResolvers()).get(name);
    const hits = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const { pathname, searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        if (pathname === "/hits") return Response.json(hits);
        if (pathname === "/entered") return gate("entered" + id).promise.then(() => new Response("entered"));
        if (pathname === "/release") return gate("release" + id).resolve(), new Response("released");
        hits.push(pathname);
        if (pathname !== "/slow") return new Response("body of " + pathname);
        gate("entered" + id).resolve();
        await gate("release" + id).promise;
        return new Response(big);
      },
    });
    console.log(server.port);
  `;
  await using server = Bun.spawn({
    cmd: [bunExe(), "-e", serverSource],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const stdout = server.stdout.getReader();
  const port = parseInt(new TextDecoder().decode((await stdout.read()).value));
  const origin = `http://127.0.0.1:${port}`;
  const upload = Buffer.alloc(4 * 1024 * 1024, "a");

  const results = [];
  for (let id = 0; id < 3; id++) {
    const socket = netConnect({ port, host: "127.0.0.1" });
    const reader = new ResponseReader();
    const seen: { ended: boolean; error?: string } = { ended: false };
    socket.on("data", chunk => reader.push(chunk));
    socket.on("end", () => (seen.ended = true));
    socket.on("error", (error: NodeJS.ErrnoException) => (seen.error = error.code));
    const closed = new Promise<void>(resolve => socket.on("close", () => resolve()));
    await once(socket, "connect");

    socket.write(request(`/slow?id=${id}`) + request("/held", "Connection: close\r\n"));
    expect(await (await fetch(`${origin}/entered?id=${id}`)).text()).toBe("entered");
    // Not awaited: the server does not read while /held is parked, so this write
    // completes only once the close lingers.
    socket.write(`POST /upload HTTP/1.1\r\nHost: x\r\nContent-Length: ${upload.length}\r\n\r\n`);
    socket.write(upload);
    expect(await (await fetch(`${origin}/release?id=${id}`)).text()).toBe("released");
    await closed;
    results.push({
      seen,
      responses: reader.responses.map(({ statusLine, body }) => ({ statusLine, bodyLength: body.length })),
    });
  }

  expect(results).toEqual(
    Array.from({ length: 3 }, () => ({
      seen: { ended: true },
      responses: [
        { statusLine: "HTTP/1.1 200 OK", bodyLength: BIG_BODY_LENGTH },
        { statusLine: "HTTP/1.1 200 OK", bodyLength: 13 },
      ],
    })),
  );
  expect(await (await fetch(`${origin}/hits`)).json()).toEqual(
    Array.from({ length: 3 }, () => ["/slow", "/held"]).flat(),
  );
});

// A request body that fails to parse closes the connection behind a 400. The
// request came out of the park here, so its handler is still running and the
// client wrote more meanwhile. That close must not linger: a lingering close
// keeps the socket open, and the handler does not see the abort until it ends.
// The client keeps its side open, so only the server can end the connection.
it("a held request whose body fails to parse is aborted at once when the client wrote more meanwhile", async () => {
  const handler = holdingHandler();
  const aborted: string[] = [];
  using server = Bun.serve({
    ...tcp,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/aborted") return Response.json(aborted);
      req.signal.addEventListener("abort", () => aborted.push(path));
      return handler.fetch(req);
    },
  });
  const client = await connectNodeSocket(tcpOnly, server, "", { allowHalfOpen: true });

  await client.write(request("/hold"));
  await handler.entered("/hold");
  // Held behind /hold. "Z" is not a chunk size.
  await client.write("POST /hold-body HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\nZ\r\n");
  await probe(tcpOnly, server, "");
  // Stays unread: the server does not read while a request is held.
  await client.write(request("/never"));
  await probe(tcpOnly, server, "");

  handler.release("/hold");
  // The server's FIN, or the close when a reset gets ahead of it.
  await Promise.race([client.ended, client.closed]);
  expect({
    aborted: await (await fetch(`${server.url}aborted`)).json(),
    hits: handler.hits,
  }).toEqual({
    aborted: ["/hold-body"],
    hits: ["/hold", "/probe", "/probe", "/hold-body"],
  });
  handler.release("/hold-body");
  client.socket.destroy();
});

// closeIdleConnections() and a graceful stop() close the connections that are
// idle. A lingering close is not idle: it stays open so that the close does not
// land on what the client still sends. The request that closes the connection
// comes out of the park here, the case where the connection counted as idle. A
// sweep that closes the socket makes the client's next write fail.
it.if(isPosix)("closeIdleConnections() leaves a lingering close to end by itself", async () => {
  using dir = tempDir("serve-pipelining", {});
  const unix = transports.find(transport => transport.name === "unix")!;
  const socketPath = join(String(dir), "pipeline.sock");
  const handler = holdingHandler();
  using server = Bun.serve({
    ...unix.listen(String(dir)),
    fetch(req, server) {
      if (new URL(req.url).pathname !== "/sweep") return handler.fetch(req);
      server.closeIdleConnections();
      return new Response("swept");
    },
  });
  const client = await connectNodeSocket(unix, server, String(dir), { allowHalfOpen: true });

  await client.write(request("/hold"));
  await handler.entered("/hold");
  // /closing is held. /never stays unread, so the close behind /closing lingers.
  await client.write(request("/closing", "Connection: close\r\n"));
  await probe(unix, server, String(dir));
  await client.write(request("/never"));

  handler.release("/hold");
  await client.ended;
  expect(await (await fetch("http://localhost/sweep", { unix: socketPath })).text()).toBe("swept");
  // The server still reads, and it closes on the client's FIN.
  await client.write(request("/late"));
  client.socket.end();
  await client.closed;
  expect({ hits: handler.hits, seen: client.seen, responses: client.reader.responses.map(summarize) }).toEqual({
    hits: ["/hold", "/probe", "/closing"],
    seen: { ended: true },
    responses: [ok("body of /hold"), ok("body of /closing")],
  });
});

// A graceful stop() closes idle connections and marks busy ones to close once
// their work is done. A request that was received and held behind the response
// in flight is part of that work: it is answered, and the connection closes after
// it rather than over it.
it("a held request is still answered when the server is stopped gracefully while the response ahead of it is pending, then the connection closes", async () => {
  const handler = holdingHandler();
  using server = Bun.serve({ ...tcp, fetch: handler.fetch });
  using client = await RawClient.connect(tcpOnly.target(server, ""));

  client.write(request("/hold") + request("/after"));
  await Promise.race([handler.entered("/hold"), client.until(c => c.closed)]);
  await probe(tcpOnly, server, "");
  expect({ hits: handler.hits, closed: client.closed }).toEqual({ hits: ["/hold", "/probe"], closed: false });

  const stopped = server.stop();
  handler.release("/hold");
  await client.until(c => c.closed);
  await stopped;
  expect({ hits: handler.hits, responses: client.responses.map(summarize) }).toEqual({
    hits: ["/hold", "/probe", "/after"],
    responses: [ok("body of /hold"), ok("body of /after")],
  });
});

// upgrade() is instantiated once per socket flavor, like the parking code; the
// unix transport shares the plain instantiation.
describe.each(transports.filter(t => t.name !== "unix"))("WebSocket upgrade over $name", transport => {
  const upgradeRequest = request(
    "/ws",
    "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n",
  );
  // RFC 6455 1.3: the accept value for the sample nonce above.
  const switching = {
    statusLine: "HTTP/1.1 101 Switching Protocols",
    body: "",
    accept: "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
  };
  const withAccept = ({ statusLine, headers, body }: RawResponse) => ({
    statusLine,
    body,
    accept: headers["sec-websocket-accept"] as string | undefined,
  });
  // A masked text frame with a short payload (mask key 1 2 3 4); the server
  // echoes it unmasked.
  const maskedFrame = (payload: string) =>
    new Uint8Array([
      0x81,
      0x80 | payload.length,
      1,
      2,
      3,
      4,
      ...Buffer.from(payload).map((byte, i) => byte ^ ((i % 4) + 1)),
    ]);
  const echoedFrame = (payload: string) => [0x81, payload.length, ...Buffer.from(payload)];

  // /ws is upgraded from the handler itself, or (held: true) from a continuation
  // the test releases; every other path is the holding handler's.
  function serveWithUpgrade(handler: ReturnType<typeof holdingHandler>, { held }: { held: boolean }) {
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const server = Bun.serve({
      ...transport.listen(""),
      fetch(req, server) {
        if (new URL(req.url).pathname !== "/ws") return handler.fetch(req);
        handler.hits.push("/ws");
        const upgrade = () => (server.upgrade(req) ? undefined : new Response("not upgraded", { status: 400 }));
        if (!held) return upgrade();
        entered.resolve();
        return released.promise.then(upgrade);
      },
      websocket: {
        message(ws, message) {
          ws.send(message);
        },
      },
    });
    return { server, upgradeEntered: entered.promise, releaseUpgrade: released.resolve };
  }

  // Waits for the echo of the last payload, then expects everything after the
  // 101 to be the echoes of `payloads`, in order.
  async function expectEchoes(client: RawClient, payloads: string[]) {
    const last = Buffer.from(echoedFrame(payloads.at(-1)!));
    await client.until(c => c.unparsed.subarray(-last.length).equals(last));
    expect({ closed: client.closed, frames: [...client.unparsed] }).toEqual({
      closed: false,
      frames: payloads.flatMap(echoedFrame),
    });
  }

  it("pipelined behind an async handler is performed once the response ahead of it is out", async () => {
    const handler = holdingHandler();
    using server = serveWithUpgrade(handler, { held: false }).server;
    using client = await RawClient.connect(transport.target(server, ""));

    client.write(request("/hold") + upgradeRequest);
    await Promise.race([handler.entered("/hold"), client.until(c => c.closed)]);
    await probe(transport, server, "");
    expect({ hits: handler.hits, closed: client.closed }).toEqual({ hits: ["/hold", "/probe"], closed: false });

    handler.release("/hold");
    await client.until(c => c.responses.length === 2);
    expect({ hits: handler.hits, closed: client.closed, responses: client.responses.map(withAccept) }).toEqual({
      hits: ["/hold", "/probe", "/ws"],
      closed: false,
      responses: [{ statusLine: "HTTP/1.1 200 OK", body: "body of /hold", accept: undefined }, switching],
    });

    // The connection is the WebSocket now.
    client.write(maskedFrame("hi"));
    await expectEchoes(client, ["hi"]);
  });

  // What follows an upgrade request on the wire is frames: a client that does not
  // wait for the 101 (RFC 6455 4.1) gets them into the read of the request. They
  // are held like anything behind a pending response, and the upgrade gives them
  // to the WebSocket, as it does with the rest of the read when it runs during the
  // request's dispatch. Holding them must not leave the WebSocket's reads off.
  it("performed by an async handler gives the WebSocket the frames held behind the handshake, and reads on", async () => {
    const handler = holdingHandler();
    const { upgradeEntered, releaseUpgrade, ...serving } = serveWithUpgrade(handler, { held: true });
    using server = serving.server;
    using client = await RawClient.connect(transport.target(server, ""));

    client.write(Buffer.concat([Buffer.from(upgradeRequest, "latin1"), maskedFrame("hi")]));
    await Promise.race([upgradeEntered, client.until(c => c.closed)]);
    await probe(transport, server, "");
    expect({ hits: handler.hits, closed: client.closed }).toEqual({ hits: ["/ws", "/probe"], closed: false });

    releaseUpgrade();
    await client.until(c => c.responses.length === 1);
    expect({ closed: client.closed, responses: client.responses.map(withAccept) }).toEqual({
      closed: false,
      responses: [switching],
    });

    client.write(maskedFrame("yo"));
    await expectEchoes(client, ["hi", "yo"]);
  });

  // Both at once: the upgrade request waits behind a pending response with a frame
  // behind it, and is then performed by an async handler. The frame is held twice,
  // the second time as what the replay of the upgrade request did not reach.
  it("held behind an async handler and performed by an async handler still gives the WebSocket the frame behind it", async () => {
    const handler = holdingHandler();
    const { upgradeEntered, releaseUpgrade, ...serving } = serveWithUpgrade(handler, { held: true });
    using server = serving.server;
    using client = await RawClient.connect(transport.target(server, ""));

    client.write(Buffer.concat([Buffer.from(request("/hold") + upgradeRequest, "latin1"), maskedFrame("hi")]));
    await Promise.race([handler.entered("/hold"), client.until(c => c.closed)]);
    await probe(transport, server, "");
    handler.release("/hold");
    await Promise.race([upgradeEntered, client.until(c => c.closed)]);
    await probe(transport, server, "");
    expect({ hits: handler.hits, closed: client.closed }).toEqual({
      hits: ["/hold", "/probe", "/ws", "/probe"],
      closed: false,
    });

    releaseUpgrade();
    await client.until(c => c.responses.length === 2);
    expect({ closed: client.closed, responses: client.responses.map(withAccept) }).toEqual({
      closed: false,
      responses: [{ statusLine: "HTTP/1.1 200 OK", body: "body of /hold", accept: undefined }, switching],
    });

    client.write(maskedFrame("yo"));
    await expectEchoes(client, ["hi", "yo"]);
  });

  // A request held behind the handshake is never dispatched as HTTP: the
  // connection has left HTTP by then. As frames the bytes are not valid, so the
  // WebSocket fails the connection.
  it("performed by an async handler fails the connection when an HTTP request is held behind the handshake", async () => {
    const handler = holdingHandler();
    const { upgradeEntered, releaseUpgrade, ...serving } = serveWithUpgrade(handler, { held: true });
    using server = serving.server;
    using client = await RawClient.connect(transport.target(server, ""));

    client.write(upgradeRequest + request("/never"));
    await Promise.race([upgradeEntered, client.until(c => c.closed)]);
    await probe(transport, server, "");
    expect({ hits: handler.hits, closed: client.closed }).toEqual({ hits: ["/ws", "/probe"], closed: false });

    releaseUpgrade();
    await client.until(c => c.closed);
    expect({
      hits: handler.hits,
      responses: client.responses.map(withAccept),
      framesAfterThe101: [...client.unparsed],
    }).toEqual({
      hits: ["/ws", "/probe"],
      responses: [switching],
      framesAfterThe101: [],
    });
  });
});
