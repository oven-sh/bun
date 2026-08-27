import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { connect, type Socket } from "node:net";
import { join } from "node:path";

// Every test owns its server (port 0) or its child process, so they all run
// concurrently.

// The teardown condition, with no timers and no GC: server.stop() resolves
// only once pendingRequests reaches 0 and every connection is gone. On an
// unfixed build a parked context pins the count, so this await never settles
// and the test times out.
async function stopAndAssertDrained(server: ReturnType<typeof Bun.serve>) {
  await server.stop();
  expect(server.pendingRequests).toBe(0);
}

// A connected raw socket. Once connected, errors are expected: the server
// closes or resets the connection while the client is still writing.
async function openRawSocket(port: string | number): Promise<Socket> {
  const socket = connect(Number(port), "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("error", reject);
  });
  socket.removeAllListeners("error");
  socket.on("error", () => {});
  return socket;
}

// Everything the server wrote, collected until it closed the connection.
function readUntilClose(socket: Socket): Promise<string> {
  let received = "";
  const { promise, resolve } = Promise.withResolvers<string>();
  socket.on("data", d => (received += d.toString("latin1")));
  socket.on("close", () => resolve(received));
  return promise;
}

function chunkedPostHead(port: string | number): string {
  return "POST / HTTP/1.1\r\n" + `Host: 127.0.0.1:${port}\r\n` + "Transfer-Encoding: chunked\r\n" + "\r\n";
}

test.concurrent.each([false, true])(
  "RequestContext is freed when client aborts before Promise<Response> settles (http2: %p)",
  async http2 => {
    // Every handler promise stays reachable through `held`, so GC can never
    // collect its NativePromiseContext cell and release the context that way.
    // Only the abort can, and stop() below resolves only once every abort did.
    let abortCount = 0;
    const held: Promise<Response>[] = [];
    const handlerEnteredSignals: Array<() => void> = [];
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      ...(http2 ? { tls, http2: true } : {}),
      fetch(req) {
        req.signal.addEventListener("abort", () => abortCount++, { once: true });
        handlerEnteredSignals.shift()?.();
        const parked = new Promise<Response>(() => {});
        held.push(parked);
        return parked;
      },
    });

    // Aborts once the handler installed its abort listener, so every abort is
    // observed. HTTP/1.1 destroys a raw socket. HTTP/2 aborts a fetch(), which
    // sends RST_STREAM on the shared connection.
    async function abortOnce() {
      const { promise: handlerEntered, resolve: signalHandler, reject: failHandler } = Promise.withResolvers<void>();
      handlerEnteredSignals.push(signalHandler);
      if (http2) {
        const ac = new AbortController();
        const outcome = fetch(server.url, {
          protocol: "http2",
          tls: { rejectUnauthorized: false },
          signal: ac.signal,
        }).then(
          () => "resolved",
          (e: Error) => e.name,
        );
        await handlerEntered;
        ac.abort();
        expect(await outcome).toBe("AbortError");
        return;
      }
      const socket = connect(Number(server.port), "127.0.0.1", () => {
        socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      });
      // A failure before the handler ran is real. destroy() emits no error.
      socket.on("error", failHandler);
      await handlerEntered;
      socket.destroy();
    }

    const iterations = 100;
    for (let i = 0; i < iterations; i++) {
      await abortOnce();
    }

    await stopAndAssertDrained(server);
    expect({ abortCount, held: held.length, pending: server.pendingRequests }).toEqual({
      abortCount: iterations,
      held: iterations,
      pending: 0,
    });
    held.length = 0;
  },
);

test.concurrent("Promise<Response> still works normally when not aborted", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Promise<Response>(resolve => {
        queueMicrotask(() => resolve(new Response("hello")));
      });
    },
  });

  const res = await fetch(server.url);
  expect([res.status, await res.text()]).toEqual([200, "hello"]);
  expect(server.pendingRequests).toBe(0);
});

test.concurrent("resolve() inside abort handler is handled safely", async () => {
  let aborted = false;
  const { promise: handlerEntered, resolve: signalHandler } = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      signalHandler();
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
  const outcome = fetch(server.url, { signal: ac.signal }).then(
    () => "resolved",
    (e: Error) => e.name,
  );
  await handlerEntered;
  ac.abort();
  expect(await outcome).toBe("AbortError");
  await stopAndAssertDrained(server);

  expect(aborted).toBe(true);
});

