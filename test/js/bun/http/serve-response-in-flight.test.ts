// A chunked request body can cross maxRequestBodySize after the handler has
// answered. The server then ends the request itself, the way it ends a request
// whose client left, and in that order: `req.signal` aborts, the producer of
// the response body is cancelled, and a read of the request body rejects. The
// abort and the cancel carry an `AbortError` that names the limit. The read
// rejects with the limit error, as it always has. On the wire, a request with
// no status written gets `413 Payload Too Large`. A response in flight cannot
// take its status back.
// It used to be ended as if it were complete: `Connection: close` and a blank
// line, then `Date` and `Transfer-Encoding` lines after that blank line, and a
// terminating chunk after whatever body was out. Now it gets what a failed
// body gets: no more bytes and a reset.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls as tlsCert } from "harness";
import { mkfifo } from "mkfifo";
import { EventEmitter, once } from "node:events";
import net from "node:net";
import { join } from "node:path";
import { PassThrough, pipeline, Readable } from "node:stream";
import { baseHeaders, F, frame, RawH2, T } from "./serve-http2-helpers";
import {
  type Cause,
  END_OF_STATUS_LINE,
  eventually,
  get,
  LIMIT,
  OVERFLOW,
  released,
  upload,
  type Upload,
} from "./serve-response-in-flight-fixture";

const never = () => new Promise<never>(() => {});

type Context = {
  // Records what the handler heard, in order.
  heard: (what: string) => (reason?: unknown) => void;
  // Resolves when the client's connection has closed.
  clientClosed: Promise<void>;
  // Resolves when `req.signal` has aborted.
  aborted: Promise<void>;
  // The row's result waits for these.
  waitFor: Promise<unknown>[];
  server: import("bun").Server<undefined>;
};

type Row = Upload & {
  respond(req: Request, ctx: Context): Response | Promise<Response>;
  expected: Record<string, unknown>;
  // What the handler hears when the client leaves at the marker, where that
  // is not what it hears on the limit with the reason of a client that left.
  whenTheClientLeaves?: string[];
};

// What a read of the request body rejects with, and what `req.signal` and `cancel()` carry.
const tooLarge = "Error: Request body exceeded maxRequestBodySize";
const refused = "AbortError: Request body exceeded maxRequestBodySize";
const left = "AbortError: The connection was closed.";

