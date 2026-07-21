import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { after, aborted, timedOut } = JSON.parse(stdout.trim());
  // When the cancel reaches the fetch tasklet the server sees the abort and pulls stop
  // within a bounded window. Without the fix the client keeps draining and `after`
  // grows into the thousands (the poll loop above never stabilizes).
  expect({ aborted, afterBounded: after < 200, timedOut }).toEqual({
    aborted: true,
    afterBounded: true,
    timedOut: false,
  });
  expect(exitCode).toBe(0);
});
