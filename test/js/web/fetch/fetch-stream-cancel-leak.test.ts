import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// Test that ReadableStream objects from cancelled fetch responses are properly GC'd.
//
// When a streaming HTTP response body is cancelled mid-stream, FetchTasklet's
// readable_stream_ref (a Strong GC root) is not released because:
//   1. ByteStream.onCancel() doesn't notify the FetchTasklet
//   2. The HTTP connection stays open, so has_more never becomes false
//   3. Bun__FetchResponse_finalize sees the Strong ref and skips cleanup
//
// This creates a circular dependency where the Strong ref prevents GC,
// and the GC finalizer skips cleanup because the Strong ref exists.

test("ReadableStream from fetch should be GC'd after reader.cancel()", async () => {
  // Use a raw TCP server to avoid server-side JS ReadableStream objects
  // that would add noise to objectTypeCounts.
  // The server sends one HTTP chunk immediately, then keeps the connection open.
  using server = Bun.listen({
    port: 0,
    hostname: "127.0.0.1",
    socket: {
      data(socket) {
        socket.write(
          "HTTP/1.1 200 OK\r\n" +
            "Transfer-Encoding: chunked\r\n" +
            "Connection: keep-alive\r\n" +
            "\r\n" +
            "400\r\n" +
            Buffer.alloc(0x400, "x").toString() +
            "\r\n",
        );
        // Don't send terminal chunk "0\r\n\r\n" — keep connection open
      },
      open() {},
      close() {},
      error() {},
    },
  });

  const url = `http://127.0.0.1:${server.port}/`;
  const N = 30;

  // Warmup: ensure JIT, lazy init, and connection pool are warmed up
  for (let i = 0; i < 5; i++) {
    const response = await fetch(url);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
  }

  Bun.gc(true);
  await Bun.sleep(10);
  Bun.gc(true);

  const baseline = heapStats().objectTypeCounts.ReadableStream ?? 0;

  // Main test: fetch, read one chunk, cancel, repeat N times
  for (let i = 0; i < N; i++) {
    const response = await fetch(url);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
  }

  // Allow finalizers to run, then GC aggressively
  Bun.gc(true);
  await Bun.sleep(50);
  Bun.gc(true);
  await Bun.sleep(50);
  Bun.gc(true);

  const after = heapStats().objectTypeCounts.ReadableStream ?? 0;
  const leaked = after - baseline;

  // With the bug: leaked ≈ N (each cancelled stream's Strong ref prevents GC)
  // When fixed: leaked should be near 0 (Strong ref released on cancel)
  expect(leaked).toBeLessThanOrEqual(5);
});

test("ReadableStream from fetch should be GC'd after body.cancel()", async () => {
  using server = Bun.listen({
    port: 0,
    hostname: "127.0.0.1",
    socket: {
      data(socket) {
        socket.write(
          "HTTP/1.1 200 OK\r\n" +
            "Transfer-Encoding: chunked\r\n" +
            "Connection: keep-alive\r\n" +
            "\r\n" +
            "400\r\n" +
            Buffer.alloc(0x400, "x").toString() +
            "\r\n",
        );
      },
      open() {},
      close() {},
      error() {},
    },
  });

  const url = `http://127.0.0.1:${server.port}/`;
  const N = 30;

  // Warmup
  for (let i = 0; i < 5; i++) {
    const response = await fetch(url);
    const reader = response.body!.getReader();
    await reader.read();
    reader.releaseLock();
    await response.body!.cancel();
  }

  Bun.gc(true);
  await Bun.sleep(10);
  Bun.gc(true);

  const baseline = heapStats().objectTypeCounts.ReadableStream ?? 0;

  // Main test: fetch, read, releaseLock, cancel body directly
  for (let i = 0; i < N; i++) {
    const response = await fetch(url);
    const reader = response.body!.getReader();
    await reader.read();
    reader.releaseLock();
    await response.body!.cancel();
  }

  Bun.gc(true);
  await Bun.sleep(50);
  Bun.gc(true);
  await Bun.sleep(50);
  Bun.gc(true);

  const after = heapStats().objectTypeCounts.ReadableStream ?? 0;
  const leaked = after - baseline;

  expect(leaked).toBeLessThanOrEqual(5);
});