// The outcomes. `heard` starts with the abort of `req.signal`.
const answered413 = (...heard: string[]) => ({
  statusLine: "HTTP/1.1 413 Payload Too Large",
  headersEnded: true,
  body: "",
  closed: "fin",
  heard: [`abort:${refused}`, ...heard],
  errorCb: 0,
  pendingRequests: 0,
  next: "HTTP/1.1 200 OK",
});
const resetBeforeBody = (...heard: string[]) => ({
  statusLine: "HTTP/1.1 200 OK",
  // Whether the header section ended is not the point: no body, no terminating chunk.
  headersEnded: expect.any(Boolean),
  body: "",
  closed: "reset",
  heard: [`abort:${refused}`, ...heard],
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
const producers: Record<string, { body(ctx: Context, chunk: boolean): any; heard: string[]; later: string[] }> = {
  "a default stream": {
    body: ({ heard }, chunk) =>
      new ReadableStream({
        pull(c) {
          if (chunk) c.enqueue("chunk-a");
          return never();
        },
        cancel: heard("cancel"),
      }),
    heard: [`cancel:${refused}`],
    later: [],
  },
  "a direct stream": {
    body: ({ heard }, chunk) =>
      new ReadableStream({
        type: "direct",
        async pull(c: any) {
          if (chunk) {
            c.write("chunk-a");
            await c.flush();
          }
          await never();
        },
        cancel: heard("cancel"),
      } as any),
    heard: [`cancel:${refused}`],
    later: [],
  },
  // A generator cannot be interrupted inside an `await`. It waits for the
  // abort and then yields: a return() that the server queued takes effect
  // there, and the generator body does not continue. That takes microtasks
  // only, so one turn of the event loop is enough to see it.
  "an async generator": {
    body({ heard, aborted, waitFor }, chunk) {
      waitFor.push(aborted.then(() => new Promise(resolve => setImmediate(resolve))));
      return (async function* () {
        try {
          if (chunk) yield "chunk-a";
          await aborted;
          yield "late";
          heard("generator")("continued");
        } finally {
          heard("generator")("finally");
        }
      })();
    },
    heard: [],
    later: ["generator:finally"],
  },
};

// The handler reads the request body as a stream, or `from` a stream derived from it.
function readBody(req: Request, { heard }: Context, from: (req: Request) => ReadableStream = req => req.body!) {
  const reader = from(req).getReader();
  (async () => {
    while (!(await reader.read()).done);
  })().then(() => heard("read")("complete"), heard("read"));
  return reader;
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
  waitFor.push(
    clientClosed.then(() => released(server)).then(() => (server.pendingRequests === 0 ? closed.promise : undefined)),
  );
  return fetch(`http://127.0.0.1:${(upstream.address() as net.AddressInfo).port}/`);
}

const rewrite = (req: Request) =>
  new HTMLRewriter()
    .on("p", { element() {} })
    .transform(new Response(req.body, { headers: { "content-type": "text/html" } }));

// Reports how the request body stream ended: it feeds the response natively, so nothing else reads it.
const watched =
  (respond: (req: Request) => Response): Row["respond"] =>
  (req, { heard, clientClosed, waitFor, server }) => {
    const stream = req.body!;
    waitFor.push(
      clientClosed
        .then(() => released(server))
        .then(() => heard("req.body")(/state: '(\w+)'/.exec(Bun.inspect(stream))?.[1])),
    );
    return respond(req);
  };

const rows: Record<string, Row> = {
  // No status written: the 413, as before. The handler now hears of it.
  "the handler has not answered": { marker: null, respond: never, expected: answered413() },
  // The server has answered for the handler: its wait on `req.signal` ends.
  "the handler waits on req.signal": {
    marker: null,
    async respond(req, { heard }) {
      const emitter = new EventEmitter();
      await once(emitter, "message", { signal: req.signal }).catch(e => {
        heard("wait")(`${e.name}, ${emitter.listenerCount("message")} listeners`);
      });
      return new Response("late");
    },
    expected: answered413("wait:AbortError, 0 listeners"),
  },
  // A retry loop that gives up only for an `AbortError`, the error of a client that left.
  "the handler retries a fetch with req.signal until an AbortError": {
    marker: null,
    async respond(req, { heard, waitFor }) {
      using upstream = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: never });
      // The fetch settles on a later turn of the event loop than the abort.
      let gaveUp = false;
      waitFor.push(eventually(() => gaveUp));
      for (let turn = 1; turn <= 100; turn++) {
        try {
          return await fetch(upstream.url, { signal: req.signal });
        } catch (e: any) {
          if (e.name !== "AbortError") continue;
          heard("gave up")(`turn ${turn}`);
          gaveUp = true;
          return new Response(null, { status: 499 });
        }
      }
      heard("gave up")("never");
      gaveUp = true;
      return new Response(null, { status: 500 });
    },
    expected: answered413("gave up:turn 1"),
  },
  // Nothing has read the body. A first read from inside the teardown fails like a later one.
  "an abort listener reads the request body for the first time": {
    marker: null,
    respond(req, ctx) {
      req.signal.addEventListener("abort", () => void readBody(req, ctx));
      return never();
    },
    expected: answered413(`read:${tooLarge}`),
  },
  // The handler is told before the request body fails, so the cancel ends the read.
  "an abort listener cancels the reader of the request body, the handler has not answered": {
    marker: null,
    respond(req, ctx) {
      const reader = readBody(req, ctx);
      req.signal.addEventListener("abort", () => void reader.cancel());
      return never();
    },
    expected: answered413("read:complete"),
  },
  // An HTMLRewriter body holds its status back until its first chunk. This
  // one used to reach error(), which answered on a connection that stayed open.
  "an HTMLRewriter over the request body has written nothing": {
    marker: null,
    respond: rewrite,
    expected: answered413(),
  },
  // This one got the 413 before, but its request stayed pending for ever.
  "an HTMLRewriter over another stream has written nothing": {
    marker: null,
    respond: (req, { heard }) =>
      new HTMLRewriter()
        .on("p", { element() {} })
        .transform(new Response(new ReadableStream({ pull: never, cancel: heard("cancel") }))),
    expected: answered413("cancel:AbortError: The operation was aborted."),
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
        // The read fails last.
        expected: (chunk ? resetAfterChunk : resetBeforeBody)(
          ...heard,
          ...later,
          ...(reads ? [`read:${tooLarge}`] : []),
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
    expected: resetBeforeBody(`cancel:${refused}`, `text:${tooLarge}`),
  },
  // The status line is still in the cork buffer, so nothing reaches the client.
  "the request head and the overflow arrive in one read": {
    marker: null,
    respond: (req, ctx) => new Response(producers["a default stream"].body(ctx, false)),
    expected: { ...resetBeforeBody(`cancel:${refused}`), statusLine: "" },
  },
  // The stream is cancelled by then, as it is when the client leaves: it takes
  // no more chunks. This chunk used to go out, followed by a terminating chunk.
  "the rejection of the body read writes another chunk": {
    marker: "chunk-a",
    respond(req, { heard }) {
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
          heard("enqueue")("accepted");
        } catch (e: any) {
          heard("enqueue")(e.code);
        }
      });
      return new Response(body);
    },
    expected: resetAfterChunk("enqueue:ERR_INVALID_STATE"),
  },
  // cancel() runs after the connection is closed and can do anything.
  "cancel() stops the server": {
    marker: END_OF_STATUS_LINE,
    respond: (req, { heard, server }) =>
      new Response(
        new ReadableStream({
          pull: never,
          cancel(reason) {
            heard("cancel")(reason);
            server.stop(true);
          },
        }),
      ),
    expected: { ...resetBeforeBody(`cancel:${refused}`), next: "" },
  },
  // The handler is told before the request body fails, as when the client
  // leaves. A reader that it cancels from there ends as if the body were
  // complete: the handler has to look at `req.signal.aborted`. The same holds
  // for a reader of a stream derived from the body.
  ...Object.fromEntries(
    Object.entries({
      "the request body": (req: Request) => req.body!,
      "a tee() branch of the request body": (req: Request) => req.body!.tee()[0],
      "the body of a clone of the request": (req: Request) => req.clone().body!,
      "req.body.pipeThrough()": (req: Request) => req.body!.pipeThrough(new TransformStream()),
    }).map(([name, from]) => [
      `cancel() cancels the reader of ${name}`,
      {
        marker: "chunk-a",
        respond(req: Request, ctx: Context) {
          const reader = readBody(req, ctx, from);
          return new Response(
            new ReadableStream({
              pull(c) {
                c.enqueue("chunk-a");
                return never();
              },
              cancel(reason) {
                ctx.heard("cancel")(reason);
                return reader.cancel(reason);
              },
            }),
          );
        },
        expected: resetAfterChunk(`cancel:${refused}`, "read:complete"),
      },
    ]),
  ),
  // The rejection of a cancel that nothing catches would end the process.
  "an abort listener cancels the reader of the request body": {
    marker: "chunk-a",
    respond(req, ctx) {
      const reader = readBody(req, ctx);
      req.signal.addEventListener("abort", () => void reader.cancel());
      return new Response(producers["a default stream"].body(ctx, true));
    },
    expected: resetAfterChunk(`cancel:${refused}`, "read:complete"),
  },
  // Nothing has read the body. A first read from inside the teardown fails on
  // the limit, like a later one. When the client leaves, it finds an empty body.
  "cancel() reads the request body for the first time": {
    marker: "chunk-a",
    respond: (req, ctx) =>
      new Response(
        new ReadableStream({
          pull(c) {
            c.enqueue("chunk-a");
            return never();
          },
          cancel(reason) {
            ctx.heard("cancel")(reason);
            readBody(req, ctx);
          },
        }),
      ),
    expected: resetAfterChunk(`cancel:${refused}`, `read:${tooLarge}`),
    whenTheClientLeaves: [`abort:${left}`, `cancel:${left}`, "read:complete"],
  },
  // The stream of the request body is closed by then: nothing is left to fail.
  "the handler cancelled req.body": {
    marker: "chunk-a",
    async respond(req, ctx) {
      await req.body!.cancel();
      return new Response(producers["a default stream"].body(ctx, true));
    },
    expected: resetAfterChunk(`cancel:${refused}`),
  },

  // The request body feeds the response body: through a JS stream, natively,
  // and through an HTMLRewriter. The first one used to end as a complete,
  // empty `200 OK`. A native pipe owns the stream of the request body, which
  // ends closed for both causes.
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
    respond: watched(req => new Response(req.body)),
    expected: resetBeforeBody("req.body:closed"),
  },
  "new Response(req.body) has written a chunk": {
    marker: "chunk-a",
    first: "7\r\nchunk-a\r\n",
    respond: watched(req => new Response(req.body)),
    expected: resetAfterChunk("req.body:closed"),
  },
  "an HTMLRewriter over the request body has written a chunk": {
    marker: "chunk-a",
    first: "e\r\n<b>chunk-a</b>\r\n",
    respond: watched(rewrite),
    expected: { ...resetAfterChunk("req.body:closed"), body: "e\r\n<b>chunk-a</b>\r\n" },
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

// `held`: the client reads the response on only when the server has let the request go.
async function run(row: Row, { development = false, secure = false, held = false, cause = "limit" as Cause } = {}) {
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
      const aborted = Promise.withResolvers<void>();
      req.signal.addEventListener("abort", () => {
        heard.push(`abort:${req.signal.reason}`);
        aborted.resolve();
      });
      return row.respond(req, {
        heard: what => reason => void heard.push(`${what}:${reason}`),
        clientClosed: clientClosed.promise,
        aborted: aborted.promise,
        waitFor,
        server,
      });
    },
  });
  const request = held ? { ...row, hold: true, released: () => released(server) } : { ...row, cause };
  const { wire, closed } = await upload(server.port!, secure, request, clientClosed.resolve);
  // A client that left cannot see when the server has heard of it.
  if (cause === "leave") await released(server);
  await Promise.all(waitFor);
  const [head, ...rest] = wire.split("\r\n\r\n");
  return {
    head,
    statusLine: head.split("\r\n")[0],
    // The blank line that ends the header section arrived.
    headersEnded: rest.length > 0,
    body: rest.join("\r\n\r\n"),
    closed,
    heard,
    errorCb,
    pendingRequests: server.pendingRequests,
    // The server still answers.
    next: await get(server.port!, secure),
    // A request that never ends keeps a graceful stop pending.
    stopped: server.stop(),
  };
}

