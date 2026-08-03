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

test("resolve() after abort does not crash and cleans up", async () => {
  // UAF safety: while the resolve function is reachable, the Promise stays
  // alive, the NativePromiseContext cell stays alive, and the RequestContext
  // stays alive. Calling resolve() after abort triggers onResolve, which sees
  // the aborted state, bails safely, and derefs.
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

  // While capturedResolve is held, the Promise (and its reaction, and the
  // cell, and the RequestContext) stay alive. This is the safety guarantee:
  // no UAF because the ctx outlives any possible resolve() call.
  Bun.gc(true);
  await Bun.sleep(0);
  expect(server.pendingRequests).toBe(1);

  // Resolving after abort: onResolve takes the ctx, handleResolve sees
  // isAbortedOrEnded() and bails, then derefs. Context is freed.
  capturedResolve!(new Response("very late"));
  capturedResolve = undefined;
  await waitForPendingRequests(server, 0);

  expect(server.pendingRequests).toBe(0);
});

test("pendingRequests drops when client aborts a parked direct-stream pull()", async () => {
  // readDirectStream's async-pull branch returns a promise chained off the user's pull()
  // promise. If the client disconnects while pull() is suspended on a promise that is
  // still rooted (e.g. the resolver is stashed in user state), that chain never settles,
  // so the NativePromiseContext reaction keeps the RequestContext at ref_count 1 until
  // the user releases the resolver. on_abort's sink branch bumps aborted_with_live_ctx so
  // the user-visible server.pendingRequests drops immediately; the structural
  // pending_requests (which gates deinit_if_we_can) still waits for the ctx to deinit.
  const parked: Array<() => void> = [];
  const pullEntered: Array<() => void> = [];

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(c) {
            c.write("x");
            await c.flush();
            pullEntered.shift()?.();
            await new Promise<void>(r => parked.push(r));
          },
        }),
        { headers: { "Content-Length": "100000" } },
      );
    },
  });

  const iterations = 3;
  for (let i = 0; i < iterations; i++) {
    const { promise: entered, resolve: markEntered } = Promise.withResolvers<void>();
    pullEntered.push(markEntered);
    const ac = new AbortController();
    const res = await fetch(server.url, { signal: ac.signal });
    const reader = res.body!.getReader();
    await reader.read();
    await entered;
    ac.abort();
    await reader.closed.catch(() => {});
  }

  // pull() is still suspended (its resolver is rooted in `parked`), so the
  // pull promise and its reaction chain are still alive. The getter must
  // nonetheless read 0 once on_abort has run.
  await waitForPendingRequests(server, 0);
  expect(parked.length).toBe(iterations);

  // Releasing the pull() resolver lets the reaction chain settle and deinit
  // the RequestContext; deinit balances aborted_with_live_ctx before
  // on_request_complete runs, so the getter stays at 0.
  for (const r of parked.splice(0)) r();
  await Bun.sleep(0);
  Bun.gc(true);
  await Bun.sleep(0);
  expect(server.pendingRequests).toBe(0);

  // A follow-up request proves pending_requests did not underflow.
  const ok = await fetch(server.url);
  await ok.body?.cancel();
  for (const r of parked.splice(0)) r();
  await waitForPendingRequests(server, 0);
});

for (const stopFirst of [true, false]) {
  test(`server stays alive while a parked direct-stream ctx outlives the abort (${stopFirst ? "stop-then-abort" : "abort-then-stop"})`, async () => {
    // The user-visible server.pendingRequests drops on abort, but the internal
    // pending_requests (which gates deinit_if_we_can's js_value downgrade)
    // stays > 0 until the RequestContext deinits. Both orderings of stop() vs
    // abort must leave the NewServer live until the parked ctx's backref is
    // released.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let release;
        let seenAbort;
        const gate = new Promise(r => (release = r));
        const abortSeen = new Promise(r => (seenAbort = r));
        let server = Bun.serve({
          port: 0,
          idleTimeout: 0,
          async fetch(req) {
            req.signal.addEventListener("abort", seenAbort, { once: true });
            return new Response(new ReadableStream({
              type: "direct",
              async pull(c) {
                c.write("x");
                await c.flush();
                await gate;
              },
            }), { headers: { "Content-Length": "100000" } });
          },
        });
        const port = server.port;
        const ac = new AbortController();
        const r = (await fetch("http://127.0.0.1:" + port, { signal: ac.signal })).body.getReader();
        await r.read();
        ${stopFirst ? "server.stop();" : ""}
        ac.abort();
        await r.closed.catch(() => {});
        await abortSeen;
        ${stopFirst ? "" : "server.stop();"}
        if (server.pendingRequests !== 0) throw new Error("pendingRequests=" + server.pendingRequests);
        server = undefined;
        for (let i = 0; i < 5; i++) { Bun.gc(true); await Bun.sleep(0); }
        release();
        for (let i = 0; i < 5; i++) { Bun.gc(true); await Bun.sleep(0); }
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

test("direct-stream pull() that resolves normally still releases exactly once", async () => {
  // The non-abort twin: pull() settles, handle_resolve_stream runs, deinit
  // calls on_request_complete once. A mismatched early decrement in on_abort
  // that leaked into the non-abort path would underflow pending_requests.
  using server = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(c) {
            c.write("hello");
            await c.flush();
            await Bun.sleep(0);
            c.write(" world");
          },
        }),
      );
    },
  });

  const res = await fetch(server.url);
  expect(await res.text()).toBe("hello world");
  expect(res.status).toBe(200);
  await waitForPendingRequests(server, 0);

  // A second request proves pending_requests did not underflow on the first.
  const res2 = await fetch(server.url);
  expect(await res2.text()).toBe("hello world");
  await waitForPendingRequests(server, 0);
});