test.concurrent("chunked request body consumed as a ReadableStream is capped at maxRequestBodySize", async () => {
  // The up-front maxRequestBodySize check only sees Content-Length, and the
  // buffering branch of onBufferedBodyChunk only caps req.text()/.arrayBuffer().
  // A chunked (no Content-Length) body consumed as a ReadableStream goes
  // through the streaming branch, which must also count and cap forwarded
  // bytes, otherwise a single request streams unbounded data past the limit.
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

    const sock = await openRawSocket(server.port);
    let received = "";
    const { promise: gotResponse, resolve: doneReceiving } = Promise.withResolvers<void>();
    sock.on("data", d => {
      received += d.toString("latin1");
      if (received.includes("\r\n\r\n")) doneReceiving();
    });
    sock.on("close", () => doneReceiving());

    sock.write(chunkedPostHead(server.port));

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
  expect({ status: okStatus, streamed, streamError }).toEqual({
    status: "HTTP/1.1 200 OK",
    streamed: 512,
    streamError: "",
  });

  // A chunked body over the limit is rejected: the stream read errors, the
  // handler never sees more than the limit, and the client gets a 413.
  const overflowStatus = await sendChunked(limit * 16);
  expect({ status: overflowStatus, streamError }).toEqual({
    status: "HTTP/1.1 413 Payload Too Large",
    streamError: "Request body exceeded maxRequestBodySize",
  });
  expect(streamed).toBeLessThanOrEqual(limit);

  await stopAndAssertDrained(server);
});

test.concurrent("client abort frees the context even while the resolve function stays reachable", async () => {
  // The held resolve function keeps the handler Promise (and so the
  // NativePromiseContext cell) alive forever, so GC can never release the
  // cell's ref on the RequestContext. The abort itself must reclaim it.
  let capturedResolve: ((r: Response) => void) | undefined;
  let capturedPromise: Promise<Response> | undefined;
  const { promise: abortObserved, resolve: signalAbort } = Promise.withResolvers<void>();
  const { promise: handlerEntered, resolve: signalHandler } = Promise.withResolvers<void>();

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      signalHandler();
      capturedPromise = new Promise<Response>(resolve => {
        capturedResolve = resolve;
        req.signal.addEventListener("abort", () => signalAbort(), { once: true });
      });
      return capturedPromise;
    },
  });

  const ac = new AbortController();
  const outcome = fetch(server.url, { signal: ac.signal }).then(
    () => "resolved",
    (e: Error) => e.name,
  );
  await handlerEntered;
  ac.abort();
  expect(await outcome).toBe("AbortError");
  await abortObserved;

  // The context is torn down on abort, not when GC collects the promise.
  await stopAndAssertDrained(server);

  // Resolving after the context is gone is a safe no-op: the reaction's
  // take() returns null. Awaiting the handler promise orders the assertion
  // after the native reaction, which was attached first.
  capturedResolve!(new Response("very late"));
  await capturedPromise;
  capturedResolve = undefined;
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

test.concurrent.each(bodyConsumers)(
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
    const socket = await openRawSocket(server.port);
    socket.write(chunkedPostHead(server.port) + "7\r\npartial\r\n");
    await firstWrite;
    socket.destroy();

    // The cut-off upload rejects the pending read at abort time.
    const err = (await bodyRead) as DOMException;
    expect(err).toBeInstanceOf(DOMException);
    expect({ name: err.name, message: err.message }).toEqual({
      name: "AbortError",
      message: "The connection was closed.",
    });
    await stopAndAssertDrained(server);
    pumpHold = undefined;
  },
);

test.concurrent(
  "pendingRequests drops when the client aborts a parked direct-stream pull(), and the late pull() settle is a no-op",
  async () => {
    // Same parked pull() scenario, driven through fetch() and an AbortController,
    // with the pull() resolvers stashed in user state. Releasing them afterwards
    // settles the pump promise of a context that is already gone: the stream
    // reaction's take() returns null, and pendingRequests must not move.
    const parked: Array<() => void> = [];
    const pullEntered: Array<() => void> = [];
    const pullSettled: Array<() => void> = [];

    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(c) {
              c.write("x");
              await c.flush();
              pullEntered.shift()?.();
              await new Promise<void>(r => parked.push(r));
              pullSettled.shift()?.();
            },
          }),
          { headers: { "Content-Length": "100000" } },
        );
      },
    });

    async function abortWhileParked() {
      const { promise: entered, resolve: markEntered } = Promise.withResolvers<void>();
      pullEntered.push(markEntered);
      const ac = new AbortController();
      const res = await fetch(server.url, { signal: ac.signal });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      await reader.read();
      await entered;
      ac.abort();
      await reader.closed.catch(() => {});
    }

    const iterations = 4;
    for (let i = 0; i < iterations; i++) {
      await abortWhileParked();
    }

    // stop() resolves only once every abort tore its context down.
    await stopAndAssertDrained(server);

    // Release the parked pulls: each settle targets a context that is already
    // gone. The stream reaction's take() returns null and the counter stays 0.
    // Awaiting the settle signals orders the assertion after those reactions.
    const resolvers = parked.splice(0);
    expect(resolvers.length).toBe(iterations);
    const settled = resolvers.map(() => {
      const { promise, resolve } = Promise.withResolvers<void>();
      pullSettled.push(resolve);
      return promise;
    });
    for (const r of resolvers) r();
    await Promise.all(settled);
    Bun.gc(true);
    expect(server.pendingRequests).toBe(0);
  },
);