async function expectRow(row: Row, options?: { development?: boolean; secure?: boolean }) {
  const { head, stopped, ...result } = await run(row, options);
  expect(result).toEqual(row.expected as typeof result);
  await stopped;
}

// What the handler of `row` hears when the client leaves where the row's upload crosses the limit.
async function expectSameAsWhenTheClientLeaves(row: Row) {
  const { heard, pendingRequests, stopped } = await run(row, { cause: "leave" });
  const onTheLimit = row.expected.heard as string[];
  expect({ heard, pendingRequests }).toEqual({
    heard: row.whenTheClientLeaves ?? onTheLimit.map(what => what.replace(refused, left).replace(tooLarge, left)),
    pendingRequests: 0,
  });
  await stopped;
}

const fixture = join(import.meta.dir, "serve-response-in-flight-fixture.ts");

// Runs scenarios of the fixture in one process. Each is announced on stderr.
async function scenarios(names: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, ...names],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout && JSON.parse(stdout), stderr, exitCode };
}
const announced = (...names: string[]) => names.map(name => `# ${name}\n`).join("");

// A producer that runs until something stops it. `turn()` counts its turns:
// one that nothing stops fails its test, and does not hang it.
type Producing = { req: Request; heard: string[]; turn(): void; emitter: EventEmitter };
const chunk = Buffer.alloc(16 * 1024, "chunk");
// Bytes that do not compress, so a compressor passes backpressure on.
const noise = crypto.getRandomValues(new Uint8Array(64 * 1024));
const direct = (run: (c: any, ctx: Producing) => Promise<void>) => (ctx: Producing) =>
  new ReadableStream({
    type: "direct",
    pull: (c: any) =>
      run(c, ctx).then(
        () => void ctx.heard.push("producer ended"),
        e => void ctx.heard.push(`producer threw:${e}`),
      ),
    cancel: (reason: unknown) => void ctx.heard.push(`cancel:${reason}`),
  } as any);
const byDefault =
  (pull: (c: ReadableStreamDefaultController, ctx: Producing) => void | Promise<void>) => (ctx: Producing) =>
    new ReadableStream({
      pull: c => pull(c, ctx),
      cancel: reason => void ctx.heard.push(`cancel:${reason}`),
    });
// Copies the request body into the response and reports a failed read in the response.
const copy =
  (reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> }) =>
  async (write: (line: string | Uint8Array) => unknown) => {
    try {
      const { done, value } = await reader.read();
      if (!done) await write(value!);
      return done;
    } catch (e) {
      await write(`upload failed: ${(e as Error).message}\n`);
      return false;
    }
  };

