// A Bun.serve response that has started owns its connection until it ends.
// The chunked request body can cross maxRequestBodySize while that response is
// in flight. A request with no status written gets `413 Payload Too Large`. A
// response in flight cannot take its status back. It used to be ended as if it
// were complete: `Connection: close` and a blank line, then `Date` and
// `Transfer-Encoding` lines after that blank line, and a terminating chunk
// after whatever body was out. Now it gets what a failed body gets: no more
// bytes and a reset, and its producer hears a cancel.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import net from "node:net";
import tls from "node:tls";
import { baseHeaders, F, frame, RawH2, T } from "./serve-http2-helpers";

const LIMIT = 32;
// One chunk that takes every request body below over the limit.
const OVERFLOW = `30\r\n${Buffer.alloc(48, "x").toString()}\r\n`;
// The first line break: the status line has arrived.
const END_OF_STATUS_LINE = "\r\n";
const never = new Promise<never>(() => {});

type Context = {
  // Records what the producer of the response body heard, in order.
  heard: (what: string) => (reason?: unknown) => void;
  // Resolves when the client's connection has closed.
  clientClosed: Promise<void>;
  // The row's result waits for these.
  waitFor: Promise<unknown>[];
  server: import("bun").Server<undefined>;
};

type Row = {
  // What the client must have received before it sends the overflow, so the
  // response is provably in flight. `null`: the request head and the overflow
  // leave in one write, so the server finds both in one read.
  marker: string | null;
  // Body bytes (within the limit) sent with the request head.
  first?: string;
  respond(req: Request, ctx: Context): Response | Promise<Response>;
  expected: Record<string, unknown>;
};

const aborted = "AbortError: The connection was closed.";
const tooLarge = "Error: Request body exceeded maxRequestBodySize";

// The three outcomes. `heard` is what the producer of the response body heard.
const answered413 = {
  statusLine: "HTTP/1.1 413 Payload Too Large",
  headersEnded: true,
  body: "",
  closed: "fin",
  heard: [],
  errorCb: 0,
  pendingRequests: 0,
  next: "HTTP/1.1 200 OK",
};
const resetBeforeBody = (...heard: string[]) => ({
  statusLine: "HTTP/1.1 200 OK",
  // The header section was never ended: no blank line, no terminating chunk.
  headersEnded: false,
  body: "",
  closed: "reset",
  heard,
  errorCb: 0,
  pendingRequests: 0,
  next: "HTTP/1.1 200 OK",
});
const resetAfterChunk = (...heard: string[]) => ({
  ...resetBeforeBody(...heard),
  headersEnded: true,
  body: "7\r\nchunk-a\r\n",
});

// Three producers, each parked before its first chunk or right after it.
const producers: Record<string, { body(ctx: Context, chunk: boolean): BodyInit; heard: string[]; later: string[] }> = {
  "a default stream": {
    body: ({ heard }, chunk) =>
      new ReadableStream({
        pull(c) {
          if (chunk) c.enqueue("chunk-a");
          return never;
        },
        cancel: heard("cancel"),
      }),
    heard: [`cancel:${aborted}`],
    later: [],
  },
  "a direct stream": {
    body: ({ heard }, chunk) =>
      new ReadableStream({
        type: "direct",
        async pull(c) {
          if (chunk) {
            c.write("chunk-a");
            await c.flush();
          }
          await never;
        },
        cancel: heard("cancel"),
      } as any),
    heard: [`cancel:${aborted}`],
    later: [],
  },
  // A generator cannot be interrupted inside an `await`. It waits for the
  // client to see the close and then yields: a return() that the server
  // queued takes effect there, and the generator body does not continue. That
  // takes microtasks only, so one turn of the event loop is enough to see it.
  "an async generator": {
    body({ heard, clientClosed, waitFor }, chunk) {
      waitFor.push(clientClosed.then(() => new Promise(resolve => setImmediate(resolve))));
      return (async function* () {
        try {
          if (chunk) yield "chunk-a";
          await clientClosed;
          yield "late";
          heard("generator")("continued");
        } finally {
          heard("generator")("finally");
        }
      })() as any;
    },
    heard: [],
    later: ["generator:finally"],
  },
};

// The handler reads the request body as a stream.
function readBody(req: Request, { heard }: Context) {
  const reader = req.body!.getReader();
  (async () => {
    while (!(await reader.read()).done);
  })().catch(heard("read"));
}