// Between the abort and the late settle, the server itself goes away: stop()
// (issued before or after the abort) plus pendingRequests reaching 0 lets the
// server release its JS wrapper, and dropping the last reference lets GC free
// it. Releasing the parked pull() after that must still be a no-op. This runs
// in a child process: a freed server cannot be set up inside the test runner,
// and a regression here is a crash, not a failed assertion.
for (const stopFirst of [true, false]) {
  test.concurrent(
    `releasing a parked pull() after the abort tore down the context and the server is a no-op (${stopFirst ? "stop-then-abort" : "abort-then-stop"})`,
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
        let release;
        const gate = new Promise(r => (release = r));
        let pullDone;
        const pullExited = new Promise(r => (pullDone = r));
        let server = Bun.serve({
          port: 0,
          idleTimeout: 0,
          fetch() {
            return new Response(new ReadableStream({
              type: "direct",
              async pull(c) {
                c.write("x");
                await c.flush();
                await gate;
                pullDone();
              },
            }), { headers: { "Content-Length": "100000" } });
          },
        });
        const ac = new AbortController();
        const reader = (await fetch(server.url, { signal: ac.signal })).body.getReader();
        await reader.read();
        ${stopFirst ? "const stopped = server.stop();" : ""}
        ac.abort();
        await reader.closed.catch(() => {});
        // The stop() promise resolves only once the abort tears the parked
        // context down. No Bun.gc before it: the abort itself has to do it.
        ${stopFirst ? "await stopped;" : "await server.stop();"}
        const pendingAfterStop = server.pendingRequests;
        server = undefined;
        Bun.gc(true);
        release();
        await pullExited;
        Bun.gc(true);
        console.log(JSON.stringify({ pendingAfterStop, pullExited: true }));
        `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ pendingAfterStop: 0, pullExited: true });
      expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });
    },
  );
}

test.concurrent("async server.upgrade() frees the context while the handler promise stays parked", async () => {
  // The upgrade detaches the response and disarms onAborted, so neither
  // on_abort nor an end path can run afterwards. The upgrade itself must
  // reclaim the cell's ref, or the held resolve parks the context forever.
  let capturedResolve: ((r: Response) => void) | undefined;
  let capturedPromise: Promise<Response> | undefined;
  const events: string[] = [];

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req, srv) {
      capturedPromise = new Promise<Response>(resolve => {
        capturedResolve = resolve;
        // Upgrade from a macrotask, so on_response parks the promise and
        // takes the cell ref before the upgrade runs.
        setImmediate(() => events.push(`upgrade ${srv.upgrade(req)}`));
      });
      return capturedPromise;
    },
    websocket: {
      open() {
        events.push("open");
      },
      message() {},
      close(_ws, code) {
        events.push(`close ${code}`);
      },
    },
  });

  const ws = new WebSocket(`ws://localhost:${server.port}/`);
  try {
    const { promise: opened, resolve: signalOpen, reject: failOpen } = Promise.withResolvers<void>();
    const { promise: closed, resolve: signalClose } = Promise.withResolvers<CloseEvent>();
    ws.onopen = () => signalOpen();
    ws.onclose = e => signalClose(e);
    ws.onerror = () => failOpen(new Error("websocket upgrade failed"));
    await opened;

    // Close the socket first: stop() also waits for open WebSockets. After
    // that, its resolution is exactly the context teardown the upgrade owes.
    ws.close();
    const closeEvent = await closed;
    expect([closeEvent.code, closeEvent.wasClean]).toEqual([1000, true]);
    await stopAndAssertDrained(server);
    // open() runs inside upgrade(), before it returns.
    expect(events).toEqual(["open", "upgrade true", "close 1000"]);

    // Resolving after the context is gone is a safe no-op: the reaction's
    // take() returns null. Awaiting the handler promise orders the assertion
    // after the native reaction, which was attached first.
    capturedResolve!(new Response("late"));
    await capturedPromise;
    capturedResolve = undefined;
    expect(server.pendingRequests).toBe(0);
  } finally {
    ws.close();
  }
});