// `marker`: what the client waits for, where it is not the start of a chunk.
const stops: Record<string, { body(ctx: Producing): unknown; heard: string[]; marker?: string }> = {
  "a direct stream that checks req.signal around a write": {
    body: direct(async (c, { req, turn }) => {
      while (!req.signal.aborted) {
        turn();
        await c.write(chunk);
      }
    }),
    heard: ["abort", "cancel", "producer ended"],
  },
  // The wait of docs/runtime/streams.mdx. The abort ends every such wait at
  // once, so only cancel() can end this loop.
  "a direct stream that waits with { signal: req.signal } until cancel()": {
    body(ctx) {
      let cancelled = false;
      return new ReadableStream({
        type: "direct",
        async pull(c: any) {
          c.write(chunk);
          await c.flush();
          while (!cancelled) {
            ctx.turn();
            try {
              const [message] = await once(ctx.emitter, "message", { signal: ctx.req.signal });
              c.write(message);
              await c.flush();
            } catch (e: any) {
              if (e.name !== "AbortError") throw e;
            }
          }
          ctx.heard.push("producer ended");
        },
        cancel(reason: unknown) {
          cancelled = true;
          ctx.heard.push(`cancel:${reason}`);
        },
      } as any);
    },
    heard: ["abort", "cancel", "producer ended"],
  },
  "a direct stream that reports a failed read of req.body until cancel()": {
    body(ctx) {
      let cancelled = false;
      const next = copy(ctx.req.body!.getReader());
      return new ReadableStream({
        type: "direct",
        async pull(c: any) {
          c.write(chunk);
          await c.flush();
          while (!cancelled) {
            ctx.turn();
            // Nothing here waits on the sink.
            if (await next(line => void c.write(line))) break;
          }
          ctx.heard.push("producer ended");
        },
        cancel(reason: unknown) {
          cancelled = true;
          ctx.heard.push(`cancel:${reason}`);
        },
      } as any);
    },
    heard: ["abort", "cancel", "producer ended"],
  },
  // A retry loop that gives up only for an `AbortError`: `req.signal` has one for both causes.
  "a direct stream that retries until req.signal.throwIfAborted() throws an AbortError": {
    body: direct(async (c, { req, turn }) => {
      c.write(chunk);
      await c.flush();
      while (true) {
        turn();
        try {
          req.signal.throwIfAborted();
          await once(req.signal, "abort");
        } catch (e: any) {
          if (e.name === "AbortError") return;
        }
      }
    }),
    heard: ["abort", "cancel", "producer ended"],
  },
  // What the controller answers once the response is gone.
  "a direct stream that writes after the abort": {
    body: direct(async (c, { req, heard }) => {
      c.write(chunk);
      await c.flush();
      await once(req.signal, "abort");
      heard.push(`write:${c.write(chunk)}`, `flush:${c.flush()}`, `flush(true):${await c.flush(true)}`);
    }),
    heard: ["abort", "cancel", "write:0", "flush:0", "flush(true):0", "producer ended"],
  },
  // The listener runs before the cancel. A stream that it ends is not cancelled.
  "an abort listener that writes to a direct stream and ends it": {
    body(ctx) {
      let controller: any;
      ctx.req.signal.addEventListener("abort", () => {
        ctx.heard.push(`write:${controller.write("late")}`, `flush:${controller.flush()}`, `end:${controller.end()}`);
      });
      return direct(async c => {
        controller = c;
        c.write(chunk);
        await c.flush();
        await never();
      })(ctx);
    },
    heard: ["abort", "write:0", "flush:0", "end:0"],
  },
  // `write()` returns 0 once the destination has gone away.
  "a direct stream that reports a failed read of req.body until write() returns 0": {
    body: direct(async (c, { req, turn }) => {
      c.write(chunk);
      await c.flush();
      await req.text().catch(() => {});
      while (c.write("upload failed, retry\n") !== 0) {
        turn();
        await c.flush();
      }
    }),
    heard: ["abort", "cancel", "producer ended"],
  },
  // The pump calls this pull() again as long as the sink takes a write.
  "a default stream whose pull() reports a failed read of req.body": {
    body(ctx) {
      const next = copy(ctx.req.body!.getReader());
      let first = true;
      return byDefault(async c => {
        ctx.turn();
        if (first) return void ((first = false), c.enqueue(chunk));
        if (await next(line => c.enqueue(line))) c.close();
      })(ctx);
    },
    heard: ["abort", "cancel"],
  },
  "a default stream whose pull() waits with { signal: req.signal }": {
    body(ctx) {
      let first = true;
      return byDefault(async c => {
        ctx.turn();
        if (first) return void ((first = false), c.enqueue(chunk));
        try {
          const [message] = await once(ctx.emitter, "message", { signal: ctx.req.signal });
          c.enqueue(message);
        } catch (e: any) {
          if (e.name !== "AbortError") throw e;
        }
      })(ctx);
    },
    heard: ["abort", "cancel"],
  },
  "a default stream whose pull() always has a chunk": {
    body: byDefault((c, { turn }) => {
      turn();
      c.enqueue(chunk);
    }),
    heard: ["abort", "cancel"],
  },
  // The cancel also reaches a producer behind a native transform.
  "a default stream behind a TextEncoderStream": {
    body: ctx =>
      byDefault((c, { turn }) => {
        turn();
        c.enqueue(chunk.toString());
      })(ctx).pipeThrough(new TextEncoderStream()),
    heard: ["abort", "cancel"],
  },
  "a default stream behind a CompressionStream": {
    body: ctx =>
      byDefault((c, { turn }) => {
        turn();
        c.enqueue(noise);
      })(ctx).pipeThrough(new CompressionStream("gzip")),
    heard: ["abort", "cancel"],
    // Compressed bytes have no marker.
    marker: END_OF_STATUS_LINE,
  },
  // The generator of docs/runtime/streams.mdx, with a first chunk.
  "an async generator that waits with { signal: req.signal }": {
    body: ({ req, heard, emitter }) =>
      (async function* () {
        try {
          yield chunk;
          while (true) {
            // `req.signal` ends this wait when the client disconnects.
            const [message] = await once(emitter, "message", { signal: req.signal });
            yield message;
          }
        } finally {
          heard.push("the client left");
        }
      })(),
    heard: ["abort", "the client left"],
  },
  "an async generator that retries a fetch with req.signal until an AbortError": {
    body: ({ req, heard, turn }) =>
      (async function* () {
        using upstream = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: never });
        yield chunk;
        while (true) {
          turn();
          try {
            yield await (await fetch(upstream.url, { signal: req.signal })).bytes();
          } catch (e: any) {
            if (e.name !== "AbortError") continue;
            heard.push("the client left");
            return;
          }
        }
      })(),
    heard: ["abort", "the client left"],
  },
  // A Node stream behind `Readable.toWeb()` is destroyed with the reason of the cancel.
  "a Readable.toWeb() body": {
    body({ heard, turn }) {
      const readable = new Readable({
        read() {
          turn();
          this.push(chunk);
        },
      });
      readable.on("error", e => void heard.push(`error:${e.name}`));
      return Readable.toWeb(readable);
    },
    heard: ["abort", "error:AbortError"],
  },
  "a pipeline() behind Readable.toWeb()": {
    body({ heard, turn }) {
      const source = new Readable({
        read() {
          turn();
          this.push(chunk);
        },
      });
      const through = new PassThrough();
      pipeline(source, through, e => void heard.push(`pipeline:${e?.name}`));
      return Readable.toWeb(through);
    },
    heard: ["abort", "pipeline:AbortError"],
  },
  "an async generator that always has a chunk": {
    body: ({ heard, turn }) =>
      (async function* () {
        try {
          while (true) {
            turn();
            yield chunk;
          }
        } finally {
          heard.push("the client left");
        }
      })(),
    heard: ["abort", "the client left"],
  },
};

// `count`: how many things the producer's handler hears.
async function produce(body: (ctx: Producing) => unknown, cause: Cause, count: number, marker = "chunk") {
  const heard: string[] = [];
  const emitter = new EventEmitter();
  let turns = 0;
  const turn = () => {
    if (++turns > 100_000) throw new Error("nothing stopped the producer");
  };
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    maxRequestBodySize: LIMIT,
    fetch(req) {
      if (req.method === "GET") return new Response("ok");
      req.signal.addEventListener("abort", () => void heard.push("abort"));
      return new Response(body({ req, heard, turn, emitter }) as any);
    },
  });
  const { closed } = await upload(server.port!, false, { marker, cause, released: () => released(server) });
  await released(server);
  // A producer that is not in its stream at the cancel (a timer) ends on a later turn.
  await eventually(() => heard.length >= count);
  return {
    closed,
    heard: heard.map(what => what.replace(/^cancel:.*/, "cancel")),
    reasons: heard.filter(what => what.startsWith("cancel:")),
    listeners: emitter.listenerCount("message"),
    pendingRequests: server.pendingRequests,
    next: await get(server.port!),
  };
}

// The tests run one after the other on purpose. The rows are CPU-bound in a
// debug build, so together they finish no sooner and each one takes longer.
describe("a chunked request body crosses maxRequestBodySize", () => {
  test.each(Object.entries(rows))("%s", async (_name, row) => {
    await expectRow(row);
  });

  // The server ends the request the way it ends one whose client left. Only
  // the reason differs, and the rows that say so.
  const inFlight = Object.entries(rows).filter(([, row]) => row.marker !== null);
  test.each(inFlight)("the handler hears what it hears when the client leaves: %s", async (_name, row) => {
    await expectSameAsWhenTheClientLeaves(row);
  });

  // The other RequestContext instantiations: a development server, and TLS.
  const subset = [
    "the handler has not answered",
    "a default stream has written nothing",
    "a direct stream has written a chunk, the handler reads req.body",
    "new Response(req.body) has written a chunk",
  ];
  test.each(subset)("development: true: %s", async name => {
    await expectRow(rows[name], { development: true });
  });
  test.each(subset)("TLS: %s", async name => {
    await expectRow(rows[name], { secure: true });
  });

  // A producer that runs on stops, by each of the ways a producer has to hear
  // that its response is gone. The abort and the cancel arrive together: no
  // producer runs between them.
  describe.each(["limit", "leave"] as const)("a producer stops (%s)", cause => {
    test.each(Object.entries(stops))("%s", async (_name, { body, heard, marker }) => {
      const reason = cause === "limit" ? refused : left;
      expect(await produce(body, cause, heard.length, marker)).toEqual({
        closed: cause === "limit" ? "reset" : "left",
        heard,
        reasons: heard.includes("cancel") ? [`cancel:${reason}`] : [],
        listeners: 0,
        pendingRequests: 0,
        next: "HTTP/1.1 200 OK",
      });
    });
  });
});