// An upstream that answers with `firstWrite` and then stays silent.
async function fetchFromSilentUpstream(firstWrite: string, { heard, server, clientClosed, waitFor }: Context) {
  const closed = Promise.withResolvers<void>();
  const upstream = net.createServer(socket => {
    socket.resume();
    socket.on("error", () => {});
    socket.on("close", () => {
      heard("upstream")("closed");
      upstream.close();
      closed.resolve();
    });
    socket.write(firstWrite);
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  // A request that the server released has let go of its upstream too. A
  // request that is still pending never does, so there is nothing to wait for.
  waitFor.push(clientClosed.then(() => (server.pendingRequests === 0 ? closed.promise : undefined)));
  return fetch(`http://127.0.0.1:${(upstream.address() as net.AddressInfo).port}/`);
}

const rewrite = (req: Request) =>
  new HTMLRewriter()
    .on("p", { element() {} })
    .transform(new Response(req.body, { headers: { "content-type": "text/html" } }));

const rows: Record<string, Row> = {
  // No status written: the 413, as before.
  "the handler has not answered": { marker: null, respond: () => never, expected: answered413 },
  // An HTMLRewriter body holds its status back until its first chunk. This
  // one used to reach error(), which answered on a connection that stayed open.
  "an HTMLRewriter over the request body has written nothing": {
    marker: null,
    respond: rewrite,
    expected: answered413,
  },
  // This one got the 413 before, but its request stayed pending for ever.
  "an HTMLRewriter over another stream has written nothing": {
    marker: null,
    respond: (req, { heard }) =>
      new HTMLRewriter()
        .on("p", { element() {} })
        .transform(new Response(new ReadableStream({ pull: () => never, cancel: heard("cancel") }))),
    expected: { ...answered413, heard: ["cancel:AbortError: The operation was aborted."] },
  },
};

// A response in flight whose body does not come from the request. The handler
// either leaves the request body alone or reads it as a stream: the limit is
// checked in a different place for each.
for (const [producer, { body, heard, later }] of Object.entries(producers)) {
  for (const chunk of [false, true]) {
    for (const reads of [false, true]) {
      const phase = chunk ? "has written a chunk" : "has written nothing";
      rows[`${producer} ${phase}${reads ? ", the handler reads req.body" : ""}`] = {
        marker: chunk ? "chunk-a" : END_OF_STATUS_LINE,
        respond(req, ctx) {
          if (reads) readBody(req, ctx);
          return new Response(body(ctx, chunk));
        },
        expected: (chunk ? resetAfterChunk : resetBeforeBody)(
          ...heard,
          ...(reads ? [`read:${tooLarge}`] : []),
          ...later,
        ),
      };
    }
  }
}

Object.assign(rows, {
  "req.text() is pending": {
    marker: END_OF_STATUS_LINE,
    respond(req, ctx) {
      req.text().catch(ctx.heard("text"));
      return new Response(producers["a default stream"].body(ctx, false));
    },
    expected: resetBeforeBody(`cancel:${aborted}`, `text:${tooLarge}`),
  },
  // The status line is still in the cork buffer, so nothing reaches the client.
  "the request head and the overflow arrive in one read": {
    marker: null,
    respond: (req, ctx) => new Response(producers["a default stream"].body(ctx, false)),
    expected: { ...resetBeforeBody(`cancel:${aborted}`), statusLine: "" },
  },
  // This chunk used to go out, followed by a terminating chunk.
  "the rejection of the body read writes another chunk": {
    marker: "chunk-a",
    respond(req) {
      let controller!: ReadableStreamDefaultController;
      const body = new ReadableStream({
        start(c) {
          controller = c;
          c.enqueue(new TextEncoder().encode("chunk-a"));
        },
      });
      req.text().catch(() => {
        try {
          controller.enqueue(new TextEncoder().encode("late"));
        } catch {}
      });
      return new Response(body);
    },
    expected: resetAfterChunk(),
  },
  // cancel() runs after the connection is closed and can do anything.
  "cancel() stops the server": {
    marker: END_OF_STATUS_LINE,
    respond: (req, { heard, server }) =>
      new Response(
        new ReadableStream({
          pull: () => never,
          cancel(reason) {
            heard("cancel")(reason);
            server.stop(true);
          },
        }),
      ),
    expected: { ...resetBeforeBody(`cancel:${aborted}`), next: "" },
  },

  // The request body feeds the response body: through a JS stream, natively,
  // and through an HTMLRewriter. The first one used to end as a complete,
  // empty `200 OK`.
  "req.body.pipeThrough() has written nothing": {
    marker: END_OF_STATUS_LINE,
    respond: req => new Response(req.body!.pipeThrough(new TransformStream())),
    expected: resetBeforeBody(),
  },
  "req.body.pipeThrough() has written a chunk": {
    marker: "chunk-a",
    first: "7\r\nchunk-a\r\n",
    respond: req => new Response(req.body!.pipeThrough(new TransformStream())),
    expected: resetAfterChunk(),
  },
  "new Response(req.body) has written nothing": {
    marker: END_OF_STATUS_LINE,
    respond: req => new Response(req.body),
    expected: resetBeforeBody(),
  },
  "new Response(req.body) has written a chunk": {
    marker: "chunk-a",
    first: "7\r\nchunk-a\r\n",
    respond: req => new Response(req.body),
    expected: resetAfterChunk(),
  },
  "an HTMLRewriter over the request body has written a chunk": {
    marker: "chunk-a",
    first: "e\r\n<b>chunk-a</b>\r\n",
    respond: rewrite,
    expected: { ...resetAfterChunk(), body: "e\r\n<b>chunk-a</b>\r\n" },
  },

  // A natively piped body that the request does not feed. The request used
  // to stay pending for ever, with its upstream connection.
  "a proxied fetch() body has written nothing": {
    marker: END_OF_STATUS_LINE,
    respond: (req, ctx) => fetchFromSilentUpstream("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n", ctx),
    expected: resetBeforeBody("upstream:closed"),
  },
  "a proxied fetch() body has written a chunk": {
    marker: "chunk-a",
    respond: (req, ctx) => fetchFromSilentUpstream("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nchunk-a", ctx),
    expected: resetAfterChunk("upstream:closed"),
  },
} satisfies Record<string, Row>);

// Uploads a chunked body: `first` with the head and, once `marker` has arrived,
// the chunk that takes the body over the limit. The overflow leaves from the
// data handler because a forced close is a RST, and a RST can discard what the
// client has not read yet. The client sends its FIN behind the overflow, so a
// server that answers and keeps the connection open still ends the row.
// `closed` tells a forced close ("reset") from a graceful one ("fin").
function upload(port: number, secure: boolean, { marker, first = "" }: Row, onClose: () => void) {
  const chunks: Buffer[] = [];
  let overflowed = marker === null;
  let closed = "fin";
  return new Promise<{ wire: string; closed: string }>(resolve => {
    const onConnect = () => {
      const head = `POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\n\r\n${first}`;
      if (overflowed) sock.end(head + OVERFLOW);
      else sock.write(head);
    };
    const sock: net.Socket = secure
      ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, onConnect)
      : net.connect(port, "127.0.0.1", onConnect);
    sock.on("data", d => {
      chunks.push(d);
      if (overflowed || !Buffer.concat(chunks).includes(marker!)) return;
      overflowed = true;
      sock.end(OVERFLOW);
    });
    sock.on("error", () => (closed = "reset"));
    sock.on("close", () => {
      onClose();
      resolve({ wire: Buffer.concat(chunks).toString("latin1"), closed });
    });
  });
}

function get(port: number, secure: boolean): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise(resolve => {
    const onConnect = () => void sock.write("GET /ok HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    const sock: net.Socket = secure
      ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, onConnect)
      : net.connect(port, "127.0.0.1", onConnect);
    sock.on("data", d => chunks.push(d));
    sock.on("error", () => {});
    sock.on("close", () => resolve(Buffer.concat(chunks).toString("latin1")));
  });
}

