import type { Server } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { connect, type Socket } from "node:net";
import { join } from "node:path";

// The teardown condition, with no timers and no GC: server.stop() resolves
// only once pendingRequests reaches 0 and every connection is gone. On an
// unfixed build a parked context pins the count, so this await never settles
// and the test times out.
async function stopAndAssertDrained(server: ReturnType<typeof Bun.serve>) {
  await server.stop();
  expect(server.pendingRequests).toBe(0);
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
  const p = fetch(server.url, { signal: ac.signal }).catch(() => {});
  await handlerEntered;
  ac.abort();
  await p;
  await stopAndAssertDrained(server);

  expect(aborted).toBe(true);
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

  await stopAndAssertDrained(server);
}, 15_000);

test("client abort frees the context even while the resolve function stays reachable", async () => {
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
  const p = fetch(server.url, { signal: ac.signal }).catch(() => {});
  await handlerEntered;
  ac.abort();
  await p;
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
    await stopAndAssertDrained(server);
    pumpHold = undefined;
  },
);

test("pendingRequests drops when the client aborts a parked direct-stream pull(), and the late pull() settle is a no-op", async () => {
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
});

// Between the abort and the late settle, the server itself goes away: stop()
// (issued before or after the abort) plus pendingRequests reaching 0 lets the
// server release its JS wrapper, and dropping the last reference lets GC free
// it. Releasing the parked pull() after that must still be a no-op.
for (const stopFirst of [true, false]) {
  test(`releasing a parked pull() after the abort tore down the context and the server is a no-op (${stopFirst ? "stop-then-abort" : "abort-then-stop"})`, async () => {
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
        if (server.pendingRequests !== 0) throw new Error("pendingRequests=" + server.pendingRequests);
        server = undefined;
        Bun.gc(true);
        release();
        await pullExited;
        Bun.gc(true);
        console.log("ok");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });
}

test("async server.upgrade() frees the context while the handler promise stays parked", async () => {
  // The upgrade detaches the response and disarms onAborted, so neither
  // on_abort nor an end path can run afterwards. The upgrade itself must
  // reclaim the cell's ref, or the held resolve parks the context forever.
  let capturedResolve: ((r: Response) => void) | undefined;
  let capturedPromise: Promise<Response> | undefined;

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req, srv) {
      capturedPromise = new Promise<Response>(resolve => {
        capturedResolve = resolve;
        // Upgrade from a macrotask, so on_response parks the promise and
        // takes the cell ref before the upgrade runs.
        setImmediate(() => srv.upgrade(req));
      });
      return capturedPromise;
    },
    websocket: {
      message() {},
    },
  });

  const ws = new WebSocket(`ws://localhost:${server.port}/`);
  try {
    const { promise: opened, resolve: signalOpen, reject: failOpen } = Promise.withResolvers<void>();
    const { promise: closed, resolve: signalClose } = Promise.withResolvers<void>();
    ws.onopen = () => signalOpen();
    ws.onclose = () => signalClose();
    ws.onerror = () => failOpen(new Error("websocket upgrade failed"));
    await opened;

    // Close the socket first: stop() also waits for open WebSockets. After
    // that, its resolution is exactly the context teardown the upgrade owes.
    ws.close();
    await closed;
    await stopAndAssertDrained(server);

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
  try {
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("error", reject);
    });
    // The server closes the connection after the 413; EPIPE/ECONNRESET while
    // we are still writing chunks is the expected outcome.
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
    // The 413 closed the connection, so stop() waits only on the teardown.
    await stopAndAssertDrained(server);
    capturedResolve = undefined;
  } finally {
    socket.destroy();
  }
});

// A request subscribes to its connection's close only once its dispatch is
// over (to_async). A close dispatched before that was lost: request.signal
// never fired, the context stayed pending, and a Promise<Response> settling
// later rendered into the freed socket.

// server.stop(true) inside the handler closes the connection right there, with
// no nested event loop involved. A request with its body in flight then went
// async on the closed socket and was parked forever: no abort, a pending body
// read that never settled, pendingRequests stuck at 1, and a stop() promise
// that never resolved. A request without a body rendered a 204 into the closed
// socket instead of aborting.
const stoppedRequests: Array<[string, string, string[]]> = [
  ["a GET", "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n", ["abort"]],
  [
    "a POST with its body in flight",
    // Declares 1000 bytes and sends 10.
    "POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: 1000\r\n\r\n0123456789",
    ["abort", "text rejected: AbortError"],
  ],
];
test.each(stoppedRequests)("server.stop(true) inside the handler of %s aborts it", async (_what, head, expected) => {
  const events: string[] = [];
  const { promise: reached, resolve: signalReached } = Promise.withResolvers<void>();
  let stopped: Promise<void>;
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req, srv) {
      req.signal.addEventListener("abort", () => events.push("abort"), { once: true });
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
  client.on("error", () => {});

  await reached;
  // The abort is delivered as the dispatch finishes; an immediate queued from
  // inside it runs after that.
  await new Promise(resolve => setImmediate(resolve));
  expect(events).toEqual(expected);
  expect(server.pendingRequests).toBe(0);
  await stopped!;
});