describe("a response with megabytes in flight", () => {
  // Bodies that the socket buffers cannot take whole while the client does not read.
  const large = Buffer.alloc(32 * 1024 * 1024, "y");
  const largeBody = async (respond: Row["respond"]) => {
    const row = { marker: END_OF_STATUS_LINE, respond, expected: {} };
    const { head, body, stopped, ...result } = await run(row, { held: true });
    await stopped;
    return { ...result, body: body.length, terminated: body.endsWith("0\r\n\r\n"), head };
  };

  // A control. A response that has ended is complete, whatever the client has
  // read of it. uWS stops the body callback then, so the limit is not checked
  // behind it: the response is delivered, and the close is the client's.
  test("a direct stream that has ended and is still being sent", async () => {
    const { head, ...result } = await largeBody(
      () =>
        new Response(
          new ReadableStream({
            type: "direct",
            async pull(c: any) {
              c.write(large);
              c.end();
              await never();
            },
          } as any),
        ),
    );
    expect(result).toEqual({
      statusLine: "HTTP/1.1 200 OK",
      headersEnded: true,
      body: expect.any(Number),
      terminated: true,
      closed: "fin",
      heard: [],
      errorCb: 0,
      pendingRequests: 0,
      next: "HTTP/1.1 200 OK",
    });
    expect(result.body).toBeGreaterThan(large.length);
  });

  // The producer has closed its stream, but the pump into the response still
  // waits for the client to read the last chunk before it ends the response.
  // The server cannot tell this stream from one that still has chunks: it used
  // to put a terminating chunk behind the bytes it held, which completed this
  // body and silently cut the other. The first chunk fills the socket buffer,
  // so that the last one waits on every platform.
  test("a closed stream whose last chunk is still being sent", async () => {
    const { head, ...result } = await largeBody(
      (req, { heard }) =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(large.subarray(0, 1024 * 1024));
              c.enqueue(large);
              c.close();
            },
            cancel: heard("cancel"),
          }),
        ),
    );
    expect(result).toEqual({
      statusLine: "HTTP/1.1 200 OK",
      headersEnded: true,
      body: expect.any(Number),
      terminated: false,
      closed: "reset",
      heard: [`abort:${refused}`],
      errorCb: 0,
      pendingRequests: 0,
      next: "HTTP/1.1 200 OK",
    });
    expect(result.body).toBeLessThan(large.length);
  });

  // A body with a Content-Length used to be cut with a FIN, short of its length.
  // Windows takes a write of any size into an empty socket buffer, so this body
  // is never in flight there. The HTTP/2 row holds it back on every platform.
  test.skipIf(isWindows)("a Buffer that is still being sent", async () => {
    const { head, ...result } = await largeBody(() => new Response(large));
    expect({ ...result, contentLength: /\r\ncontent-length: (\d+)/i.exec(head)?.[1] }).toEqual({
      statusLine: "HTTP/1.1 200 OK",
      contentLength: String(large.length),
      headersEnded: true,
      body: expect.any(Number),
      terminated: false,
      closed: "reset",
      heard: [`abort:${refused}`],
      errorCb: 0,
      pendingRequests: 0,
      next: "HTTP/1.1 200 OK",
    });
    expect(result.body).toBeLessThan(large.length);
  });

  // A producer that waits on the sink is cancelled, and then its write settles.
  // The first chunk fills the socket buffer, so that the second write waits.
  // Windows Server 2019 takes both writes at once, so nothing waits there.
  test.skipIf(isWindows)("a direct stream that waits on a write", async () => {
    const { head, ...result } = await largeBody(
      (req, { heard }) =>
        new Response(
          new ReadableStream({
            type: "direct",
            async pull(c: any) {
              c.write(large.subarray(0, 1024 * 1024));
              heard("write")(await c.write(large));
            },
            cancel: heard("cancel"),
          } as any),
        ),
    );
    expect(result).toEqual({
      statusLine: "HTTP/1.1 200 OK",
      headersEnded: true,
      body: expect.any(Number),
      terminated: false,
      closed: "reset",
      heard: [`abort:${refused}`, `cancel:${refused}`, `write:${large.length}`],
      errorCb: 0,
      pendingRequests: 0,
      next: "HTTP/1.1 200 OK",
    });
    expect(result.body).toBeLessThan(large.length);
  });
});

// A handler that reports the failed upload in its own response, and that is
// written for a client that leaves: it checks `req.signal.aborted` before it
// writes. It stays quiet on the limit too.
test("a handler that is written for a client that leaves stays quiet", async () => {
  const reported = (closed: string) => ({
    body: "1d\r\nprogress: reading the upload\n\r\n",
    closed,
    pendingRequests: 0,
    next: "HTTP/1.1 200 OK",
  });
  const expected = { "report:limit": reported("reset"), "report:leave": reported("left") };
  expect(await scenarios(Object.keys(expected))).toEqual({
    stdout: expected,
    stderr: announced(...Object.keys(expected)),
    exitCode: 0,
  });
});

// The rejection of a promise that nothing catches ends a process. The cancel
// of a reader from an abort listener must not be one.
test("a server whose abort listener cancels its reader keeps serving", async () => {
  const name = "an abort listener cancels the reader of the request body";
  expect(await scenarios([name])).toEqual({
    stdout: { [name]: { statusLine: "HTTP/1.1 413 Payload Too Large", next: "HTTP/1.1 200 OK", pendingRequests: 0 } },
    stderr: announced(name),
    exitCode: 0,
  });
});