test("response.body.cancel() on a never-read body aborts the underlying fetch", async () => {
  // Cancelling an unread response body must abort the native transfer, not resolve
  // while the client keeps draining. Runs in a subprocess so the unbounded stream
  // and RSS growth in the failing case are contained and cleaned up on exit.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let pulls = 0;
        let aborted = false;
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            req.signal.addEventListener("abort", () => (aborted = true));
            return new Response(
              new ReadableStream(
                { pull(c) { pulls++; c.enqueue(new Uint8Array(65536)); } },
                new CountQueuingStrategy({ highWaterMark: 1 }),
              ),
            );
          },
        });
        const res = await fetch(\`http://127.0.0.1:\${server.port}/\`);
        const deadline = performance.now() + 3000;
        // Let the server start pushing so the client has buffered bytes it never asked for.
        while (pulls === 0 && performance.now() < deadline) await Bun.sleep(1);
        const before = pulls;
        await res.body.cancel(new Error("nope"));
        // Poll for quiescence: once cancel has reached the transport, pulls stop growing.
        // Bail early if pulls run away so the failing case reports instead of timing out.
        let last = pulls;
        let stable = 0;
        while (stable < 5 && pulls - before < 2000 && performance.now() < deadline) {
          await Bun.sleep(10);
          if (pulls === last) stable++;
          else { stable = 0; last = pulls; }
        }
        const after = pulls - before;
        const timedOut = performance.now() >= deadline;
        console.log(JSON.stringify({ after, aborted, timedOut }));
        server.stop(true);
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { after, aborted, timedOut } = JSON.parse(stdout.trim());
  // When the cancel reaches the fetch tasklet the server sees the abort and pulls stop
  // within a bounded window. Without the fix the client keeps draining and `after`
  // grows into the thousands (the poll loop above never stabilizes).
  expect({ aborted, afterBounded: after < 200, timedOut, exitCode }).toEqual({
    aborted: true,
    afterBounded: true,
    timedOut: false,
    exitCode: 0,
  });
});

// Nothing holds the body any more, so it has to go away: once the unread bytes reach the
// client's high-water mark the fetch parks the stream (stops rooting it), the stream is
// collected, and the fetch behind it is aborted, in whatever state it was dropped. Before, the
// fetch rooted its own stream until the body ended and buffered the rest of it, so against a
// body that does not end, the stream, the connection, and the buffered bytes all lived until
// the process exited.
describe("an abandoned fetch body stream is collected and its fetch is aborted", () => {
  const shapes: [string, (res: Response, parked: () => Promise<void>) => Promise<unknown>][] = [
    ["res.body touched", async res => res.body],
    [
      "one read(), then releaseLock()",
      async res => {
        const reader = res.body!.getReader();
        await reader.read();
        reader.releaseLock();
      },
    ],
    ["dropped while a reader holds the lock", res => res.body!.getReader().read()],
    // A read that takes only part of what the parked stream buffered must leave it parked.
    [
      "one read() after it parked",
      async (res, parked) => {
        void res.body;
        await parked();
        await res.body!.getReader().read();
      },
    ],
  ];

  for (const [name, shape] of shapes) {
    test(
      name,
      async () => {
        let aborted = 0;
        let pulls = 0;
        using server = Bun.serve({
          port: 0,
          fetch(req) {
            req.signal.addEventListener("abort", () => aborted++);
            return new Response(
              new ReadableStream({
                async pull(controller) {
                  pulls++;
                  await Bun.sleep(1);
                  controller.enqueue(new Uint8Array(64 * 1024));
                },
              }),
            );
          },
        });
        // The client stopped taking bytes: the server is no longer pulled.
        async function parked() {
          let last = -1;
          for (let stable = 0; stable < 5; ) {
            await Bun.sleep(10);
            stable = pulls === last ? stable + 1 : 0;
            last = pulls;
          }
        }
        const N = 20;
        // Its own frame, so that nothing on this one still refers to a response afterwards.
        async function abandonOne() {
          await shape(await fetch(server.url), parked);
        }
        for (let i = 0; i < N; i++) await abandonOne();

        // Bounds the failing case only; the fixed build is done in well under a second.
        const deadline = performance.now() + (isASAN || isDebug ? 15_000 : 3000);
        while (aborted < N && performance.now() < deadline) {
          Bun.gc(true);
          await Bun.sleep(10);
        }
        // A few can survive a collection through stale stack slots (conservative scanning);
        // the rest must go. Unfixed, none of them do.
        expect(N - aborted).toBeLessThan(N / 4);
      },
      30_000,
    );
  }
});

// A fetch body handed to something that takes it natively, here a `Bun.serve` response that
// proxies it. When that response's own client goes away, the fetch behind the body has to be
// aborted with it: the body is locked to the response, so nothing else can read the rest.
// Before, the response only let go of the body, and the fetch sat paused on its connection
// (one upstream connection leaked per proxy client that went away).
describe("a proxied fetch body is aborted once the response's client is gone", () => {
  const CHUNK = 64 * 1024;
  // More than loopback socket buffers absorb, so a client that reads nothing backpressures
  // the whole chain. Finite, so a build that keeps draining stays bounded.
  const CHUNKS = 512;

  const shapes: [string, (upstream: Response) => Response][] = [
    // Goes through the JS pump; passes before and after, it is here so both spellings stay covered.
    ["new Response(upstream.body)", upstream => new Response(upstream.body)],
    // The native pipe.
    ["the upstream Response itself", upstream => upstream],
  ];

  function servers(proxyResponse: (upstream: Response) => Response) {
    const state = { pulls: 0, upstreamAborted: false, clientGone: Promise.withResolvers<void>() };
    const upstream = Bun.serve({
      port: 0,
      fetch(req) {
        req.signal.addEventListener("abort", () => (state.upstreamAborted = true));
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (++state.pulls <= CHUNKS) {
                controller.enqueue(new Uint8Array(CHUNK));
                return;
              }
              // Out of data, but the body is not over: the upstream is still mid-body.
              return new Promise<void>(() => {});
            },
          }),
        );
      },
    });
    const proxy = Bun.serve({
      port: 0,
      async fetch(req) {
        req.signal.addEventListener("abort", () => state.clientGone.resolve());
        return proxyResponse(await fetch(upstream.url));
      },
    });
    return {
      state,
      proxy,
      [Symbol.dispose]() {
        proxy.stop(true);
        upstream.stop(true);
      },
    };
  }

  async function expectUpstreamAborted(state: { upstreamAborted: boolean }) {
    // Bounds the failing case only; the fixed build aborts the upstream as the client goes.
    const deadline = performance.now() + (isASAN || isDebug ? 15_000 : 3000);
    while (!state.upstreamAborted && performance.now() < deadline) await Bun.sleep(10);
    expect(state.upstreamAborted).toBe(true);
  }

  for (const [name, proxyResponse] of shapes) {
    test(`${name}, client leaves while reading`, async () => {
      using chain = servers(proxyResponse);
      const { state } = chain;

      const client = new AbortController();
      const res = await fetch(chain.proxy.url, { signal: client.signal });
      const { value } = await res.body!.getReader().read();
      expect(value!.byteLength).toBeGreaterThan(0);
      client.abort();
      await state.clientGone.promise;

      await expectUpstreamAborted(state);
    });

    test(`${name}, client leaves without reading`, async () => {
      using chain = servers(proxyResponse);
      const { state } = chain;

      const client = new AbortController();
      const res = await fetch(chain.proxy.url, { signal: client.signal });
      expect(res.status).toBe(200);
      // Nothing reads: wait for the upstream to stop being pulled, which is the chain
      // backpressured end to end (or, on a build that drains, out of data).
      let last = -1;
      for (let stable = 0; stable < 5; ) {
        await Bun.sleep(20);
        if (state.pulls === last) {
          stable++;
        } else {
          stable = 0;
          last = state.pulls;
        }
      }
      client.abort();
      await state.clientGone.promise;

      await expectUpstreamAborted(state);
    });
  }
});
