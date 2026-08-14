import { describe, expect, it } from "bun:test";
import { isPosix, tempDir, tls } from "harness";
import { join } from "node:path";

// A request pipelined behind a response that was still in flight (the handler had
// not returned yet, or it had and uWS was still draining a body that did not fit
// in the socket buffer) used to make uWS close the connection the moment it
// parsed the second request head: the in-flight response was truncated and the
// second request never answered. Such a request is now held until the response
// ahead of it completes and is dispatched then, so responses stay in request
// order (RFC 9112 9.3.2); one held behind a Connection: close request is dropped
// with the connection (RFC 9112 9.6), and one held behind a request that turns
// the connection into a WebSocket is dropped with the HTTP state.

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
        this.#chunked = headers["transfer-encoding"] === "chunked";
        this.#bodyNeed = Number(headers["content-length"] ?? 0);
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
  // A masked text frame "hi" (mask key 1 2 3 4); the server echoes it unmasked.
  const maskedHiFrame = new Uint8Array([0x81, 0x82, 1, 2, 3, 4, "h".charCodeAt(0) ^ 1, "i".charCodeAt(0) ^ 2]);
  const echoedHiFrame = [0x81, 0x02, "h".charCodeAt(0), "i".charCodeAt(0)];

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

  async function expectEcho(client: RawClient) {
    client.write(maskedHiFrame);
    await client.until(c => c.unparsed.length >= echoedHiFrame.length);
    expect({ closed: client.closed, frame: [...client.unparsed] }).toEqual({ closed: false, frame: echoedHiFrame });
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
    await expectEcho(client);
  });

  // The request held behind the handshake is discarded with the HTTP state when
  // the connection becomes a WebSocket (as bytes trailing a synchronous upgrade
  // in the same read always were), and holding it must not leave the WebSocket's
  // reads switched off.
  it("performed by an async handler with a request pipelined behind it drops that request and reads frames", async () => {
    const handler = holdingHandler();
    const { upgradeEntered, releaseUpgrade, ...serving } = serveWithUpgrade(handler, { held: true });
    using server = serving.server;
    using client = await RawClient.connect(transport.target(server, ""));

    client.write(upgradeRequest + request("/never"));
    await Promise.race([upgradeEntered, client.until(c => c.closed)]);
    await probe(transport, server, "");
    expect({ hits: handler.hits, closed: client.closed }).toEqual({ hits: ["/ws", "/probe"], closed: false });

    releaseUpgrade();
    await client.until(c => c.responses.length === 1);
    expect({ closed: client.closed, responses: client.responses.map(withAccept) }).toEqual({
      closed: false,
      responses: [switching],
    });

    await expectEcho(client);
    // The echo round trip above means the server has long since processed
    // everything it received before the frame; /never was not part of it.
    await probe(transport, server, "");
    expect({ hits: handler.hits, responses: client.responses.length }).toEqual({
      hits: ["/ws", "/probe", "/probe"],
      responses: 1,
    });
  });
});