describe("what is reported", () => {
  // The limit is the client's failure, not the server's: `error()` does not
  // run and nothing is printed.
  test.each([false, true])("development: %p", async development => {
    const expected: Record<string, unknown> = {
      "new Response(req.body) has written nothing": "HTTP/1.1 200 OK, 0 pending",
      "new Response(req.body) has written a chunk": "HTTP/1.1 200 OK, 0 pending",
      "an HTMLRewriter over req.body has written nothing": "HTTP/1.1 413 Payload Too Large, 0 pending",
      "an HTMLRewriter over req.body has written a chunk": "HTTP/1.1 200 OK, 0 pending",
    };
    for (const name of Object.keys(expected)) {
      expected[`development: ${development}: ${name}`] = expected[name];
      delete expected[name];
    }
    expect(await scenarios(Object.keys(expected))).toEqual({
      stdout: expected,
      stderr: announced(...Object.keys(expected)),
      exitCode: 0,
    });
  });

  // A response of another request that reads this body fails with the limit
  // error, and reports it as its own.
  test("the request body is the body of another response", async () => {
    expect(await scenarios(["relay"])).toEqual({
      stdout: {
        relay: {
          a: "HTTP/1.1 413 Payload Too Large",
          b: { statusLine: "HTTP/1.1 200 OK", body: "7\r\nchunk-a\r\n", closed: "reset" },
          pendingRequests: 0,
        },
      },
      stderr: `# relay\nerror: ${tooLarge.slice("Error: ".length)}\n`,
      exitCode: 0,
    });
  });
});

describe("requests that feed each other", () => {
  // A chunked upload that stays open. `overflow()` takes it over the limit.
  const post = (port: number, path: string) => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: c => void (body = c) });
    const done = new AbortController();
    const outcome = fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      body: stream,
      duplex: "half",
      signal: done.signal,
    } as RequestInit).then(
      async res => ({ status: res.status, body: await res.text() }),
      e => ({ rejected: e.code }),
    );
    return { outcome, done, overflow: () => body.enqueue(new Uint8Array(48).fill(120)) };
  };

  // X has not answered when its body crosses the limit. That body feeds the
  // response of Y through an HTMLRewriter that has written nothing, so the
  // body error runs Y's `error()`, which lets the handler of X go on. X is
  // over by then: it has its 413, and the answer of its handler is dropped,
  // its stream cancelled before it starts. The rejection used to end that
  // answer as a complete response.
  test("the handler answers while its request is being rejected", async () => {
    const heard: string[] = [];
    const answer = Promise.withResolvers<void>();
    const bodyOfX = Promise.withResolvers<ReadableStream>();
    const attached = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      maxRequestBodySize: LIMIT,
      error(e) {
        heard.push(`error():${e}`);
        answer.resolve();
        return new Response("err", { status: 500 });
      },
      async fetch(req) {
        if (new URL(req.url).pathname === "/x") {
          bodyOfX.resolve(req.body!);
          await answer.promise;
          heard.push(`the handler of X goes on, req.signal.aborted: ${req.signal.aborted}`);
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(c: any) {
                heard.push(`write:${c.write("chunk-a")}`);
                await c.flush();
                await never();
              },
              cancel: reason => void heard.push(`cancel:${reason}`),
            } as any),
          );
        }
        // A stream on the request body of Y: the close of Y fails it, and drains.
        req.body!.getReader();
        const other = await bodyOfX.promise;
        // One turn of the event loop: the server has taken the response of Y.
        setImmediate(attached.resolve);
        return new HTMLRewriter()
          .on("p", { element() {} })
          .transform(new Response(other, { headers: { "content-type": "text/html" } }));
      },
    });
    const y = post(server.port!, "/y");
    const x = post(server.port!, "/x");
    await attached.promise;
    x.overflow();
    const result = { x: await x.outcome, y: await y.outcome, heard, pendingRequests: server.pendingRequests };
    y.done.abort();
    expect(result).toEqual({
      x: { status: 413, body: "" },
      y: { status: 500, body: "err" },
      heard: [`error():${tooLarge}`, "the handler of X goes on, req.signal.aborted: true", "cancel:undefined"],
      pendingRequests: 0,
    });
  });

  // The answer of X is a file. It used to start on the response of X, which
  // the rejection then ended under it: a regular file went out as a `200`,
  // and a FIFO was read later into a connection that was closed and freed.
  test.each(isWindows ? ["file"] : ["file", "fifo"])("the handler answers with a %s", async kind => {
    using dir = tempDir("serve-response-in-flight", { "file": "contents" });
    const path = join(String(dir), kind);
    if (kind === "fifo") mkfifo(path);
    const name = "the handler answers with a file while its request is being rejected";
    expect(await scenarios([name], { ANSWER_FILE: path, ANSWER_KIND: kind })).toEqual({
      stdout: { [name]: { x: 413, y: 500, later: "HTTP/1.1 200 OK", pendingRequests: 0 } },
      stderr: announced(name),
      exitCode: 0,
    });
  });

  // A two-way relay over two connections. The response of X copies the request
  // body of Y. The response of Y is the request body of X, piped natively. X
  // crosses the limit: the body error reaches Y's response through the pipe,
  // the close of Y fails Y's request body, which X's producer reads, and
  // drains microtasks. X's producer runs there. It has heard the abort and the
  // cancel by then, whichever of the two it watches.
  test.each(["req.signal.aborted", "the flag that cancel() sets"])("a relay whose producer watches %s", async guard => {
    const heard: string[] = [];
    let turns = 0;
    const bodies: Record<string, PromiseWithResolvers<ReadableStream>> = {
      "/x": Promise.withResolvers(),
      "/y": Promise.withResolvers(),
    };
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      development: false,
      maxRequestBodySize: LIMIT,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (req.method === "GET") return new Response("ok");
        bodies[path].resolve(req.body!);
        const other = await bodies[path === "/x" ? "/y" : "/x"].promise;
        if (path === "/y") return new Response(other);
        req.signal.addEventListener("abort", () => void heard.push("abort"));
        const reader = other.getReader();
        let cancelled = false;
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(c: any) {
              while (guard === "req.signal.aborted" ? !req.signal.aborted : !cancelled) {
                if (++turns > 100_000) throw new Error("nothing stopped the producer");
                try {
                  const { done, value } = await reader.read();
                  if (done) break;
                  await c.write(value);
                } catch (e) {
                  await c.write(`peer failed: ${(e as Error).message}\n`);
                }
              }
              heard.push("producer ended");
            },
            cancel(reason: unknown) {
              cancelled = true;
              heard.push(`cancel:${reason}`);
            },
          } as any),
        );
      },
    });
    // Sends `first` as the start of a chunked upload, and calls `onMarker` when `marker` has arrived.
    const client = (path: string, first: string, marker: string, onMarker: (sock: net.Socket) => void) =>
      new Promise<string>(resolve => {
        let wire = "";
        let closed = "fin";
        const sock = net.connect(server.port!, "127.0.0.1", () => {
          sock.write(`POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\n\r\n${first}`);
        });
        sock.on("data", d => {
          const seen = wire.includes(marker);
          wire += d.toString("latin1");
          if (!seen && wire.includes(marker)) onMarker(sock);
        });
        sock.on("error", () => (closed = "reset"));
        sock.on("close", () => resolve(closed));
      });
    // Y relays X's first chunk and X relays Y's first chunk: both responses are in flight. Then X overflows.
    const yRelayed = Promise.withResolvers<void>();
    const y = client("/y", "7\r\nchunk-y\r\n", "chunk-x", () => yRelayed.resolve());
    const x = client("/x", "7\r\nchunk-x\r\n", "chunk-y", sock => void yRelayed.promise.then(() => sock.end(OVERFLOW)));
    const closed = { x: await x, y: await y };
    await released(server);
    expect({ ...closed, heard, pendingRequests: server.pendingRequests, next: await get(server.port!) }).toEqual({
      x: "reset",
      y: "reset",
      heard: ["abort", `cancel:${refused}`, "producer ended"],
      pendingRequests: 0,
      next: "HTTP/1.1 200 OK",
    });
  });
});

