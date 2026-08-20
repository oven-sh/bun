import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { connect } from "node:net";
import { join } from "node:path";

async function waitForPendingRequests(server: ReturnType<typeof Bun.serve>, expected: number) {
  for (let i = 0; i < 100; i++) {
    if (server.pendingRequests === expected) return;
    Bun.gc(true);
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for pendingRequests === ${expected}; got ${server.pendingRequests}`);
}

// Deliberately never calls Bun.gc: these tests assert the context is torn
// down by the abort itself, not by GC collecting the pending promise.
async function waitForPendingRequestsWithoutGC(server: ReturnType<typeof Bun.serve>, expected: number) {
  for (let i = 0; i < 200; i++) {
    if (server.pendingRequests === expected) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for pendingRequests === ${expected}; got ${server.pendingRequests}`);
}

test("RequestContext is freed when client aborts before Promise<Response> settles", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-pending-promise-abort-leak-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.pending).toBe(0);
  expect(result.abortCount).toBe(result.iterations);
  expect(exitCode).toBe(0);
});

test("Promise<Response> still works normally when not aborted", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Promise<Response>(resolve => {
        queueMicrotask(() => resolve(new Response("hello")));
      });
    },
  });

  const res = await fetch(server.url);
  expect(await res.text()).toBe("hello");
  expect(res.status).toBe(200);
  expect(server.pendingRequests).toBe(0);
});

test("resolve() inside abort handler is handled safely", async () => {
  let aborted = false;
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      return new Promise<Response>(resolve => {
        req.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            // Resolving after abort is safe but the response is dropped
            // since the client is already gone.
            resolve(new Response("too late"));
          },
          { once: true },
        );
      });
    },
  });

  const ac = new AbortController();
  const p = fetch(server.url, { signal: ac.signal }).catch(() => {});
  await waitForPendingRequests(server, 1);
  ac.abort();
  await p;
  await waitForPendingRequests(server, 0);

  expect(aborted).toBe(true);
  expect(server.pendingRequests).toBe(0);
});

test("streaming 413 detaches the response so a late resolve/reject is a no-op", async () => {
  // Run in a subprocess: without the fix this is a heap-use-after-free under
  // ASAN (render() corks a uWS socket that was freed when the 413 closed the
  // connection — markDone() cleared onAborted so no abort ever detached
  // ctx.resp).
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-413-streaming-late-resolve-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const lines = stdout
    .trim()
    .split("\n")
    .map(l => JSON.parse(l));
  expect(lines).toEqual([
    {
      case: "resolve",
      status: "HTTP/1.1 413 Payload Too Large",
      bodyErr: "Request body exceeded maxRequestBodySize",
      pendingAfterResolve: 0,
      followUp: { status: 200, text: "follow-up" },
    },
    {
      case: "reject",
      status: "HTTP/1.1 413 Payload Too Large",
      pendingAfterReject: 0,
    },
  ]);
  expect(exitCode).toBe(0);
}, 30_000);