test.concurrent("streaming 413 detaches the response so a late resolve/reject is a no-op", async () => {
  // Runs in a child process: before the fix, the late settle corked a uWS
  // response the 413 had already freed (heap-use-after-free under ASAN). The
  // fixture keeps that crash out of the test runner.
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-413-streaming-late-resolve-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(
    stdout
      .trim()
      .split("\n")
      .map(line => JSON.parse(line)),
  ).toEqual([
    {
      settle: "resolve",
      response: "HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n",
      bodyError: "Request body exceeded maxRequestBodySize",
      pendingAfter413: 0,
      outcome: "resolved",
      pendingAfterSettle: 0,
      errorCalls: 0,
      followUp: [200, "follow-up"],
    },
    {
      settle: "reject",
      response: "HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n",
      bodyError: "Request body exceeded maxRequestBodySize",
      pendingAfter413: 0,
      outcome: "rejected: late reject",
      pendingAfterSettle: 0,
      errorCalls: 0,
      followUp: [200, "follow-up"],
    },
  ]);
  expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });
});

test.concurrent("413 on a chunked upload frees the context while the handler promise stays parked", async () => {
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

  const socket = await openRawSocket(server.port);
  const response = readUntilClose(socket);
  socket.write(chunkedPostHead(server.port));
  await handlerEntered;

  // Keep writing chunks until the server closes the connection on us.
  const piece = Buffer.alloc(512, "A").toString("latin1");
  for (let sent = 0; sent < 4096 && !socket.destroyed; sent += piece.length) {
    await new Promise<void>(resolve => {
      if (socket.destroyed) return resolve();
      socket.write(piece.length.toString(16) + "\r\n" + piece + "\r\n", () => resolve());
    });
  }

  // The 413 carries no body and closes the connection. Its teardown ran before
  // the bytes reached us: the context is gone with the resolve still held.
  expect(await response).toBe("HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n");
  expect(server.pendingRequests).toBe(0);

  // The 413 closed the connection, so stop() waits only on the teardown.
  await stopAndAssertDrained(server);
  capturedResolve = undefined;
});

// A request subscribes to its connection's close only once its dispatch is
// over (to_async), so a close that lands before that was lost. server.stop(true)
// inside the handler closes the connection right there. A request with its body
// in flight then went async on the closed socket and was parked forever: no
// abort, a pending body read that never settled, pendingRequests stuck at 1,
// and a stop() promise that never resolved. A request without a body rendered
// a 204 into the closed socket instead of aborting.
const stoppedRequests: Array<[string, string, string[]]> = [
  ["a GET", "GET /stopped HTTP/1.1\r\nHost: example.com\r\n\r\n", ["abort http://example.com/stopped example.com"]],
  [
    "a POST with its body in flight",
    // Declares 1000 bytes and sends 10.
    "POST /stopped HTTP/1.1\r\nHost: example.com\r\nContent-Length: 1000\r\n\r\n0123456789",
    ["abort http://example.com/stopped example.com", "text rejected: AbortError"],
  ],
];
test.concurrent.each(stoppedRequests)(
  "server.stop(true) inside the handler of %s aborts it",
  async (_what, head, expected) => {
    const events: string[] = [];
    const { promise: reached, resolve: signalReached, reject: failReached } = Promise.withResolvers<void>();
    let stopped: Promise<void>;
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req, srv) {
        // url and headers are read lazily from inside the listener: an abort
        // delivered this way must still see them, like any other abort.
        req.signal.addEventListener("abort", () => events.push(`abort ${req.url} ${req.headers.get("host")}`), {
          once: true,
        });
        if (req.method === "POST") {
          req.text().then(
            () => events.push("text resolved"),
            e => events.push(`text rejected: ${(e as Error).name}`),
          );
        }
        stopped = srv.stop(true);
        signalReached();
        return new Promise<Response>(() => {});
      },
    });

    const client = connect(Number(server.port), "127.0.0.1", () => client.write(head));
    // A reset after the server closed the connection is expected; a failure
    // before the handler ran is not.
    client.on("error", failReached);

    await reached;
    // The abort is delivered as the dispatch finishes; an immediate queued from
    // inside it runs after that.
    await new Promise(resolve => setImmediate(resolve));
    expect(events).toEqual(expected);
    expect(server.pendingRequests).toBe(0);
    await stopped!;
  },
);
