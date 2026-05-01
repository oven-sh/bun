import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";

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
