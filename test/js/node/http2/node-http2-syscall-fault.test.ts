import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isASAN, isWindows } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const skip = !fault.available() || isWindows;

// fault.clear() throws on builds without the hooks compiled in, and the unfaulted scenario at the
// bottom of this file runs on those builds too.
afterEach(() => {
  if (fault.available()) fault.clear();
});

// http2 sessions go through the same uSockets bsd_recv/bsd_send chokepoints.
// Faults are process-global, so client and server (both in this process)
// share the rule table — short-I/O tests are safe; errno tests target only
// recv (loop.c on the receiving side).

async function makeServer(handler: (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void) {
  const server = http2.createServer();
  server.on("stream", handler);
  server.on("sessionError", () => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as import("node:net").AddressInfo).port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    [Symbol.dispose]() {
      server.close();
    },
  };
}

describe.skipIf(skip)("node:http2 under injected syscall faults", () => {
  test("recv → short reads (1 byte) deliver complete HEADERS + DATA frames", async () => {
    const body = Buffer.alloc(1024, "h");
    using server = await makeServer((stream, headers) => {
      stream.respond({ ":status": 200, "content-type": "text/plain" });
      stream.end(body);
    });
    fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: -1 });
    const client = http2.connect(server.url);
    client.on("error", () => {});
    try {
      const req = client.request({ ":path": "/" });
      const [headers] = (await once(req, "response")) as [http2.IncomingHttpHeaders];
      expect(headers[":status"]).toBe(200);
      const chunks: Buffer[] = [];
      req.on("data", c => chunks.push(c));
      await once(req, "end");
      expect(Buffer.concat(chunks).equals(body)).toBe(true);
    } finally {
      fault.clear();
      client.close();
    }
  });

  test("send → short writes (256 bytes) deliver complete request body to server", async () => {
    const reqBody = Buffer.alloc(2048, "p");
    let received = Buffer.alloc(0);
    const { promise: gotBody, resolve } = Promise.withResolvers<void>();
    using server = await makeServer((stream, headers) => {
      stream.on("data", c => (received = Buffer.concat([received, c])));
      stream.on("end", () => {
        stream.respond({ ":status": 200 });
        stream.end();
        resolve();
      });
    });
    fault.set({ syscall: "send", action: "short", bytes: 256, repeat: -1 });
    const client = http2.connect(server.url);
    client.on("error", () => {});
    try {
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.write(reqBody);
      req.end();
      await once(req, "response");
      await once(req, "end");
      await gotBody;
      expect(received.equals(reqBody)).toBe(true);
    } finally {
      fault.clear();
      client.close();
    }
  });

  // A payload over one DATA frame (16 KiB) is not corked frame by frame: send_data batches
  // the frame headers and points at the payload slices, and the batch leaves as one writev.
  // When writev takes nothing, the same slices are copied into the session's write buffer
  // and drained on writable. Every u32 holds its own offset, so a slice taken from the
  // wrong place or with the wrong length changes the bytes, not only their count.
  const batchBody = Buffer.alloc(3 * 16384 + 4096);
  for (let i = 0; i < batchBody.length; i += 4) batchBody.writeUInt32LE(i, i);

  test.each([
    ["writev takes the batch", () => {}],
    ["writev → 0 re-buffers the batch", () => fault.set({ syscall: "writev", action: "zero", repeat: -1 })],
  ])("multi-frame DATA batch arrives intact: %s", async (_, arm) => {
    const chunks: Buffer[] = [];
    const { promise: gotBody, resolve } = Promise.withResolvers<void>();
    using server = await makeServer(stream => {
      stream.on("data", c => chunks.push(c));
      stream.on("end", () => {
        stream.respond({ ":status": 200 });
        stream.end();
        resolve();
      });
    });
    const client = http2.connect(server.url);
    client.on("error", () => {});
    try {
      await once(client, "connect");
      const req = client.request({ ":path": "/", ":method": "POST" });
      arm();
      req.write(batchBody);
      req.end();
      await once(req, "response");
      await once(req, "end");
      await gotBody;
      const received = Buffer.concat(chunks);
      expect(received.length).toBe(batchBody.length);
      expect(received.equals(batchBody)).toBe(true);
    } finally {
      fault.clear();
      client.close();
    }
  });

  test("recv → short reads at HTTP/2 frame header boundary (9 bytes) still parse correctly", async () => {
    // HTTP/2 frame header is exactly 9 bytes; clamping recv to 9 forces the
    // frame parser to reassemble header and payload across separate reads.
    const body = Buffer.alloc(512, "x");
    using server = await makeServer(stream => {
      stream.respond({ ":status": 200 });
      stream.end(body);
    });
    fault.set({ syscall: "recv", action: "short", bytes: 9, repeat: -1 });
    const client = http2.connect(server.url);
    client.on("error", () => {});
    try {
      const req = client.request({ ":path": "/" });
      const chunks: Buffer[] = [];
      req.on("data", c => chunks.push(c));
      await Promise.all([once(req, "response"), once(req, "end")]);
      expect(Buffer.concat(chunks).equals(body)).toBe(true);
    } finally {
      fault.clear();
      client.close();
    }
  });

  test("recv → ECONNRESET after connect surfaces as session 'error'", async () => {
    using server = await makeServer(stream => {
      stream.respond({ ":status": 200 });
      stream.end();
    });
    const client = http2.connect(server.url);
    const errP = once(client, "error");
    await once(client, "connect");
    fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 });
    // Trigger a recv by requesting.
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    const [err] = (await errP) as [NodeJS.ErrnoException];
    expect(err).toBeInstanceOf(Error);
    expect(client.destroyed).toBe(true);
  });

  test("send → short writes (8 bytes) during connection preface still establish session", async () => {
    using server = await makeServer(stream => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    fault.set({ syscall: "send", action: "short", bytes: 8, repeat: -1 });
    const client = http2.connect(server.url);
    client.on("error", () => {});
    try {
      await once(client, "connect");
      const req = client.request({ ":path": "/" });
      const [headers] = (await once(req, "response")) as [http2.IncomingHttpHeaders];
      expect(headers[":status"]).toBe(200);
      req.resume();
      await once(req, "end");
    } finally {
      fault.clear();
      client.close();
    }
  });

  test("https/2: recv → short reads (3 bytes) over TLS deliver complete response", async () => {
    const body = Buffer.alloc(256, "s");
    const server = http2.createSecureServer({ key: certs.key, cert: certs.cert });
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end(body);
    });
    server.on("sessionError", () => {});
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as import("node:net").AddressInfo).port;
    try {
      fault.set({ syscall: "recv", action: "short", bytes: 3, repeat: -1 });
      const client = http2.connect(`https://127.0.0.1:${port}`, { ca: certs.cert });
      client.on("error", () => {});
      try {
        const req = client.request({ ":path": "/" });
        const chunks: Buffer[] = [];
        req.on("data", c => chunks.push(c));
        await Promise.all([once(req, "response"), once(req, "end")]);
        expect(Buffer.concat(chunks).equals(body)).toBe(true);
      } finally {
        fault.clear();
        client.close();
      }
    } finally {
      server.close();
    }
  });

  // Hive-pool user-poison, so only ASAN observes the freed-slot read.
  test.skipIf(!isASAN)(
    "send → backpressure then session.destroy() inside the drained write callback does not UAF",
    async () => {
      // Runs in a subprocess: the failure mode is an ASAN abort inside
      // on_native_writable, not an exception the test runner can catch.
      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "node-http2-writable-destroy-fixture.ts")],
        env: { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0"].filter(Boolean).join(":") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("AddressSanitizer");
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    },
  );
});