describe("a handler that forwards the upload", () => {
  // A fetch that follows `req.signal` is aborted, as when the client leaves.
  // One that does not fails with the error of the body that it reads.
  const forwards: Record<string, { forward(url: string, req: Request): Promise<Response>; rejected: string }> = {
    "fetch(url, { body: req.body })": {
      forward: (url, req) => fetch(url, { method: "POST", body: req.body, duplex: "half" } as RequestInit),
      rejected: tooLarge,
    },
    "fetch(url, { body: req.body, signal: req.signal })": {
      forward: (url, req) =>
        fetch(url, { method: "POST", body: req.body, signal: req.signal, duplex: "half" } as RequestInit),
      rejected: refused,
    },
    "fetch(url, req)": { forward: (url, req) => fetch(url, req), rejected: refused },
  };
  test.each(Object.entries(forwards))("%s", async (_name, { forward, rejected: expected }) => {
    using upstream = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        await req.text().catch(() => {});
        return new Response("upstream");
      },
    });
    const rejected = Promise.withResolvers<string>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      maxRequestBodySize: LIMIT,
      fetch: req =>
        forward(`http://127.0.0.1:${upstream.port}/`, req).catch(e => {
          rejected.resolve(`${e}, req.signal.reason: ${req.signal.reason}`);
          return new Response("bad gateway", { status: 502 });
        }),
    });
    const { wire } = await upload(server.port!, false, { marker: null, first: "7\r\nchunk-a\r\n" });
    expect({ statusLine: wire.split("\r\n")[0], rejected: await rejected.promise }).toEqual({
      statusLine: "HTTP/1.1 413 Payload Too Large",
      rejected: `${expected}, req.signal.reason: ${refused}`,
    });
  });
});

// The handler never looked at `req.signal` while its request was alive, and
// kept no error. The signal still has its reason afterwards.
describe.each(["limit", "leave"] as const)("a handler that first looks at req.signal afterwards (%s)", cause => {
  test("the reason is still there after a collection", async () => {
    let saved!: Request;
    using upstream = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("upstream") });
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      maxRequestBodySize: LIMIT,
      fetch(req) {
        if (req.method === "GET") return new Response("ok");
        saved = req;
        req.text().catch(() => {});
        return new Response(producers["a direct stream"].body({ heard: () => () => {} } as any, true));
      },
    });
    await upload(server.port!, false, { marker: "chunk-a", cause, released: () => released(server) });
    await released(server);
    Bun.gc(true);
    const signal = saved.signal;
    const reason = cause === "limit" ? refused : left;
    expect({
      aborted: signal.aborted,
      reason: String(signal.reason),
      throwIfAborted: (() => {
        try {
          signal.throwIfAborted();
        } catch (e) {
          return String(e);
        }
      })(),
      fetch: await fetch(upstream.url, { signal }).then(
        res => `resolved ${res.status}`,
        e => String(e),
      ),
    }).toEqual({ aborted: true, reason, throwIfAborted: reason, fetch: reason });
  });
});

