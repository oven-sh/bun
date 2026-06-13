import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import net from "node:net";
import { join } from "node:path";

// Bun.write(Bun.file(localPath), s3file) — the S3-download-to-disk path.
// Uses a local fake S3 endpoint (same pattern as s3-insecure.test.ts) so the
// pipe is exercised without docker.
describe("Bun.write(Bun.file(path), s3file)", () => {
  const SIZE = 4 * 1024 * 1024;
  const payload = new Uint8Array(SIZE);
  for (let i = 0; i < SIZE; i++) payload[i] = (i * 17) & 0xff;

  function makeClient(origin: string) {
    return new S3Client({
      endpoint: origin,
      bucket: "test-bucket",
      accessKeyId: "test",
      secretAccessKey: "test",
      region: "us-east-1",
    });
  }

  it("writes the object's bytes to the local file", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response(payload, { headers: { "Content-Length": String(SIZE) } }),
    });
    using dir = tempDir("s3-write-local", {});
    const dest = join(String(dir), "download.bin");

    // resolves with 0 for ReadableStream-backed sources (including S3), on
    // every platform — parity with the JS streaming loop
    expect(await Bun.write(Bun.file(dest), makeClient(server.url.origin).file("some-key"))).toBe(0);

    const got = await Bun.file(dest).bytes();
    expect(got.byteLength).toBe(SIZE);
    expect(Buffer.compare(got, payload)).toBe(0);
  });

  it("rejects when the object stream dies mid-body", async () => {
    const raw = net.createServer(socket => {
      socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${SIZE}\r\n\r\n`);
      // destroy as soon as the first half has been flushed to the socket
      socket.write(Buffer.alloc(SIZE / 2, 0x42), () => socket.destroy());
    });
    await new Promise<void>(resolve => raw.listen(0, () => resolve()));
    const port = (raw.address() as net.AddressInfo).port;
    using dir = tempDir("s3-write-local-err", {});
    const dest = join(String(dir), "partial.bin");

    try {
      await expect(Bun.write(Bun.file(dest), makeClient(`http://127.0.0.1:${port}`).file("k"))).rejects.toThrow();
    } finally {
      raw.close();
    }
  });

  // Regression test for the `endFromJS`-returns-a-pending-Promise arm: the
  // final flush settles through host functions attached with JSValue.then(),
  // which must be registered in GlobalObject::promiseHandlerID — an
  // unregistered handler is a RELEASE_ASSERT (the process aborts with no
  // output). On Windows every FileSink write is an async libuv request, so
  // the plain to-disk test above covers it there; on POSIX a regular-file
  // flush completes synchronously, so force the pending arm with a pipe
  // destination instead. (Skipped on Windows: an fd-1 destination takes the
  // synchronous stdout path there, which would block the child's event loop.)
  it.skipIf(isWindows)("settles when the final flush is still pending at stream end", async () => {
    const childScript = `
      const client = new Bun.S3Client({
        endpoint: process.env.S3_ENDPOINT,
        bucket: "test-bucket",
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "us-east-1",
      });
      // fd 1 is a pipe (~64KB) that the parent is not draining yet, so the
      // FileSink still has most of the body buffered when the last network
      // chunk arrives.
      const n = await Bun.write(Bun.file(1), client.file("big.bin"));
      if (n !== 0) {
        console.error("unexpected resolve value: " + n);
        process.exit(1);
      }
    `;

    const { promise: bodySent, resolve: bodySentResolve } = Promise.withResolvers<void>();
    let responded = false;
    const raw = net.createServer(socket => {
      socket.on("data", () => {
        if (responded) return;
        responded = true;
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${SIZE}\r\n\r\n`);
        // the write callback fires once the whole payload has been flushed
        // into the socket, i.e. the child has consumed (nearly) all of it
        socket.write(payload, () => socket.end(() => bodySentResolve()));
      });
    });
    await new Promise<void>(resolve => raw.listen(0, () => resolve()));
    const port = (raw.address() as net.AddressInfo).port;

    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", childScript],
        env: { ...bunEnv, S3_ENDPOINT: `http://127.0.0.1:${port}` },
        stdout: "pipe",
        stderr: "inherit",
      });

      // Hold off draining the child's stdout until the entire body (plus EOF)
      // has left the server, guaranteeing the child's FileSink still has
      // buffered data when it processes the final chunk → endFromJS returns a
      // pending Promise.
      await bodySent;

      let got = 0;
      for await (const chunk of proc.stdout) got += chunk.length;
      expect(got).toBe(SIZE);
      expect(await proc.exited).toBe(0);
    } finally {
      raw.close();
    }
  });

  // A destination write error mid-stream (EPIPE: the reader of the child's
  // fd-1 pipe goes away) must reject Bun.write — not resolve with a bogus
  // count while the network keeps downloading into a dead sink. The JS
  // streaming loop this pipe replaced surfaced the failure as an unhandled
  // rejection; the native pipe rejects the Bun.write promise directly.
  it.skipIf(isWindows)("rejects when the destination pipe breaks mid-stream", async () => {
    const childScript = `
      const client = new Bun.S3Client({
        endpoint: process.env.S3_ENDPOINT,
        bucket: "test-bucket",
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "us-east-1",
      });
      try {
        await Bun.write(Bun.file(1), client.file("big.bin"));
        process.exit(42); // resolved — the broken pipe went unnoticed
      } catch (e) {
        process.exit(7); // rejected — correct
      }
    `;

    // Two-phase body so the child is deterministically mid-body when the
    // parent walks away: send a prefix, hold the rest until the parent has
    // abandoned the child's stdout pipe, then send the remainder so the
    // pipe sees chunks after the destination died.
    const { promise: parentCancelled, resolve: parentCancelledResolve } = Promise.withResolvers<void>();
    const raw = net.createServer(socket => {
      let responded = false;
      socket.on("data", () => {
        if (responded) return;
        responded = true;
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${SIZE}\r\n\r\n`);
        socket.write(payload.subarray(0, 256 * 1024), () => {
          parentCancelled.then(() => {
            if (socket.destroyed) return;
            socket.write(payload.subarray(256 * 1024), () => socket.end());
          });
        });
      });
      socket.on("error", () => {});
    });
    await new Promise<void>(resolve => raw.listen(0, () => resolve()));
    const port = (raw.address() as net.AddressInfo).port;

    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", childScript],
        env: { ...bunEnv, S3_ENDPOINT: `http://127.0.0.1:${port}` },
        stdout: "pipe",
        stderr: "inherit",
      });

      // Read a little of the child's output, then abandon the pipe: the
      // child's next flush into fd 1 fails with EPIPE.
      const reader = proc.stdout.getReader();
      let got = 0;
      while (got < 16 * 1024) {
        const { value, done } = await reader.read();
        if (done) break;
        got += value.length;
      }
      await reader.cancel();
      parentCancelledResolve();

      expect(await proc.exited).toBe(7);
    } finally {
      raw.close();
    }
  });

  // When the source stream errors while the sink still has an in-flight or
  // buffered write (common on pipe destinations and on Windows, where every
  // FileSink write is an async libuv request), the rejection path must also
  // tear the writer down. `FileSink::end`'s Pending arm leaves the writer
  // running for a pending JS write that pipe mode never has, so without the
  // explicit `writer.end()` in `FileSinkPipe::finish`'s error arm the sink's
  // keep-alive ref (and fd) leaked.
  it.skipIf(isWindows)("releases the FileSink when the stream dies with writes in flight", async () => {
    const childScript = `
      const { fileSinkInternals } = require("bun:internal-for-testing");
      const client = new Bun.S3Client({
        endpoint: process.env.S3_ENDPOINT,
        bucket: "test-bucket",
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "us-east-1",
      });
      const baseline = fileSinkInternals.liveCount();
      try {
        // fd 1 is a pipe the parent never drains, so writes stay buffered
        // when the source connection is severed mid-body.
        await Bun.write(Bun.file(1), client.file("big.bin"));
        process.exit(42); // resolved — must reject
      } catch (e) {
        for (let i = 0; i < 20 && fileSinkInternals.liveCount() > baseline; i++) {
          Bun.gc(true);
          await Bun.sleep(0); // macrotask barrier, not a timing wait
        }
        process.exit(fileSinkInternals.liveCount() > baseline ? 9 : 7);
      }
    `;

    const raw = net.createServer(socket => {
      let responded = false;
      socket.on("data", () => {
        if (responded) return;
        responded = true;
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${SIZE}\r\n\r\n`);
        // sever the connection once a partial body has been flushed
        socket.write(payload.subarray(0, SIZE / 2), () => socket.destroy());
      });
      socket.on("error", () => {});
    });
    await new Promise<void>(resolve => raw.listen(0, () => resolve()));
    const port = (raw.address() as net.AddressInfo).port;

    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", childScript],
        env: { ...bunEnv, S3_ENDPOINT: `http://127.0.0.1:${port}` },
        stdout: "pipe",
        stderr: "inherit",
      });

      // exit 7 = rejected and the FileSink was released;
      // exit 9 = rejected but the FileSink leaked; exit 42 = resolved
      expect(await proc.exited).toBe(7);
    } finally {
      raw.close();
    }
  });
});
