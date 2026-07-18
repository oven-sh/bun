import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { createHash } from "node:crypto";
import { once } from "node:events";
import net from "node:net";

// Large enough to overflow both the 16KB cork buffer and the kernel send
// buffer on loopback, so tryWriteBody reports a partial accept and the tail
// is held by reference.
const CHUNK_SIZE = 64 * 1024 * 1024;

const PATTERN_256 = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

function makePayload(size: number): Buffer {
  return Buffer.alloc(size, PATTERN_256);
}

function sha1(buf: Uint8Array): string {
  return createHash("sha1").update(buf).digest("hex");
}

describe("Bun.serve direct-stream large Buffer writes are sent zero-copy", () => {
  // Winsock auto-tunes its send buffer on loopback and will absorb the whole
  // payload in one nonblocking send(), so the pinned-tail state is never
  // reached on Windows (the bytes go straight to the kernel instead). The
  // correctness tests below still cover the write path there.
  test.skipIf(isWindows)(
    "the buffer backing store is pinned while the write is pending, then released on drain",
    async () => {
      const payload = makePayload(CHUNK_SIZE);
      const expectedHash = sha1(payload);

      let detachedWhilePending: boolean | undefined;
      let detachedAfterDrain: boolean | undefined;
      let wroteResult: number | undefined;
      let handlerError: unknown;
      const serverReady = Promise.withResolvers<void>();

      await using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(controller: any) {
                try {
                  // The client is a paused net.Socket so the kernel send
                  // buffer fills and write() reports native backpressure.
                  wroteResult = controller.write(payload);

                  // While the tail is in-flight, the underlying ArrayBuffer is
                  // pinned so transfer() copies instead of detaching. Without
                  // the pin the server would serve garbage for the bytes still
                  // to be written.
                  payload.buffer.transfer();
                  detachedWhilePending = payload.buffer.detached;
                  serverReady.resolve();

                  await controller.flush(true);

                  // After the tail has flushed the pin is released and
                  // transfer() detaches again.
                  payload.buffer.transfer();
                  detachedAfterDrain = payload.buffer.detached;

                  controller.end();
                } catch (e) {
                  handlerError = e;
                  try {
                    controller.end();
                  } catch {}
                  serverReady.resolve();
                }
              },
            } as any),
          );
        },
      });

      const socket = net.connect(server.port, "127.0.0.1");
      await once(socket, "connect");
      socket.pause();
      socket.write(`GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      await serverReady.promise;

      const chunks: Buffer[] = [];
      socket.on("data", chunk => chunks.push(chunk));
      const closed = once(socket, "close");
      socket.resume();
      await closed;
      const received = Buffer.concat(chunks);

      expect(handlerError).toBeUndefined();
      // write() returns -(len+1) under backpressure.
      expect(wroteResult).toBeLessThan(0);
      const headerEnd = received.indexOf("\r\n\r\n");
      expect(headerEnd).toBeGreaterThan(0);
      const body = dechunk(received.subarray(headerEnd + 4));
      expect(body.length).toBe(CHUNK_SIZE);
      expect(sha1(body)).toBe(expectedHash);
      expect(detachedWhilePending).toBe(false);
      expect(detachedAfterDrain).toBe(true);
    },
  );

  test("two large chunked writes deliver the exact bytes", async () => {
    const payload = makePayload(CHUNK_SIZE);
    const expectedHash = sha1(payload);

    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller: any) {
              if (controller.write(payload) < 0) await controller.flush(true);
              if (controller.write(payload) < 0) await controller.flush(true);
              controller.end();
            },
          } as any),
        );
      },
    });

    const response = await fetch(server.url);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(CHUNK_SIZE * 2);
    expect(sha1(body.subarray(0, CHUNK_SIZE))).toBe(expectedHash);
    expect(sha1(body.subarray(CHUNK_SIZE))).toBe(expectedHash);
  });

  test("a second write before drain is ordered after the pending tail", async () => {
    const first = makePayload(CHUNK_SIZE);
    const firstHash = sha1(first);
    const second = Buffer.alloc(1024, 0xee);

    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller: any) {
              controller.write(first);
              // Deliberately do NOT flush: the pending tail of `first` must be
              // spilled into backpressure so `second` lands after it.
              controller.write(second);
              controller.end();
            },
          } as any),
        );
      },
    });

    const response = await fetch(server.url);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(first.length + second.length);
    expect(sha1(body.subarray(0, first.length))).toBe(firstHash);
    expect(Buffer.compare(body.subarray(first.length), second)).toBe(0);
  });

  test("a resizable ArrayBuffer is spilled, not pinned", async () => {
    // Resizable buffers reserve maxByteLength virtually; resize() down
    // mprotect()s the trimmed pages PROT_NONE, so the pinned path must not
    // retain a raw slice into one. The tail is copied into backpressure
    // instead, so resizing mid-flight is safe.
    const ab = new ArrayBuffer(CHUNK_SIZE, { maxByteLength: CHUNK_SIZE });
    const payload = new Uint8Array(ab);
    payload.set(makePayload(CHUNK_SIZE));
    const expectedHash = sha1(payload);

    let detached: boolean | undefined;
    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller: any) {
              controller.write(payload);
              // Not pinned: transfer() detaches immediately (the tail was
              // copied into uWS backpressure).
              ab.transfer();
              detached = ab.detached;
              controller.end();
            },
          } as any),
        );
      },
    });

    const body = Buffer.from(await (await fetch(server.url)).arrayBuffer());
    expect(body.length).toBe(CHUNK_SIZE);
    expect(sha1(body)).toBe(expectedHash);
    expect(detached).toBe(true);
  });

  test("a large ASCII string write delivers the exact bytes", async () => {
    const payload = Buffer.alloc(CHUNK_SIZE, "a").toString("latin1");
    const expected = sha1(Buffer.alloc(CHUNK_SIZE, "a"));

    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller: any) {
              if (controller.write(payload) < 0) await controller.flush(true);
              controller.end();
            },
          } as any),
        );
      },
    });

    const body = Buffer.from(await (await fetch(server.url)).arrayBuffer());
    expect(body.length).toBe(CHUNK_SIZE);
    expect(sha1(body)).toBe(expected);
  });

  test("a large UTF-16 string write delivers the exact bytes", async () => {
    // Non-Latin-1 char forces JSC to 16-bit storage; the sink transcodes to
    // UTF-8 into its own buffer and then sends via tryWriteBody.
    const payload = Buffer.alloc(CHUNK_SIZE - 1, "a").toString("latin1") + "\u0100";
    const expectedBytes = Buffer.concat([Buffer.alloc(CHUNK_SIZE - 1, "a"), Buffer.from("\u0100", "utf8")]);

    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller: any) {
              if (controller.write(payload) < 0) await controller.flush(true);
              controller.end();
            },
          } as any),
        );
      },
    });

    const body = Buffer.from(await (await fetch(server.url)).arrayBuffer());
    expect(body.length).toBe(expectedBytes.length);
    expect(sha1(body)).toBe(sha1(expectedBytes));
  });

  test("readStreamIntoSink: a large enqueue() delivers the exact bytes", async () => {
    const payload = makePayload(CHUNK_SIZE);
    const expectedHash = sha1(payload);

    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(payload);
              controller.enqueue(payload);
              controller.close();
            },
          }),
        );
      },
    });

    const response = await fetch(server.url);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(CHUNK_SIZE * 2);
    expect(sha1(body.subarray(0, CHUNK_SIZE))).toBe(expectedHash);
    expect(sha1(body.subarray(CHUNK_SIZE))).toBe(expectedHash);
  });

  test.skipIf(isWindows)("a second write before drain releases the pin on the first buffer", async () => {
    let detachedAfterSecondWrite: boolean | undefined;
    const total = CHUNK_SIZE + 1024;

    await using server = Bun.serve({
      port: 0,
      fetch() {
        const first = makePayload(CHUNK_SIZE);
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller: any) {
              controller.write(first);
              controller.write(Buffer.alloc(1024, 0xee));
              // The second write spilled first's tail into uWS backpressure
              // and released the pin, so transfer() detaches again.
              first.buffer.transfer();
              detachedAfterSecondWrite = first.buffer.detached;
              controller.end();
            },
          } as any),
        );
      },
    });

    const body = await fetch(server.url).then(r => r.arrayBuffer());
    expect(body.byteLength).toBe(total);
    expect(detachedAfterSecondWrite).toBe(true);
  });

  test.skipIf(isWindows)("a client disconnect while a large write is draining releases the pin", async () => {
    // Run in a child so the pin release on the abort path is observed in
    // isolation.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const net = require("node:net");
        const { once } = require("node:events");
        const CHUNK_SIZE = ${CHUNK_SIZE};
        const PATTERN = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
        let detachedAfterAbort;
        const aborted = Promise.withResolvers();
        const server = Bun.serve({
          port: 0,
          fetch() {
            const payload = Buffer.alloc(CHUNK_SIZE, PATTERN);
            return new Response(
              new ReadableStream({
                type: "direct",
                async pull(controller) {
                  controller.write(payload);
                  await controller.flush(true).catch(() => {});
                },
                cancel() {
                  payload.buffer.transfer();
                  detachedAfterAbort = payload.buffer.detached;
                  aborted.resolve();
                },
              }),
            );
          },
        });
        const s = net.connect(server.port, "127.0.0.1");
        await once(s, "connect");
        s.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
        await once(s, "data");
        s.destroy();
        await aborted.promise;
        console.log(JSON.stringify({ detachedAfterAbort }));
        server.stop(true);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const result = JSON.parse(stdout.trim() || "{}");
    expect({ detachedAfterAbort: result.detachedAfterAbort, exitCode, stderr }).toEqual({
      detachedAfterAbort: true,
      exitCode: 0,
      stderr: expect.any(String),
    });
  });
});

// Minimal chunked-transfer decoder for raw-socket assertions.
function dechunk(raw: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 0;
  while (i < raw.length) {
    const eol = raw.indexOf("\r\n", i);
    if (eol < 0) break;
    const size = parseInt(raw.toString("latin1", i, eol), 16);
    if (!Number.isFinite(size) || size === 0) break;
    const start = eol + 2;
    out.push(raw.subarray(start, start + size));
    i = start + size + 2;
  }
  return Buffer.concat(out);
}
