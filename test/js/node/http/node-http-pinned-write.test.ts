import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Large enough to overflow both the 16KB cork buffer and the kernel send
// buffer on every platform (Windows loopback auto-tuning can absorb several
// MB), so the native write reports backpressure and the tail is held.
const CHUNK_SIZE = 64 * 1024 * 1024;

const PATTERN_256 = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
const PATTERN_64_HIGH = Buffer.from(Array.from({ length: 64 }, (_, i) => 0xc0 + i));

function makePayload(size: number): Buffer {
  return Buffer.alloc(size, PATTERN_256);
}

function sha1(buf: Uint8Array): string {
  return createHash("sha1").update(buf).digest("hex");
}

describe("node:http large Buffer writes are sent zero-copy", () => {
  test("the buffer backing store is pinned while the write is pending, then released on drain", async () => {
    const payload = makePayload(CHUNK_SIZE);
    const expectedChunkHash = sha1(payload);

    let detachedWhilePending: boolean | undefined;
    let detachedAfterDrain: boolean | undefined;
    let copyByteLength: number | undefined;
    let originalByteLength: number | undefined;
    let writableLengthAfterBackpressure: number | undefined;
    let chunksWritten = 0;
    let handlerError: unknown;

    await using server = http.createServer(async (req, res) => {
      try {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });

        // Loop until the kernel buffer fills and write() returns false. Bound
        // the attempts so a regression that never reports backpressure fails
        // fast instead of spinning.
        for (let i = 0; i < 8; i++) {
          chunksWritten++;
          if (!res.write(payload)) break;
        }
        // Only probe the pin when the native layer is actually holding a tail
        // (write() can also return false for the writableHighWaterMark check
        // with nothing buffered natively).
        writableLengthAfterBackpressure = res.writableLength;
        if (writableLengthAfterBackpressure === 0) return res.end();

        // While the tail is in-flight, the underlying ArrayBuffer is pinned so a
        // transfer() copies instead of detaching. Without the pin the server
        // would serve garbage for the bytes still to be written.
        const copy = payload.buffer.transfer();
        detachedWhilePending = payload.buffer.detached;
        copyByteLength = copy.byteLength;
        originalByteLength = payload.buffer.byteLength;

        await once(res, "drain");

        // After the tail has flushed the pin is released and transfer() detaches.
        payload.buffer.transfer();
        detachedAfterDrain = payload.buffer.detached;

        res.end();
      } catch (e) {
        handlerError = e;
        res.destroy();
      }
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://localhost:${port}/`);
    const body = Buffer.from(await response.arrayBuffer());

    expect(handlerError).toBeUndefined();
    expect(writableLengthAfterBackpressure).toBeGreaterThan(0);
    expect(body.length).toBe(CHUNK_SIZE * chunksWritten);
    // Every CHUNK_SIZE slice is the same cycling pattern; hash-compare to avoid
    // multi-million-iteration JS loops in debug builds.
    for (let i = 0; i < chunksWritten; i++) {
      expect(sha1(body.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE))).toBe(expectedChunkHash);
    }
    expect(copyByteLength).toBe(originalByteLength);
    expect(detachedWhilePending).toBe(false);
    expect(detachedAfterDrain).toBe(true);
  });

  test("Content-Length (non-chunked) path delivers the exact bytes", async () => {
    const payload = makePayload(CHUNK_SIZE);
    const expectedHash = sha1(payload);

    await using server = http.createServer(async (req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(CHUNK_SIZE * 2),
      });
      if (!res.write(payload)) await once(res, "drain");
      if (!res.write(payload)) await once(res, "drain");
      res.end();
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://localhost:${port}/`);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(CHUNK_SIZE * 2);
    expect(sha1(body.subarray(0, CHUNK_SIZE))).toBe(expectedHash);
    expect(sha1(body.subarray(CHUNK_SIZE))).toBe(expectedHash);
  });

  test("a second write before drain is ordered after the pending tail", async () => {
    const first = makePayload(CHUNK_SIZE);
    const firstHash = sha1(first);
    const second = Buffer.alloc(1024, 0xee);

    await using server = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(first.length + second.length),
      });
      res.write(first);
      // Deliberately do NOT wait for drain: the pending tail of `first` must
      // be spilled into backpressure so `second` lands after it.
      res.write(second);
      res.end();
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://localhost:${port}/`);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(first.length + second.length);
    expect(sha1(body.subarray(0, first.length))).toBe(firstHash);
    expect(Buffer.compare(body.subarray(first.length), second)).toBe(0);
  });

  test("large string writes (latin1 ascii, utf8 encoding) are held by reference", async () => {
    const payload = Buffer.alloc(CHUNK_SIZE, "a").toString("latin1");
    const expected = sha1(Buffer.alloc(CHUNK_SIZE * 2, "a"));

    await using server = http.createServer(async (req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      if (!res.write(payload)) await once(res, "drain");
      if (!res.write(payload)) await once(res, "drain");
      res.end();
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://localhost:${port}/`);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(CHUNK_SIZE * 2);
    expect(sha1(body)).toBe(expected);
  });

  test("large string writes with latin1 encoding deliver the exact bytes", async () => {
    // Bytes 0xc0..0xff are valid latin1 but not ascii; the encode path owns
    // the transcoded slice, so the zero-copy holder keeps that Vec alive.
    const raw = Buffer.alloc(CHUNK_SIZE, PATTERN_64_HIGH);
    const payload = raw.toString("latin1");
    const expectedHash = sha1(raw);

    await using server = http.createServer(async (req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(CHUNK_SIZE) });
      if (!res.write(payload, "latin1")) await once(res, "drain");
      res.end();
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://localhost:${port}/`);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(CHUNK_SIZE);
    expect(sha1(body)).toBe(expectedHash);
  });

  test("a client disconnect while a large write is draining releases the pin", async () => {
    // Run the server in a child so GC observations are isolated. After the
    // socket closes, mark_request_as_done must clear the cached
    // pendingWriteBuffer slot using the this_value captured at write time
    // (SOCKET_CLOSED makes get_this_value() return zero), so the Buffer is
    // collectable once the handler's closure releases it.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--expose-gc",
        "-e",
        `
        const http = require("node:http");
        const net = require("node:net");
        const { once } = require("node:events");
        const CHUNK_SIZE = ${CHUNK_SIZE};
        const PATTERN = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
        let weak;
        let detachedAfterClose;
        const server = http.createServer((req, res) => {
          const payload = Buffer.alloc(CHUNK_SIZE, PATTERN);
          weak = new WeakRef(payload.buffer);
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          res.write(payload);
          res.once("close", () => {
            // The close path unpinned the backing store, so transfer() detaches.
            payload.buffer.transfer();
            detachedAfterClose = payload.buffer.detached;
          });
        });
        await once(server.listen(0), "listening");
        const port = server.address().port;
        const s = net.connect(port, "127.0.0.1");
        await once(s, "connect");
        s.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
        await once(s, "data");
        s.destroy();
        // Wait for the server to observe the close.
        for (let i = 0; i < 50 && detachedAfterClose === undefined; i++) {
          await new Promise(r => setTimeout(r, 10));
        }
        console.log(JSON.stringify({ detachedAfterClose }));
        server.close();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.detachedAfterClose).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("a second write before drain releases the pin on the first buffer", async () => {
    let detachedAfterSecondWrite: boolean | undefined;
    const total = CHUNK_SIZE + 1024;

    await using server = http.createServer((req, res) => {
      const first = makePayload(CHUNK_SIZE);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(total),
      });
      res.write(first);
      res.write(Buffer.alloc(1024, 0xee));
      // The second write spilled first's tail into uWS backpressure and
      // released the pin, so transfer() detaches again.
      first.buffer.transfer();
      detachedAfterSecondWrite = first.buffer.detached;
      res.end();
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const body = await fetch(`http://localhost:${port}/`).then(r => r.arrayBuffer());
    expect(body.byteLength).toBe(total);
    expect(detachedAfterSecondWrite).toBe(true);
  });
});