test("chunked request body consumed as a ReadableStream is capped at maxRequestBodySize", async () => {
  // The up-front maxRequestBodySize check only sees Content-Length, and the
  // buffering branch of onBufferedBodyChunk only caps req.text()/.arrayBuffer().
  // A chunked (no Content-Length) body consumed as a ReadableStream goes
  // through the streaming branch, which must also count and cap forwarded
  // bytes — otherwise a single request streams unbounded data past the limit.
  const limit = 1024;

  let streamed = 0;
  let streamError = "";
  let firstChunk = Promise.withResolvers<void>();
  let handlerDone = Promise.withResolvers<void>();

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    maxRequestBodySize: limit,
    async fetch(req) {
      streamed = 0;
      streamError = "";
      try {
        for await (const chunk of req.body!) {
          streamed += chunk.byteLength;
          firstChunk.resolve();
        }
      } catch (e) {
        streamError = String((e as Error)?.message ?? e);
      } finally {
        firstChunk.resolve();
        handlerDone.resolve();
      }
      return new Response(String(streamed));
    },
  });

  // Sends a chunked POST with no Content-Length. Writes one small chunk,
  // waits until the handler has started pulling from the stream (so later
  // chunks take the streaming branch, not the pre-stream buffer), then
  // writes the rest.
  async function sendChunked(totalBytes: number): Promise<string> {
    firstChunk = Promise.withResolvers<void>();
    handlerDone = Promise.withResolvers<void>();

    const sock = connect(Number(server.port), "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      sock.on("connect", resolve);
      sock.on("error", reject);
    });
    // Once the limit trips the server ends the connection while the client is
    // still writing chunks; EPIPE/ECONNRESET here is the expected outcome.
    sock.removeAllListeners("error");
    sock.on("error", () => {});

    let received = "";
    const { promise: gotResponse, resolve: doneReceiving } = Promise.withResolvers<void>();
    sock.on("data", d => {
      received += d.toString("latin1");
      if (received.includes("\r\n\r\n")) doneReceiving();
    });
    sock.on("close", () => doneReceiving());

    sock.write(
      "POST / HTTP/1.1\r\n" + //
        `Host: 127.0.0.1:${server.port}\r\n` +
        "Transfer-Encoding: chunked\r\n" +
        "\r\n",
    );

    const piece = Buffer.alloc(256, "A").toString("latin1");
    const writeChunk = () =>
      new Promise<void>(resolve => {
        if (sock.destroyed) return resolve();
        sock.write(piece.length.toString(16) + "\r\n" + piece + "\r\n", () => resolve());
      });

    await writeChunk();
    await firstChunk.promise;
    for (let sent = piece.length; sent < totalBytes && !sock.destroyed; sent += piece.length) {
      await writeChunk();
    }
    if (!sock.destroyed) sock.write("0\r\n\r\n");

    await handlerDone.promise;
    await gotResponse;
    sock.destroy();
    return received.split("\r\n")[0];
  }

  // A chunked body under the limit still streams fully to the handler.
  const okStatus = await sendChunked(512);
  expect(streamError).toBe("");
  expect(streamed).toBe(512);
  expect(okStatus).toBe("HTTP/1.1 200 OK");

  // A chunked body over the limit is rejected: the stream read errors, the
  // handler never sees the full payload, and the client gets a 413.
  const overflowTotal = limit * 16;
  const overflowStatus = await sendChunked(overflowTotal);
  expect(overflowStatus).toBe("HTTP/1.1 413 Payload Too Large");
  expect(streamError).toBe("Request body exceeded maxRequestBodySize");
  expect(streamed).toBeLessThan(overflowTotal);

  await waitForPendingRequests(server, 0);
}, 15_000);

test("client abort frees the context even while the resolve function stays reachable", async () => {
  // The held resolve function keeps the handler Promise (and so the
  // NativePromiseContext cell) alive forever, so GC can never release the
  // cell's ref on the RequestContext. The abort itself must reclaim it.
  let capturedResolve: ((r: Response) => void) | undefined;
  const { promise: abortObserved, resolve: signalAbort } = Promise.withResolvers<void>();

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      return new Promise<Response>(resolve => {
        capturedResolve = resolve;
        req.signal.addEventListener("abort", () => signalAbort(), { once: true });
      });
    },
  });

  const ac = new AbortController();
  const p = fetch(server.url, { signal: ac.signal }).catch(() => {});
  await waitForPendingRequests(server, 1);
  ac.abort();
  await p;
  await abortObserved;

  // The context is torn down on abort, not when GC collects the promise.
  await waitForPendingRequestsWithoutGC(server, 0);

  // Resolving after the context is gone is a safe no-op: the reaction's
  // take() returns null.
  capturedResolve!(new Response("very late"));
  capturedResolve = undefined;
  await Bun.sleep(0);
  expect(server.pendingRequests).toBe(0);
});

// Holding the pull() promise keeps its NativePromiseContext cell alive, so
// only the abort can release the context. Before the fix, on_abort's sink
// branch returned without ending request streaming, so a pending body read on
// the cut-off upload stayed parked (and pendingRequests at 1) until GC.
// req.text() and for-await(req.body) keep the body Locked. req.textStream()
// moves it to Used, whose rejection goes through a stream ref that
// finalize_without_deinit drops without erroring, so the sink branch must end
// request streaming itself.
const bodyConsumers: Array<[string, (req: Request, done: (v: unknown) => void) => void]> = [
  [
    "req.text()",
    (req, done) => {
      req.text().then(() => done("resolved"), done);
    },
  ],
  [
    "for await (req.body)",
    (req, done) => {
      (async () => {
        try {
          for await (const _chunk of req.body!) {
            // keep reading until the upload ends or errors
          }
          done("completed");
        } catch (e) {
          done(e);
        }
      })();
    },
  ],
  [
    "req.textStream()",
    (req, done) => {
      (async () => {
        try {
          for await (const _chunk of req.textStream()) {
            // keep reading until the upload ends or errors
          }
          done("completed");
        } catch (e) {
          done(e);
        }
      })();
    },
  ],
];

