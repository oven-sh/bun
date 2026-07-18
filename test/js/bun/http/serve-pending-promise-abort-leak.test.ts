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

// Each test owns its own server/subprocess with no shared state, so run them concurrently.
test.concurrent("RequestContext is freed when client aborts before Promise<Response> settles", async () => {
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
  expect(await res.text()).toBe("hello");
  expect(res.status).toBe(200);
  expect(server.pendingRequests).toBe(0);
});

test.concurrent("resolve() inside abort handler is handled safely", async () => {
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

test.concurrent(
  "streaming 413 detaches the response so a late resolve/reject is a no-op",
  async () => {
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
  },
  30_000,
);

test.concurrent(
  "chunked request body consumed as a ReadableStream is capped at maxRequestBodySize",
  async () => {
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
  },
  15_000,
);

test.concurrent("resolve() after abort does not crash and cleans up", async () => {
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
