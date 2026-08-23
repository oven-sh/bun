import { S3Client } from "bun";
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// Test that ReadableStream objects from cancelled S3 download streams are properly GC'd.
//
// When a streaming S3 download body is cancelled mid-stream, S3DownloadStreamWrapper's
// readable_stream_ref (a Strong GC root) is not released because:
//   1. ByteStream.onCancel() doesn't notify the S3DownloadStreamWrapper
//   2. The S3 download continues in the background, so has_more never becomes false
//   3. The Strong ref prevents GC of the ReadableStream
//
// This is the same pattern as the FetchTasklet stream cancel leak.

test("ReadableStream from S3 stream() should be GC'd after reader.cancel()", async () => {
  // Use a raw TCP server to mock an S3 GET response.
  // The server sends one HTTP chunk immediately, then keeps the connection open
  // to simulate a large file download in progress.
  using server = Bun.listen({
    port: 0,
    hostname: "127.0.0.1",
    socket: {
      data(socket) {
        // Respond to any incoming request with a chunked 200 OK
        socket.write(
          "HTTP/1.1 200 OK\r\n" +
            "Transfer-Encoding: chunked\r\n" +
            "Connection: keep-alive\r\n" +
            "Content-Type: application/octet-stream\r\n" +
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

  const s3 = new S3Client({
    accessKeyId: "test",
    secretAccessKey: "test",
    endpoint: `http://127.0.0.1:${server.port}`,
    bucket: "test",
  });

  const N = 30;

  // Warmup: ensure JIT, lazy init, and connection pool are warmed up
  for (let i = 0; i < 5; i++) {
    const file = s3.file(`warmup-${i}.bin`);
    const stream = file.stream();
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
  }

  Bun.gc(true);
  await Bun.sleep(10);
  Bun.gc(true);

  const baseline = heapStats().objectTypeCounts.ReadableStream ?? 0;

  // Main test: stream, read one chunk, cancel, repeat N times
  for (let i = 0; i < N; i++) {
    const file = s3.file(`test-${i}.bin`);
    const stream = file.stream();
    const reader = stream.getReader();
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

test("S3 error code/message are not leaked", async () => {
  const code = /* js */ `
    const big = "m".repeat(256 * 1024);
    let n = 0;
    const server = Bun.serve({ port: 0, fetch() { return new Response("<?xml version=\\"1.0\\"?><Error><Code>NoSuchKey" + (n++) + "</Code><Message>" + big + (n++) + "</Message></Error>", { status: 404, headers: { "content-type": "application/xml" } }); } });
    const client = new Bun.S3Client({ endpoint: server.url.href, accessKeyId: "a", secretAccessKey: "b", bucket: "b" });
    for (let i = 0; i < 10; i++) await client.file("k").text().catch(e => e);
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 150; i++) await client.file("k").text().catch(e => e);
    Bun.gc(true);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
    server.stop(true);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", code],
    env: {
      ...bunEnv,
      // ASAN's quarantine pins freed blocks and keeps RSS at peak.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { deltaMiB } = JSON.parse(stdout.trim());
  // Unfixed: ~47 MiB. Fixed: allocator slack only.
  expect(deltaMiB).toBeLessThan(isASAN || isDebug ? 45 : 25);
  expect(exitCode).toBe(0);
});