// A synchronous wait on a promise runs the event loop from inside the
// dispatch, and that nested run can dispatch the close itself.
//
// Windows: the libuv backend frees the closed socket inside the nested run, and
// uWS's own request dispatch segfaults on it when the handler returns, with or
// without this fix. #40021 keeps it allocated until the outermost tick ends.
describe.todoIf(isWindows)("connection closed while the request is being dispatched", () => {
  type CloseWindow = (run: () => void) => void;
  const closeWindows: Array<[string, CloseWindow]> = [
    ["inside the handler", run => run()],
    ["in the handler's microtask checkpoint", run => queueMicrotask(run)],
  ];

  // The synchronous waits. bun:test's is how a test that does
  // `await expect(fetch(...)).rejects.toThrow()` from inside a handler's
  // microtask checkpoint hit this; Bun.build() waits on a plugin's async
  // setup() before it returns, so a handler that bundles on request hits it
  // outside of any test.
  type SyncWait = (promise: Promise<void>) => void;
  const expectResolves: SyncWait = promise => {
    expect(promise).resolves.toBeUndefined();
  };
  const buildWithAsyncPluginSetup: SyncWait = promise => {
    Bun.build({
      entrypoints: [join(import.meta.dir, "serve-close-during-dispatch-late-resolve-fixture.ts")],
      plugins: [{ name: "wait", setup: () => promise }],
    }).catch(() => {});
  };

  // One raw client whose connection the handler closes from inside the
  // dispatch. The client's 'close' needs the server's FIN, so when the
  // synchronous wait returns, the server side's close has been dispatched.
  function closingClient(closeWhen: CloseWindow, waitSync: SyncWait = expectResolves) {
    const { promise: closed, resolve: signalClosed } = Promise.withResolvers<void>();
    let client: Socket;
    let clientClosed: Promise<void>;
    return {
      send(server: Server, head: string) {
        client = connect(Number(server.port), "127.0.0.1", () => client.write(head));
        client.on("error", () => {});
        clientClosed = new Promise<void>(resolve => client.once("close", () => resolve()));
      },
      // Called from the handler (or error()).
      closeFromTheDispatch() {
        closeWhen(() => {
          client.end();
          waitSync(clientClosed);
          signalClosed();
        });
      },
      // `closed` settles from inside the dispatch. The abort is delivered as
      // the dispatch finishes, so wait for an immediate queued after it.
      async dispatchFinished() {
        await closed;
        await new Promise(resolve => setImmediate(resolve));
      },
    };
  }

  const GET = "GET /closed-during-dispatch HTTP/1.1\r\nHost: example.com\r\n\r\n";

  const handlerResults: Array<[string, () => Response | Promise<Response>]> = [
    ["a pending Promise<Response>", () => new Promise<Response>(() => {})],
    ["a Response", () => new Response("nobody is listening")],
  ];
  const handlerCases = closeWindows.flatMap(([where, closeWhen]) =>
    handlerResults.map(([what, result]) => [where, what, closeWhen, result] as const),
  );

  test.each(handlerCases)(
    "closed %s, handler returns %s: the request is aborted",
    async (_where, _what, closeWhen, result) => {
      const aborted: Array<{ url: string; host: string | null }> = [];
      const client = closingClient(closeWhen);
      using server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch(req) {
          // Read lazily from inside the listener: an abort delivered this way
          // must still see the request's url and headers, like any other abort.
          req.signal.addEventListener("abort", () => aborted.push({ url: req.url, host: req.headers.get("host") }), {
            once: true,
          });
          client.closeFromTheDispatch();
          return result();
        },
      });

      client.send(server, GET);
      await client.dispatchFinished();
      expect(aborted).toEqual([{ url: "http://example.com/closed-during-dispatch", host: "example.com" }]);
      await stopAndAssertDrained(server);
    },
  );

  test.each(closeWindows)(
    "closed %s while Bun.build() waits on a plugin's async setup(): the request is aborted",
    async (_where, closeWhen) => {
      const aborted: string[] = [];
      const client = closingClient(closeWhen, buildWithAsyncPluginSetup);
      using server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch(req) {
          req.signal.addEventListener("abort", () => aborted.push(req.url), { once: true });
          client.closeFromTheDispatch();
          return new Promise<Response>(() => {});
        },
      });

      client.send(server, GET);
      await client.dispatchFinished();
      expect(aborted).toEqual(["http://example.com/closed-during-dispatch"]);
      await stopAndAssertDrained(server);
    },
  );

  // The request body is still arriving and the handler has a read parked on
  // it: the abort has to reject that read as well (the context is not dead at
  // abort time, so this takes on_abort's other branch).
  test.each(closeWindows)(
    "closed %s while the body is in flight: the pending read rejects",
    async (_where, closeWhen) => {
      const events: string[] = [];
      const { promise: bodyRead, resolve: signalBodyRead } = Promise.withResolvers<string>();
      const client = closingClient(closeWhen);
      using server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch(req) {
          req.signal.addEventListener("abort", () => events.push("abort"), { once: true });
          req.text().then(
            () => signalBodyRead("resolved"),
            e => signalBodyRead(`rejected: ${(e as Error).name}`),
          );
          client.closeFromTheDispatch();
          return new Promise<Response>(() => {});
        },
      });

      // Declares 1000 bytes and sends 10, so the body stays in flight.
      client.send(server, "POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: 1000\r\n\r\n0123456789");
      await client.dispatchFinished();
      expect(events).toEqual(["abort"]);
      expect(await bodyRead).toBe("rejected: AbortError");
      await stopAndAssertDrained(server);
    },
  );

  // A stream body returned by the handler starts pulling in the checkpoint, so
  // a close inside its pull() is met like one in the checkpoint.
  test("closed inside the pull() of the handler's stream body: the request is aborted", async () => {
    const aborted: string[] = [];
    const client = closingClient(run => run());
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req) {
        req.signal.addEventListener("abort", () => aborted.push(req.url), { once: true });
        return new Response(
          new ReadableStream({
            pull() {
              client.closeFromTheDispatch();
              return new Promise<void>(() => {});
            },
          }),
        );
      },
    });

    client.send(server, GET);
    await client.dispatchFinished();
    expect(aborted).toEqual(["http://example.com/closed-during-dispatch"]);
    await stopAndAssertDrained(server);
  });

  // A stream body returned by error() starts pulling only while it is being
  // attached to the connection, after every earlier check: the close is met
  // by the attach itself.
  test("closed inside the pull() of error()'s stream body: the request is aborted", async () => {
    const aborted: string[] = [];
    const client = closingClient(run => run());
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req) {
        req.signal.addEventListener("abort", () => aborted.push(req.url), { once: true });
        throw new Error("handler failed");
      },
      error() {
        return new Response(
          new ReadableStream({
            pull() {
              client.closeFromTheDispatch();
              return new Promise<void>(() => {});
            },
          }),
        );
      },
    });

    client.send(server, GET);
    await client.dispatchFinished();
    expect(aborted).toEqual(["http://example.com/closed-during-dispatch"]);
    await stopAndAssertDrained(server);
  });

  // error() runs after the checkpoint, so a close dispatched inside it is met
  // once error() returns, whatever it returns. Either of these results would
  // otherwise hold the request open forever.
  const errorResults: Array<[string, () => Response | Promise<Response>]> = [
    ["a streaming Response", () => new Response(new ReadableStream({ pull: () => new Promise<void>(() => {}) }))],
    ["a pending Promise<Response>", () => new Promise<Response>(() => {})],
  ];
  test.each(errorResults)("closed inside error(), which returns %s: the request is aborted", async (_what, result) => {
    const aborted: string[] = [];
    const client = closingClient(run => run());
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req) {
        req.signal.addEventListener("abort", () => aborted.push(req.url), { once: true });
        throw new Error("handler failed");
      },
      error() {
        client.closeFromTheDispatch();
        return result();
      },
    });

    client.send(server, GET);
    await client.dispatchFinished();
    expect(aborted).toEqual(["http://example.com/closed-during-dispatch"]);
    await stopAndAssertDrained(server);
  });

  test("a Promise<Response> that settles after the close is a no-op", async () => {
    // In a subprocess: on an unfixed build the late resolve renders into the
    // socket uSockets freed at the end of the tick (heap-use-after-free under
    // ASAN), and the abort never fires.
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "serve-close-during-dispatch-late-resolve-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ abortCount: 1, pendingAfterResolve: 0 });
    expect(exitCode).toBe(0);
  });
});