describe.skipIf(skip)("node:http2 seeded short-I/O fuzz", () => {
  const seed = Number(process.env.BUN_SOCKET_FUZZ_SEED ?? 0x1f2e) >>> 0 || 1;
  function makePrng(s: number) {
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0x1_0000_0000;
    };
  }

  test("randomized short recv/send still deliver intact body", async () => {
    const rand = makePrng(seed);
    const body = Buffer.alloc(2048, "F");
    using server = await makeServer(stream => {
      stream.respond({ ":status": 200 });
      stream.end(body);
    });
    for (let i = 0; i < 6; i++) {
      const sc: "recv" | "send" = rand() < 0.5 ? "recv" : "send";
      const bytes = 1 + Math.floor(rand() * 16);
      fault.set({ syscall: sc, action: "short", bytes, repeat: -1 });
      const client = http2.connect(server.url);
      client.on("error", () => {});
      try {
        const req = client.request({ ":path": "/" });
        const chunks: Buffer[] = [];
        req.on("data", c => chunks.push(c));
        await Promise.all([once(req, "response"), once(req, "end")]);
        expect(Buffer.concat(chunks).equals(body)).toBe(true);
      } finally {
        fault.clear();
        client.close();
      }
    }
  });
});

// A raw TCP peer that only records the HTTP/2 frames the client sends and never answers, so
// the only thing that can put a frame on the wire is the client's own flushing.
const FRAME_HEADERS = 0x1;
const FRAME_RST_STREAM = 0x3;
const FRAME_SETTINGS = 0x4;
const PREFACE_LENGTH = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n".length;
type RawFrame = { type: number; flags: number; streamId: number; payload: Buffer };