describe("a multiplexed connection", () => {
  // HTTP/2 holds the status back until the first body byte, and a stream ends
  // with END_STREAM. The response in flight used to end that way: an empty
  // `200`, or the body so far, as a complete message. Now the stream is reset
  // and the connection carries on.
  describe("HTTP/2", () => {
    const INTERNAL_ERROR = 2;
    const WINDOW = 65535;

    // `written`: the DATA bytes the client waits for before it sends the overflow.
    async function expectStream(respond: Row["respond"], written: number, expected: Record<string, unknown>) {
      const heard: string[] = [];
      const clientClosed = Promise.withResolvers<void>();
      const waitFor: Promise<unknown>[] = [];
      using server = Bun.serve({
        port: 0,
        http2: true,
        maxRequestBodySize: LIMIT,
        fetch(req, server) {
          if (req.method === "GET") return new Response("ok");
          const aborted = Promise.withResolvers<void>();
          req.signal.addEventListener("abort", () => {
            heard.push("abort");
            aborted.resolve();
          });
          return respond(req, {
            heard: what => reason => void heard.push(`${what}:${reason}`),
            clientClosed: clientClosed.promise,
            aborted: aborted.promise,
            waitFor,
            server,
          });
        },
      });
      const client = await RawH2.connect(server.port!, false);
      await client.waitFor(f => f.type === T.SETTINGS);
      client.headers(1, baseHeaders("/", "POST"), F.END_HEADERS);
      const data = () =>
        Buffer.concat(client.frames.filter(f => f.type === T.DATA && f.streamId === 1).map(f => f.payload));
      if (written) await client.waitFor(() => data().length >= written);
      client.write(frame(T.DATA, 0, 1, Buffer.alloc(48, "x")));
      // The stream ends with a RST_STREAM, or as a complete message.
      const end = await client.waitFor(
        f =>
          f.streamId === 1 &&
          (f.type === T.RST_STREAM || (f.type !== T.WINDOW_UPDATE && (f.flags & F.END_STREAM) !== 0)),
      );
      const code = end.type === T.RST_STREAM ? end.payload.readUInt32BE(0) : "END_STREAM";
      clientClosed.resolve();
      await Promise.all(waitFor);
      // The connection still serves the next stream.
      const credit = Buffer.alloc(4);
      credit.writeUInt32BE(WINDOW);
      client.write(frame(T.WINDOW_UPDATE, 0, 0, credit));
      client.headers(3, baseHeaders("/ok"));
      const next = await client.body(3);
      const onStream = client.frames.filter(f => f.streamId === 1);
      client.close();
      expect<Record<string, unknown>>({
        code,
        headers: onStream.filter(f => f.type === T.HEADERS).length,
        data: data().length,
        endStream: onStream.some(f => f.type !== T.RST_STREAM && (f.flags & F.END_STREAM) !== 0),
        heard,
        next: next.toString(),
        pendingRequests: server.pendingRequests,
      }).toEqual(expected);
      // A request that never ends keeps a graceful stop pending.
      await server.stop();
    }

    const reset = (data: number, ...heard: string[]) => ({
      code: INTERNAL_ERROR,
      headers: data ? 1 : 0,
      data,
      endStream: false,
      heard: ["abort", ...heard],
      next: "ok",
      pendingRequests: 0,
    });

    test.each([false, true])("a default stream, chunk written: %p", async chunk => {
      const written = chunk ? "chunk-a".length : 0;
      await expectStream(
        (req, ctx) => new Response(producers["a default stream"].body(ctx, chunk)),
        written,
        reset(written, `cancel:${refused}`),
      );
    });

    test("a proxied fetch() body", async () => {
      await expectStream(
        (req, ctx) => fetchFromSilentUpstream("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nchunk-a", ctx),
        "chunk-a".length,
        reset("chunk-a".length, "upstream:closed"),
      );
    });

    // It used to end with END_STREAM at the edge of the client's window.
    test("a Buffer that is still being sent", async () => {
      await expectStream(() => new Response(Buffer.alloc(1024 * 1024, "y")), WINDOW, reset(WINDOW));
    });

    // Two streams on one connection. The response body of X is the request
    // body of Y (a native pipe). The response of Y is an HTMLRewriter over the
    // request body of X, with its status held back. X crosses the limit and is
    // over first: its stream is reset and its `req.signal` aborts. Then the
    // body error reaches Y's rewriter, which has written nothing, so Y's
    // `error()` runs. It stops the server, which aborts Y, and collects the
    // stream that X was writing from.
    test("the request body is the body of another response, whose error() stops the server", async () => {
      const heard: string[] = [];
      let bodies: Record<string, PromiseWithResolvers<ReadableStream>> | null = {
        "/x": Promise.withResolvers(),
        "/y": Promise.withResolvers(),
      };
      let attached = 0;
      const bothAttached = Promise.withResolvers<void>();
      using server = Bun.serve({
        port: 0,
        http2: true,
        maxRequestBodySize: LIMIT,
        error(e) {
          heard.push(`error():${e}`);
          server.stop(true);
          Bun.gc(true);
          return new Response("err", { status: 500 });
        },
        async fetch(req) {
          const path = new URL(req.url).pathname;
          req.signal.addEventListener("abort", () => void heard.push(`abort ${path}`));
          const mine = bodies![path];
          const theirs = bodies![path === "/x" ? "/y" : "/x"];
          mine.resolve(req.body!);
          // @ts-expect-error The handler keeps no reference to the request.
          req = null;
          let other: ReadableStream | null = await theirs.promise;
          const res =
            path === "/y"
              ? new HTMLRewriter()
                  .on("p", { element() {} })
                  .transform(new Response(other, { headers: { "content-type": "text/html" } }))
              : new Response(other);
          other = null;
          if (++attached === 2) {
            bodies = null;
            // One turn of the event loop: the server has taken both responses.
            setImmediate(bothAttached.resolve);
          }
          return res;
        },
      });
      const client = await RawH2.connect(server.port!, false);
      await client.waitFor(f => f.type === T.SETTINGS);
      client.headers(1, baseHeaders("/x", "POST"), F.END_HEADERS);
      client.headers(3, baseHeaders("/y", "POST"), F.END_HEADERS);
      client.write(frame(T.DATA, 0, 3, Buffer.from("chunk-y")));
      // The response of X carries the upload of Y.
      await client.waitFor(f => f.type === T.DATA && f.streamId === 1);
      await bothAttached.promise;
      Bun.gc(true);
      client.write(frame(T.DATA, 0, 1, Buffer.alloc(48, "x")));
      await client.waitForClose();
      const onX = client.frames.filter(f => f.streamId === 1);
      expect({
        x: Buffer.concat(onX.filter(f => f.type === T.DATA).map(f => f.payload)).toString(),
        endStream: onX.some(f => f.type !== T.RST_STREAM && (f.flags & F.END_STREAM) !== 0),
        heard,
        pendingRequests: server.pendingRequests,
      }).toEqual({
        x: "chunk-y",
        endStream: false,
        heard: ["abort /x", `error():${tooLarge}`, "abort /y"],
        pendingRequests: 0,
      });
    });
  });

  // HTTP/3 holds the status back like HTTP/2.
  describe("HTTP/3", () => {
    async function overLimit(chunk: boolean): Promise<Record<string, unknown>> {
      const heard: string[] = [];
      const handlerRan = Promise.withResolvers<void>();
      const cancelled = Promise.withResolvers<void>();
      using server = Bun.serve({
        port: 0,
        tls: tlsCert,
        http3: true,
        maxRequestBodySize: LIMIT,
        fetch(req) {
          if (req.method === "GET") return new Response("ok");
          req.signal.addEventListener("abort", () => void heard.push("abort"));
          handlerRan.resolve();
          return new Response(
            new ReadableStream({
              pull(c) {
                if (chunk) c.enqueue("chunk-a");
                return never();
              },
              cancel(reason) {
                heard.push(`cancel:${reason}`);
                cancelled.resolve();
              },
            }),
          );
        },
      });
      const url = `https://127.0.0.1:${server.port}/`;
      const init = { protocol: "http3", tls: { rejectUnauthorized: false } } as RequestInit;
      let body!: ReadableStreamDefaultController<Uint8Array>;
      const uploaded = new ReadableStream<Uint8Array>({
        start(c) {
          body = c;
          c.enqueue(new TextEncoder().encode("ab"));
        },
      });
      const response = fetch(url, { ...init, method: "POST", body: uploaded, duplex: "half" } as RequestInit);
      const overflow = new Uint8Array(48).fill(120);
      let outcome: Record<string, unknown>;
      if (chunk) {
        const res = await response;
        const reader = res.body!.getReader();
        const first = await reader.read();
        body.enqueue(overflow);
        const rest = await reader.read().then(
          r => (r.done ? "a clean end" : "more data"),
          e => e.code,
        );
        outcome = { status: res.status, first: new TextDecoder().decode(first.value), rest };
      } else {
        await handlerRan.promise;
        body.enqueue(overflow);
        outcome = await response.then(
          async res => ({ status: res.status, body: await res.text() }),
          e => ({ rejected: e.code }),
        );
      }
      await cancelled.promise;
      const next = await fetch(url, init).then(r => r.text());
      return { ...outcome, heard, next, pendingRequests: server.pendingRequests };
    }

    test("a stream that has written nothing", async () => {
      expect(await overLimit(false)).toEqual({
        rejected: "HTTP3StreamReset",
        heard: ["abort", `cancel:${refused}`],
        next: "ok",
        pendingRequests: 0,
      });
    });

    // HTTP/3 still closes a stream that has sent its headers with a FIN, so
    // how the body ends for the client is not asserted. The handler is told.
    test("a stream that has written a chunk", async () => {
      const { rest, ...result } = await overLimit(true);
      expect(result).toEqual({
        status: 200,
        first: "chunk-a",
        heard: ["abort", `cancel:${refused}`],
        next: "ok",
        pendingRequests: 0,
      });
    });
  });
});