test.each(bodyConsumers)(
  "client abort while a direct stream pull() is parked frees the context and rejects a pending %s read",
  async (_name, consume) => {
    let pumpHold: Promise<never> | undefined;
    const { promise: bodyRead, resolve: signalBodyRead } = Promise.withResolvers<unknown>();
    const { promise: firstWrite, resolve: signalFirstWrite } = Promise.withResolvers<void>();

    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req) {
        consume(req, signalBodyRead);
        return new Response(
          new ReadableStream({
            type: "direct",
            pull(ctrl) {
              ctrl.write("hello");
              ctrl.flush();
              signalFirstWrite();
              pumpHold = new Promise<never>(() => {});
              return pumpHold;
            },
          }),
        );
      },
    });

    // Raw socket: send a chunked POST, deliver one partial chunk so the read
    // stays pending, then destroy the socket mid-stream.
    const socket = connect(Number(server.port), "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("error", reject);
    });
    socket.removeAllListeners("error");
    socket.on("error", () => {});
    socket.write(
      "POST / HTTP/1.1\r\n" + //
        `Host: 127.0.0.1:${server.port}\r\n` +
        "Transfer-Encoding: chunked\r\n" +
        "\r\n" +
        "7\r\npartial\r\n",
    );
    await firstWrite;
    socket.destroy();

    // The cut-off upload rejects the pending read at abort time.
    const err = await bodyRead;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("AbortError");
    await waitForPendingRequestsWithoutGC(server, 0);
    pumpHold = undefined;
  },
);

test("async server.upgrade() frees the context while the handler promise stays parked", async () => {
  // The upgrade detaches the response and disarms onAborted, so neither
  // on_abort nor an end path can run afterwards. The upgrade itself must
  // reclaim the cell's ref, or the held resolve parks the context forever.
  let capturedResolve: ((r: Response) => void) | undefined;

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req, srv) {
      return new Promise<Response>(resolve => {
        capturedResolve = resolve;
        // Upgrade from a macrotask, so on_response parks the promise and
        // takes the cell ref before the upgrade runs.
        setImmediate(() => srv.upgrade(req));
      });
    },
    websocket: {
      message() {},
    },
  });

  const ws = new WebSocket(`ws://localhost:${server.port}/`);
  const { promise: opened, resolve: signalOpen, reject: failOpen } = Promise.withResolvers<void>();
  ws.onopen = () => signalOpen();
  ws.onerror = () => failOpen(new Error("websocket upgrade failed"));
  await opened;

  await waitForPendingRequestsWithoutGC(server, 0);

  capturedResolve = undefined;
  ws.close();
});

test("413 on a chunked upload frees the context while the handler promise stays parked", async () => {
  // The 413 path ends the request through end_without_body, and uWS markDone()
  // clears onAborted, so on_abort can never run for this request. The held
  // resolve keeps the promise alive forever, so only the end path itself can
  // release the context.
  let capturedResolve: ((r: Response) => void) | undefined;
  const { promise: handlerEntered, resolve: signalHandler } = Promise.withResolvers<void>();

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    maxRequestBodySize: 1024,
    fetch() {
      signalHandler();
      return new Promise<Response>(resolve => {
        capturedResolve = resolve;
      });
    },
  });

  const socket = connect(Number(server.port), "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("error", reject);
  });
  // The server closes the connection after the 413; EPIPE/ECONNRESET while we
  // are still writing chunks is the expected outcome.
  socket.removeAllListeners("error");
  socket.on("error", () => {});

  let received = "";
  const { promise: gotResponse, resolve: signalResponse } = Promise.withResolvers<void>();
  socket.on("data", d => {
    received += d.toString("latin1");
    if (received.includes("\r\n\r\n")) signalResponse();
  });
  socket.on("close", () => signalResponse());

  socket.write(
    "POST / HTTP/1.1\r\n" + //
      `Host: 127.0.0.1:${server.port}\r\n` +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n",
  );
  await handlerEntered;

  const piece = Buffer.alloc(512, "A").toString("latin1");
  for (let sent = 0; sent < 4096 && !socket.destroyed; sent += piece.length) {
    await new Promise<void>(resolve => {
      if (socket.destroyed) return resolve();
      socket.write(piece.length.toString(16) + "\r\n" + piece + "\r\n", () => resolve());
    });
  }

  await gotResponse;
  // An early close resolves gotResponse too; fail on the missing response
  // before the status-line comparison so the cause is visible.
  expect(received).not.toBe("");
  expect(received.split("\r\n")[0]).toBe("HTTP/1.1 413 Payload Too Large");

  // The context is torn down by the 413, not by GC collecting the promise.
  await waitForPendingRequestsWithoutGC(server, 0);
  capturedResolve = undefined;
  socket.destroy();
});