async function silentRawServer() {
  const frames: RawFrame[] = [];
  let waiter: { pred: (f: RawFrame) => boolean; resolve: (f: RawFrame) => void } | null = null;
  let buf = Buffer.alloc(0);
  let sawPreface = false;
  let socket: net.Socket | null = null;
  const server = net.createServer(s => {
    socket = s;
    s.on("error", () => {});
    s.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!sawPreface) {
        if (buf.length < PREFACE_LENGTH) return;
        buf = buf.subarray(PREFACE_LENGTH);
        sawPreface = true;
      }
      while (buf.length >= 9) {
        const length = buf.readUIntBE(0, 3);
        if (buf.length < 9 + length) break;
        const frame: RawFrame = {
          type: buf.readUInt8(3),
          flags: buf.readUInt8(4),
          streamId: buf.readUInt32BE(5) & 0x7fffffff,
          payload: buf.subarray(9, 9 + length),
        };
        buf = buf.subarray(9 + length);
        frames.push(frame);
        if (waiter !== null && waiter.pred(frame)) {
          const { resolve } = waiter;
          waiter = null;
          resolve(frame);
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    frames,
    waitFor(pred: (f: RawFrame) => boolean): Promise<RawFrame> {
      const existing = frames.find(pred);
      if (existing) return Promise.resolve(existing);
      return new Promise(resolve => (waiter = { pred, resolve }));
    },
    [Symbol.dispose]() {
      socket?.destroy();
      server.close();
    },
  };
}

// close() on a request made before the session connected: the stream is submitted from the
// connect callback, and its RST_STREAM is written from a later setImmediate with nothing else
// going on, so that frame only reaches the wire through the parser's deferred auto-flush. Against
// a silent peer nothing else ever flushes it. (Without fault injection this is the case the
// darwin CI lane hit: the preface send() on the still-connecting socket fails with ENOTCONN there.)
async function closedPendingRequestGetsReset(raw: Awaited<ReturnType<typeof silentRawServer>>) {
  const client = http2.connect(raw.url);
  const sessionErrors: Error[] = [];
  client.on("error", err => sessionErrors.push(err));
  const sessionClosed = once(client, "close").then(() => {
    throw new Error(`session closed before the RST_STREAM went out (${sessionErrors.map(e => e.message)})`);
  });
  try {
    const req = client.request({ ":method": "POST", ":path": "/" });
    req.on("error", () => {});
    expect(req.pending).toBe(true);
    req.end("hello");
    req.close();

    const rst = await Promise.race([raw.waitFor(f => f.streamId === 1 && f.type === FRAME_RST_STREAM), sessionClosed]);
    expect(rst.payload.readUInt32BE(0)).toBe(http2.constants.NGHTTP2_NO_ERROR);
    expect(raw.frames.map(f => [f.type, f.streamId])).toEqual([
      [FRAME_SETTINGS, 0],
      [FRAME_HEADERS, 1],
      [0 /* DATA */, 1],
      [FRAME_RST_STREAM, 1],
    ]);
    expect(sessionErrors).toEqual([]);
  } finally {
    client.removeAllListeners("close");
    client.destroy();
  }
}

test("client: a request close()d while the session was still connecting is reset once it is submitted", async () => {
  using raw = await silentRawServer();
  await closedPendingRequestGetsReset(raw);
});

describe.skipIf(skip)("node:http2 after a send() that fails with a peer-gone errno but is delivered on retry", () => {
  // Models what macOS does for the preface write on a still-connecting loopback socket (ENOTCONN,
  // which the socket layer reports as fatal), or a racy EPROTOTYPE: the send fails once, the bytes
  // are delivered by the next flush. The parser must keep flushing the frames written after that,
  // not treat the connection as dead or stop flushing it.
  test("frames written after the failed send still reach the wire", async () => {
    using raw = await silentRawServer();
    // The first send() of the connection, no matter whether it happens before or after the
    // connect completes; the raw peer never sends, so no other send() can consume the rule.
    fault.set({ syscall: "send", action: "errno", errno: os.constants.errno.ENOTCONN, repeat: 1 });
    await closedPendingRequestGetsReset(raw);
  });
});
