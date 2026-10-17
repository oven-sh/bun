import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

// Large enough to overflow both the 16KB cork buffer and the kernel send
// buffer on every platform (Windows loopback auto-tuning can absorb several
// MB), so the native write reports backpressure and the tail is held.
const CHUNK_SIZE = 64 * 1024 * 1024;

const PATTERN_256 = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
const PATTERN_64_HIGH = Buffer.from(Array.from({ length: 64 }, (_, i) => 0xc0 + i));

function makePayload(size: number): Buffer<ArrayBuffer> {
  return Buffer.alloc(size, PATTERN_256);
}

// A Buffer that already has an ArrayBuffer behind it: the pending write pins
// that ArrayBuffer, so transfer() copies rather than detaches while it is held.
function makeArrayBufferBackedPayload(size: number): Buffer<ArrayBuffer> {
  return Buffer.from(new ArrayBuffer(size)).fill(PATTERN_256);
}

function sha1(buf: Uint8Array): string {
  return createHash("sha1").update(buf).digest("hex");
}

describe("node:http large Buffer writes are sent zero-copy", () => {
  // Winsock auto-tunes its send buffer on loopback and will absorb the whole
  // payload in one nonblocking send(), so the pinned-tail state is never
  // reached on Windows (the bytes go straight to the kernel instead). The
  // correctness tests below still cover the write path there.
  test.skipIf(isWindows)(
    "an ArrayBuffer-backed buffer is pinned while the write is pending, then released on drain",
    async () => {
      const payload = makeArrayBufferBackedPayload(CHUNK_SIZE);
      const expectedHash = sha1(payload);

      let detachedWhilePending: boolean | undefined;
      let detachedAfterDrain: boolean | undefined;
      let copyByteLength: number | undefined;
      let originalByteLength: number | undefined;
      let handlerError: unknown;
      const serverReady = Promise.withResolvers<void>();

      await using server = http.createServer(async (req, res) => {
        try {
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(CHUNK_SIZE),
          });
          // The client is a paused net.Socket so the kernel send buffer fills
          // and write() reports native backpressure on every platform (Windows
          // loopback can otherwise absorb the whole payload in one send()).
          res.write(payload);

          // While the tail is in-flight, the underlying ArrayBuffer is pinned so a
          // transfer() copies instead of detaching. Without the pin the server
          // would serve garbage for the bytes still to be written.
          const copy = payload.buffer.transfer();
          detachedWhilePending = payload.buffer.detached;
          copyByteLength = copy.byteLength;
          originalByteLength = payload.buffer.byteLength;
          serverReady.resolve();

          await once(res, "drain");

          // After the tail has flushed the pin is released and transfer() detaches.
          payload.buffer.transfer();
          detachedAfterDrain = payload.buffer.detached;

          res.end();
        } catch (e) {
          handlerError = e;
          serverReady.resolve();
          res.destroy();
        }
      });
      await once(server.listen(0), "listening");
      const port = (server.address() as AddressInfo).port;

      const socket = net.connect(port, "127.0.0.1");
      await once(socket, "connect");
      socket.pause();
      socket.write(`GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      await serverReady.promise;

      // Now drain the client side and verify the body.
      const chunks: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      const closed = once(socket, "close");
      socket.resume();
      await closed;
      const received = Buffer.concat(chunks);

      expect(handlerError).toBeUndefined();
      const headerEnd = received.indexOf("\r\n\r\n");
      expect(headerEnd).toBeGreaterThan(0);
      const body = received.subarray(headerEnd + 4);
      expect(body.length).toBe(CHUNK_SIZE);
      expect(sha1(body)).toBe(expectedHash);
      expect(copyByteLength).toBe(originalByteLength);
      expect(detachedWhilePending).toBe(false);
      expect(detachedAfterDrain).toBe(true);
    },
  );

  // A plain Buffer has no ArrayBuffer until `.buffer` is touched, and the
  // pending write holds it without materializing one (doing so registers the
  // bytes with the GC a second time). transfer() mid-write therefore detaches,
  // as in Node, but it moves the storage rather than freeing it, so the bytes
  // still to be written reach the client intact.
  test.skipIf(isWindows)("a plain Buffer transferred while its write is pending still arrives intact", async () => {
    const payload = makePayload(CHUNK_SIZE);
    const expectedHash = sha1(payload);
    let detachedWhilePending: boolean | undefined;
    let moved: ArrayBuffer | undefined;
    let handlerError: unknown;
    const serverReady = Promise.withResolvers<void>();

    await using server = http.createServer(async (req, res) => {
      try {
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(CHUNK_SIZE) });
        res.write(payload);
        moved = payload.buffer.transfer();
        detachedWhilePending = payload.buffer.detached;
        serverReady.resolve();
        await once(res, "drain");
        res.end();
      } catch (e) {
        handlerError = e;
        serverReady.resolve();
        res.destroy();
      }
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;
    const socket = net.connect(port, "127.0.0.1");
    await once(socket, "connect");
    socket.pause();
    socket.write(`GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    await serverReady.promise;
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    const closed = once(socket, "close");
    socket.resume();
    await closed;
    const received = Buffer.concat(chunks);

    expect(handlerError).toBeUndefined();
    const body = received.subarray(received.indexOf("\r\n\r\n") + 4);
    expect(body.length).toBe(CHUNK_SIZE);
    expect(sha1(body)).toBe(expectedHash);
    expect(detachedWhilePending).toBe(true);
    expect(moved?.byteLength).toBe(CHUNK_SIZE);
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
    // Run in a child so the pin release on the close path is observed in
    // isolation: after 'close' fires the backing store is unpinned, so
    // transfer() detaches again.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const net = require("node:net");
        const { once } = require("node:events");
        const CHUNK_SIZE = ${CHUNK_SIZE};
        const PATTERN = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
        let detachedAfterClose;
        const server = http.createServer((req, res) => {
          const payload = Buffer.alloc(CHUNK_SIZE, PATTERN);
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
    const result = JSON.parse(stdout.trim());
    expect({ detachedAfterClose: result.detachedAfterClose, exitCode, stderr }).toEqual({
      detachedAfterClose: true,
      exitCode: 0,
      stderr: expect.any(String),
    });
  });

  // 8 MB overflows the Linux/macOS loopback send+recv buffers with a paused
  // client while keeping the spill + drain under the default test timeout.
  const RESIZABLE_CHUNK_SIZE = 8 * 1024 * 1024;
  const resizableChild = (afterWrite: string) => `
    const http = require("node:http");
    const net = require("node:net");
    const { once } = require("node:events");
    const { createHash } = require("node:crypto");
    const CHUNK_SIZE = ${RESIZABLE_CHUNK_SIZE};

    const ab = new ArrayBuffer(CHUNK_SIZE, { maxByteLength: CHUNK_SIZE });
    const payload = Buffer.from(ab);
    const pattern = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    for (let off = 0; off < CHUNK_SIZE; off += 256) payload.set(pattern, off);
    const expectedHash = createHash("sha1").update(payload).digest("hex");

    let detachedAfterWrite;
    const wrote = Promise.withResolvers();
    const server = http.createServer(async (req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(CHUNK_SIZE),
      });
      res.write(payload);
      ab.resize(1024);
      // The tail was copied, so the buffer is unpinned and transfer() detaches.
      try { ab.transfer(); } catch {}
      detachedAfterWrite = ab.detached;
      ${afterWrite}
    });
    await once(server.listen(0), "listening");
    const port = server.address().port;

    const socket = net.connect(port, "127.0.0.1");
    await once(socket, "connect");
    socket.pause();
    socket.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
    await wrote.promise;

    const chunks = [];
    socket.on("data", c => chunks.push(c));
    const closed = once(socket, "close");
    socket.resume();
    await closed;

    const received = Buffer.concat(chunks);
    const headerEnd = received.indexOf("\\r\\n\\r\\n");
    const body = received.subarray(headerEnd + 4);
    const bodyHash = createHash("sha1").update(body).digest("hex");
    console.log(JSON.stringify({
      detachedAfterWrite,
      bodyLength: body.length,
      hashMatches: bodyHash === expectedHash,
    }));
    server.close();
  `;

  test.skipIf(isWindows)("a resizable ArrayBuffer is copied into backpressure, not held by reference", async () => {
    // resize() mprotect()s trimmed pages PROT_NONE and pin() doesn't block
    // it, so a retained raw slice faults on spill / EFAULT-spins on drain.
    // Run in a child so the crash is observed as exit != 0.
    await using proc = Bun.spawn({
      // end() spills any held tail; memcpy from PROT_NONE if held by reference.
      cmd: [bunExe(), "-e", resizableChild(`wrote.resolve(); res.end();`)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({
      stdout: JSON.stringify({ detachedAfterWrite: true, bodyLength: RESIZABLE_CHUNK_SIZE, hashMatches: true }),
      stderr: expect.any(String),
    });
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("resizing a resizable ArrayBuffer after write() does not wedge drain", async () => {
    // Drain path: send() on PROT_NONE pages returns EFAULT -> 0 consumed ->
    // onWritable re-arms forever. `await using` kills the child on timeout.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", resizableChild(`wrote.resolve(); await once(res, "drain"); res.end();`)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({
      stdout: JSON.stringify({ detachedAfterWrite: true, bodyLength: RESIZABLE_CHUNK_SIZE, hashMatches: true }),
      stderr: expect.any(String),
    });
    expect(exitCode).toBe(0);
  });

  // The spill copies the pending tail into the uWS backpressure queue. The
  // chunk CRLF and the terminating chunk go right behind it. If that growth
  // fits the tail exactly, those few bytes grow the queue a second time and
  // copy the whole tail, so the server holds two copies of the body at once.
  // VmHWM is Linux only, and the test reads the peak of a child of its own.
  // 32 MiB keeps the transfer under the default timeout on a debug build.
  const PEAK_CHUNK_SIZE = 32 * 1024 * 1024;
  // The body of the response: a chunk size line, the chunk, its CRLF, and the
  // terminating chunk.
  const PEAK_FRAMED_SIZE = PEAK_CHUNK_SIZE.toString(16).length + 2 + PEAK_CHUNK_SIZE + 2 + 5;
  // Measured with the fix: 1.03 on a release build, 1.14 on a debug ASAN
  // build. Without it: 2.04 and 2.21. The sanitizer allocator adds the slack.
  const PEAK_RATIO_BOUND = isASAN || isDebug ? 1.5 : 1.3;
  test.skipIf(!isLinux)("the framing behind a spilled tail does not copy the tail again", async () => {
    using dir = tempDir("pinned-write-peak", {});
    const socketPath = `${dir}/s`;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require("node:fs");
        const http = require("node:http");
        const net = require("node:net");
        const { once } = require("node:events");
        const CHUNK_SIZE = ${PEAK_CHUNK_SIZE};
        // A unix socket takes about 200 KB, so the rest of the body waits.
        const SOCKET = ${JSON.stringify(socketPath)};
        const peakBytes = () => Number(/VmHWM:\\s+(\\d+)/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]) * 1024;
        // VmHWM never falls, so an earlier peak would hide the copies. Writing
        // 5 to clear_refs sets it back to what is resident now.
        const resetPeak = () => fs.writeFileSync("/proc/self/clear_refs", "5");

        const wrote = Promise.withResolvers();
        const ended = Promise.withResolvers();
        let baseline = 0;
        let peakOverBaseline = 0;
        const server = http.createServer((req, res) => {
          resetPeak();
          baseline = peakBytes();
          // Zero pages are not resident, so the peak counts the copies only.
          // No Content-Length: chunked framing is what follows the tail.
          res.write(Buffer.alloc(CHUNK_SIZE));
          req.on("end", () => {
            // uWS has the socket corked while it reads the request body.
            res.end();
            peakOverBaseline = peakBytes() - baseline;
            ended.resolve();
          });
          req.resume();
          wrote.resolve();
        });
        await once(server.listen(SOCKET), "listening");

        const socket = net.connect(SOCKET);
        await once(socket, "connect");
        socket.pause();
        socket.write("POST / HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: 5\\r\\nConnection: close\\r\\n\\r\\nhe");
        await wrote.promise;
        socket.write("llo");
        await ended.promise;

        let head = Buffer.alloc(0);
        let framedBytes = 0;
        socket.on("data", chunk => {
          if (head === undefined) return void (framedBytes += chunk.length);
          head = Buffer.concat([head, chunk]);
          const i = head.indexOf("\\r\\n\\r\\n");
          if (i === -1) return;
          framedBytes = head.length - (i + 4);
          head = undefined;
        });
        socket.resume();
        await once(socket, "close");
        server.close();
        console.log(JSON.stringify({ framedBytes, ratio: Math.round((peakOverBaseline / CHUNK_SIZE) * 100) / 100 }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const { framedBytes, ratio } = JSON.parse(stdout.trim());
    // One copy of the tail is a ratio of 1.0, two copies 2.0.
    expect({ framedBytes, peakUnderBound: ratio < PEAK_RATIO_BOUND, ratio }).toEqual({
      framedBytes: PEAK_FRAMED_SIZE,
      peakUnderBound: true,
      ratio: expect.any(Number),
    });
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