async function run(row: Row, { development = false, secure = false } = {}) {
  const heard: string[] = [];
  const clientClosed = Promise.withResolvers<void>();
  const waitFor: Promise<unknown>[] = [];
  let errorCb = 0;
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: secure ? tlsCert : undefined,
    development,
    maxRequestBodySize: LIMIT,
    error() {
      errorCb++;
      return new Response("err-body", { status: 500 });
    },
    fetch(req, server) {
      if (req.method === "GET") return new Response("ok");
      return row.respond(req, {
        heard: what => reason => void heard.push(`${what}:${reason}`),
        clientClosed: clientClosed.promise,
        waitFor,
        server,
      });
    },
  });
  const { wire, closed } = await upload(server.port, secure, row, clientClosed.resolve);
  await Promise.all(waitFor);
  const [head, ...rest] = wire.split("\r\n\r\n");
  return {
    statusLine: head.split("\r\n")[0],
    // The blank line that ends the header section arrived.
    headersEnded: rest.length > 0,
    body: rest.join("\r\n\r\n"),
    closed,
    heard,
    errorCb,
    pendingRequests: server.pendingRequests,
    // The server still answers.
    next: (await get(server.port, secure)).split("\r\n")[0],
  };
}

describe("a chunked request body crosses maxRequestBodySize", () => {
  test.each(Object.entries(rows))("%s", async (_name, row) => {
    expect(await run(row)).toEqual(row.expected);
  });

  // The other RequestContext instantiations: a development server, and TLS.
  const subset = [
    "the handler has not answered",
    "a default stream has written nothing",
    "a direct stream has written a chunk, the handler reads req.body",
    "new Response(req.body) has written a chunk",
  ];
  test.each(subset)("development: true: %s", async name => {
    expect(await run(rows[name], { development: true })).toEqual(rows[name].expected);
  });
  test.each(subset)("TLS: %s", async name => {
    expect(await run(rows[name], { secure: true })).toEqual(rows[name].expected);
  });

  // The producer has closed its stream, but the server still holds most of the
  // chunk: the client has not read it yet. The response is not complete on the
  // wire, so it gets the reset like every other response in flight. It used to
  // get a terminating chunk behind the bytes the server held. That completed
  // this body, and it silently cut a body whose producer still held a chunk.
  test("a closed stream whose last chunk is still being sent", async () => {
    const chunk = Buffer.alloc(32 * 1024 * 1024, "y");
    const { body, ...result } = await run({
      marker: END_OF_STATUS_LINE,
      respond: (req, { heard }) =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(chunk);
              c.close();
            },
            cancel: heard("cancel"),
          }),
        ),
      expected: {},
    });
    expect({ ...result, terminated: body.endsWith("0\r\n\r\n") }).toEqual({
      statusLine: "HTTP/1.1 200 OK",
      headersEnded: true,
      terminated: false,
      closed: "reset",
      heard: [],
      errorCb: 0,
      pendingRequests: 0,
      next: "HTTP/1.1 200 OK",
    });
  });

  // A response that the request body feeds used to report the limit error on
  // stderr. The limit is the client's failure, not the server's: no response
  // kind reports it.
  test("nothing is reported on stderr", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const server = Bun.serve({
          port: 0,
          development: false,
          maxRequestBodySize: 32,
          fetch: req => new Response(req.body),
        });
        let overflowed = false;
        await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: {
            open(socket) {
              socket.write("POST / HTTP/1.1\\r\\nHost: x\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n");
            },
            data(socket) {
              if (overflowed) return;
              overflowed = true;
              socket.write("30\\r\\n" + Buffer.alloc(48, "x") + "\\r\\n");
            },
            error() {},
            close() {
              console.log("pending", server.pendingRequests);
              server.stop(true);
            },
          },
        });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "pending 0\n", stderr: "", exitCode: 0 });
  });

  // HTTP/2 holds the status back until the first body byte, and a stream ends
  // with END_STREAM. The response in flight used to end that way: an empty
  // `200`, or the body so far, as a complete message. Now the stream is reset
  // and the connection carries on.
  describe("HTTP/2", () => {
    const INTERNAL_ERROR = 2;

    async function overLimit(chunk: boolean) {
      using server = Bun.serve({
        port: 0,
        http2: true,
        maxRequestBodySize: LIMIT,
        fetch(req) {
          if (req.method === "GET") return new Response("ok");
          return new Response(
            new ReadableStream({
              pull(c) {
                if (chunk) c.enqueue("chunk-a");
                return never;
              },
            }),
          );
        },
      });
      const client = await RawH2.connect(server.port, false);
      await client.waitFor(f => f.type === T.SETTINGS);
      client.headers(1, baseHeaders("/", "POST"), F.END_HEADERS);
      if (chunk) await client.waitFor(f => f.type === T.DATA && f.streamId === 1);
      client.write(frame(T.DATA, 0, 1, Buffer.alloc(48, "x")));
      const code = await client.rst(1);
      // The connection still serves the next stream.
      client.headers(3, baseHeaders("/ok"));
      const next = await client.body(3);
      const onStream = client.frames.filter(f => f.streamId === 1);
      client.close();
      return {
        code,
        headers: onStream.filter(f => f.type === T.HEADERS).length,
        data: Buffer.concat(onStream.filter(f => f.type === T.DATA).map(f => f.payload)).toString(),
        endStream: onStream.some(f => f.type !== T.RST_STREAM && (f.flags & F.END_STREAM) !== 0),
        next: next.toString(),
        pendingRequests: server.pendingRequests,
      };
    }

    test("a stream that has written nothing", async () => {
      expect(await overLimit(false)).toEqual({
        code: INTERNAL_ERROR,
        headers: 0,
        data: "",
        endStream: false,
        next: "ok",
        pendingRequests: 0,
      });
    });

    test("a stream that has written a chunk", async () => {
      expect(await overLimit(true)).toEqual({
        code: INTERNAL_ERROR,
        headers: 1,
        data: "chunk-a",
        endStream: false,
        next: "ok",
        pendingRequests: 0,
      });
    });
  });
});
