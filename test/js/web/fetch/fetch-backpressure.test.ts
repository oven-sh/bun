// Receive-side backpressure: a stalled `res.body.getReader()` must stop the
// HTTP thread from buffering the entire response in memory.
import { S3Client } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir, tls } from "harness";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createSecureServer } from "node:http2";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer } from "node:net";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";

const CHUNK = 64 * 1024;
const COUNT = 256; // 16 MiB
const TOTAL = CHUNK * COUNT;

type Kind = "h1" | "h1-chunked" | "h1-gzip" | "h1-tls" | "h2" | "h3";

async function serve(kind: Kind, count = COUNT): Promise<{ url: string; sent: () => number } & AsyncDisposable> {
  let sent = 0;
  const payload = Buffer.alloc(CHUNK, 65);

  if (kind === "h2") {
    const srv = createSecureServer({ ...tls, allowHTTP1: false });
    const sockets = new Set<import("node:net").Socket>();
    srv.on("connection", s => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    srv.on("stream", stream => {
      stream.respond({ ":status": 200, "content-type": "application/octet-stream" });
      stream.on("error", () => {});
      let i = 0;
      const push = () => {
        while (i < count) {
          i++;
          sent += CHUNK;
          if (!stream.write(payload)) return void stream.once("drain", push);
        }
        stream.end();
      };
      push();
    });
    srv.listen(0);
    await once(srv, "listening");
    const { port } = srv.address() as import("node:net").AddressInfo;
    return {
      url: `https://localhost:${port}/`,
      sent: () => sent,
      [Symbol.asyncDispose]: async () => {
        for (const s of sockets) s.destroy();
        await new Promise(r => srv.close(r));
      },
    };
  }

  if (kind === "h3") {
    const srv = Bun.serve({
      port: 0,
      tls,
      http3: true,
      http1: false,
      fetch() {
        let i = 0;
        return new Response(
          new ReadableStream({
            pull(ctrl) {
              if (i++ < count) ctrl.enqueue(payload);
              else ctrl.close();
            },
          }),
        );
      },
    });
    return { url: String(srv.url), sent: () => sent, [Symbol.asyncDispose]: () => srv.stop(true) };
  }

  // h1 / h1-chunked / h1-gzip / h1-tls
  const gz = kind === "h1-gzip" ? gzipSync(randomBytes(CHUNK * count)) : null;
  const handler = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    res.on("error", () => {});
    if (gz) {
      res.setHeader("content-encoding", "gzip");
      res.setHeader("content-length", String(gz.length));
      let off = 0;
      const push = () => {
        while (off < gz.length) {
          const end = Math.min(off + CHUNK, gz.length);
          const slice = gz.subarray(off, end);
          off = end;
          sent += slice.length;
          if (!res.write(slice)) return void res.once("drain", push);
        }
        res.end();
      };
      return push();
    }
    if (kind === "h1" || kind === "h1-tls") res.setHeader("content-length", String(CHUNK * count));
    res.flushHeaders();
    let i = 0;
    const push = () => {
      while (i < count) {
        i++;
        sent += CHUNK;
        if (!res.write(payload)) return void res.once("drain", push);
      }
      res.end();
    };
    push();
  };
  const srv = kind === "h1-tls" ? createHttpsServer(tls, handler) : createServer(handler);
  srv.listen(0);
  await once(srv, "listening");
  const { port } = srv.address() as import("node:net").AddressInfo;
  return {
    url: `${kind === "h1-tls" ? "https" : "http"}://127.0.0.1:${port}/`,
    sent: () => sent,
    [Symbol.asyncDispose]: () => {
      srv.closeAllConnections();
      return new Promise(r => srv.close(() => r(undefined)));
    },
  };
}

function fetchOpts(kind: Kind): RequestInit {
  if (kind === "h2" || kind === "h1-tls") return { tls: { rejectUnauthorized: false } } as RequestInit;
  if (kind === "h3") return { protocol: "http3", tls: { rejectUnauthorized: false } } as RequestInit;
  return {};
}

async function spawnClient(url: string, kind: Kind, script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const url=${JSON.stringify(url)};const opts=${JSON.stringify(fetchOpts(kind))};${script}`],
    env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0", BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (!stdout) throw new Error(`client exited ${exitCode}: ${stderr}`);
  return { ...JSON.parse(stdout), stderr, exitCode };
}

const SETTLE_RSS = /* js */ `
  const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
  async function settleRss() {
    const before = rss();
    let last = before, stable = 0;
    while (stable < 3) {
      await Bun.sleep(20);
      const now = rss();
      stable = Math.abs(now - last) < (1 << 20) ? stable + 1 : 0;
      last = now;
    }
    return last - before;
  }
`;

const STALL_READER =
  SETTLE_RSS +
  /* js */ `
  const res = await fetch(url, opts);
  const reader = res.body.getReader();
  const first = await reader.read();
  const peak = await settleRss();
  let total = first.value.byteLength;
  for (let r; !(r = await reader.read()).done; ) total += r.value.byteLength;
  process.stdout.write(JSON.stringify({ peak, total }));
`;

const STALL_PIPE_TO =
  SETTLE_RSS +
  /* js */ `
  const res = await fetch(url, opts);
  let peak = 0, total = 0, first = true;
  await res.body.pipeTo(new WritableStream({
    async write(chunk) {
      total += chunk.byteLength;
      if (first) { first = false; peak = await settleRss(); }
    },
  }));
  process.stdout.write(JSON.stringify({ peak, total }));
`;

const STALL_FOR_AWAIT =
  SETTLE_RSS +
  /* js */ `
  const res = await fetch(url, opts);
  let peak = 0, total = 0, first = true;
  for await (const chunk of res.body) {
    total += chunk.byteLength;
    if (first) { first = false; peak = await settleRss(); }
  }
  process.stdout.write(JSON.stringify({ peak, total }));
`;

const STALL_NO_CONSUMER =
  SETTLE_RSS +
  /* js */ `
  const response = await fetch(url, opts);
  const peak = await settleRss();
  const total = (await response.arrayBuffer()).byteLength;
  process.stdout.write(JSON.stringify({ peak, total }));
`;

for (const kind of ["h1", "h1-chunked", "h1-gzip", "h1-tls", "h2", "h3"] as Kind[]) {
  describe.concurrent(`fetch() ${kind} receive backpressure`, () => {
    const skip = kind === "h3" && isWindows;

    const scripts =
      kind === "h1-gzip"
        ? ([["getReader()", STALL_READER]] as const)
        : ([
            ["getReader()", STALL_READER],
            ["pipeTo()", STALL_PIPE_TO],
            ["for await", STALL_FOR_AWAIT],
            ["no consumer", STALL_NO_CONSUMER],
          ] as const);
    for (const [name, script] of scripts) {
      // Subprocess RSS is too noisy to assert a bound across CI hosts (JIT
      // warmup + mimalloc chunks + TLS dylib faulting exceed the 16 MiB
      // body on several lanes). These assert the resume path drains the
      // full body with no deadlock; the in-process "server stops writing"
      // tests below prove the pause.
      test.skipIf(skip)(`stalled ${name} drains the full body`, async () => {
        await using server = await serve(kind);
        const { peak, total, exitCode } = await spawnClient(server.url, kind, script);
        expect({ peakMB: peak >> 20, total }).toEqual({ peakMB: expect.any(Number), total: TOTAL });
        expect(exitCode).toBe(0);
      });
    }

    if (kind === "h1" || kind === "h1-chunked" || kind === "h1-tls") {
      test("server stops writing while the reader is stalled, then drains", async () => {
        // Body must exceed kernel loopback send+recv autotuning. Some CI
        // hosts have tcp_rmem[2]+tcp_wmem[2] approaching 256 MiB, so use
        // 1 GiB; the server only actually writes until it blocks.
        const big = 16384;
        await using server = await serve(kind, big);
        const res = await fetch(server.url, fetchOpts(kind));
        const reader = res.body!.getReader();
        const first = await reader.read();
        let last = -1;
        let stable = 0;
        while (stable < 2) {
          await Bun.sleep(10);
          const now = server.sent();
          stable = now === last ? stable + 1 : 0;
          last = now;
        }
        expect(server.sent()).toBeLessThan(CHUNK * big);
        let total = first.value!.byteLength;
        for (let r; !(r = await reader.read()).done; ) total += r.value.byteLength;
        expect({ sent: server.sent(), total }).toEqual({ sent: CHUNK * big, total: CHUNK * big });
      }, 60_000);
    }
  });
}

describe.concurrent("fetch() receive backpressure — Readable.fromWeb bridge", () => {
  // `Readable.fromWeb(res.body)` takes the native handle off the ReadableStream
  // (NativeReadable fast path) and hands chunks to node streams. A stalled
  // pipe must keep the HTTP-thread socket paused just like `getReader()` does;
  // when the pipe resumes, the body must drain to completion.
  test("server stops writing while Readable.fromWeb is piped to a stalled Writable, then drains", async () => {
    const big = 16384;
    await using server = await serve("h1", big);
    const res = await fetch(server.url);
    let release!: () => void;
    let got = 0;
    const sink = new Writable({
      write(chunk, _enc, cb) {
        got += chunk.length;
        if (release) return cb();
        release = cb;
      },
    });
    const readable = Readable.fromWeb(res.body!);
    const done = pipeline(readable, sink).then(
      () => null,
      e => e,
    );

    let last = -1;
    let stable = 0;
    while (stable < 2) {
      await Bun.sleep(10);
      const now = server.sent();
      stable = now === last ? stable + 1 : 0;
      last = now;
    }
    expect(server.sent()).toBeLessThan(CHUNK * big);

    release();
    expect({ err: await done, sent: server.sent(), got }).toEqual({ err: null, sent: CHUNK * big, got: CHUNK * big });
  }, 60_000);

  // The buffered window between the HTTP-thread recv and `res.write()` is a
  // chain of native Vecs (FetchTasklet staging + ByteStream overflow) that are
  // invisible to the JSC heap. ASAN quarantine and debug allocation tracking
  // both dwarf and invert the ~2 MB/conn gap this asserts, so the bound is
  // release-only; the drain test above covers the path on every lane. The
  // threshold is tuned for Linux loopback recv sizing.
  test.skipIf(isASAN || isDebug || process.platform !== "linux")(
    "download-proxy memory window stays bounded under concurrency",
    async () => {
      const script = /* js */ `
        import http from "node:http";
        import net from "node:net";
        import { Readable } from "node:stream";
        import { pipeline } from "node:stream/promises";
        const C = 40, MB = 32;
        const CHUNK = Buffer.alloc(64 * 1024, 0x41), COUNT = MB * 16, TOTAL = CHUNK.length * COUNT;
        let peak = process.memoryUsage.rss();
        const sampler = setInterval(() => { const r = process.memoryUsage.rss(); if (r > peak) peak = r; }, 10);
        async function one() {
          const source = net.createServer(sock => {
            sock.write("HTTP/1.1 200 OK\\r\\ncontent-length: " + TOTAL + "\\r\\nconnection: close\\r\\n\\r\\n");
            let n = 0;
            const pump = () => { while (n < COUNT) { n++; if (!sock.write(CHUNK)) return sock.once("drain", pump); } sock.end(); };
            pump();
            sock.on("error", () => {});
          });
          await new Promise(r => source.listen(0, "127.0.0.1", r));
          const proxy = http.createServer(async (req, res) => {
            res.writeHead(200);
            await pipeline(Readable.fromWeb((await fetch("http://127.0.0.1:" + source.address().port + "/")).body), res).catch(() => {});
          });
          await new Promise(r => proxy.listen(0, "127.0.0.1", r));
          const got = await new Promise(resolve => {
            let got = 0;
            const c = net.connect(proxy.address().port, "127.0.0.1", () => c.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n"));
            c.on("data", d => { got += d.length; if (got >= TOTAL) c.destroy(); });
            c.on("error", () => {});
            c.on("close", () => resolve(got));
          });
          proxy.close(); source.close();
          return got;
        }
        const gots = await Promise.all(Array.from({ length: C }, () => one()));
        clearInterval(sampler);
        const short = gots.filter(g => g < TOTAL).length;
        process.stdout.write(JSON.stringify({ peakMB: Math.round(peak / 1048576), short }));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (!stdout) throw new Error(`exited ${exitCode}: ${stderr}`);
      const { peakMB, short } = JSON.parse(stdout);
      // 40 connections × 32 MB each (1.25 GB total). Before the window fix the
      // per-connection staging/overflow capacity pushed peak RSS to ~247–272 MB
      // on Linux; with it the same run sits at ~158–187 MB.
      expect({ short, peakMB }).toEqual({ short: 0, peakMB: expect.any(Number) });
      expect(peakMB).toBeLessThan(225);
      expect(exitCode).toBe(0);
    },
    30_000,
  );
});

// h2 advertises a 16 MiB initial per-stream window (LOCAL_INITIAL_WINDOW_SIZE),
// so withholding WINDOW_UPDATE only takes effect past that. Asserting a tight
// RSS bound for h2 needs that window lowered, which is a separate change.

describe.concurrent("fetch() receive backpressure — buffered consumers are not throttled", () => {
  const cases = [
    ["res.arrayBuffer()", async (r: Response) => (await r.arrayBuffer()).byteLength],
    ["res.bytes()", async (r: Response) => (await r.bytes()).byteLength],
    ["res.text()", async (r: Response) => (await r.text()).length],
    ["res.blob()", async (r: Response) => (await r.blob()).size],
    ["res.body.bytes()", async (r: Response) => (await r.body!.bytes()).byteLength],
    ["res.body.text()", async (r: Response) => (await r.body!.text()).length],
    ["res.body.blob()", async (r: Response) => (await r.body!.blob()).size],
    [
      "res.body.json() rejects on full body",
      async (r: Response) =>
        r.body!.json().then(
          () => 0,
          () => TOTAL,
        ),
    ],
    [
      "Bun.readableStreamToArrayBuffer(res.body)",
      async (r: Response) => (await Bun.readableStreamToArrayBuffer(r.body!)).byteLength,
    ],
    [
      "Bun.readableStreamToBytes(res.body)",
      async (r: Response) => (await Bun.readableStreamToBytes(r.body!)).byteLength,
    ],
    ["Bun.readableStreamToText(res.body)", async (r: Response) => (await Bun.readableStreamToText(r.body!)).length],
    ["Bun.readableStreamToBlob(res.body)", async (r: Response) => (await Bun.readableStreamToBlob(r.body!)).size],
    [
      "Bun.readableStreamToArray(res.body)",
      async (r: Response) => (await Bun.readableStreamToArray(r.body!)).reduce((n, c) => n + c.byteLength, 0),
    ],
  ] as const;

  for (const [name, consume] of cases) {
    test(name, async () => {
      await using server = await serve("h1");
      expect(await consume(await fetch(server.url))).toBe(TOTAL);
    });
  }
});

describe.concurrent("fetch() receive backpressure — streaming consumer shapes", () => {
  test("reader.cancel() mid-stream lets a subsequent request complete", async () => {
    await using server = await serve("h1");
    const r1 = await fetch(server.url, { keepalive: true });
    const reader = r1.body!.getReader();
    await reader.read();
    await reader.cancel();
    // reader.cancel() aborts the in-flight request (#33227), closing the
    // connection; the client must recover so a later request still completes.
    // The abort-vs-drain behavior itself is asserted in regression/issue/33227.
    const buf = await (await fetch(server.url, { keepalive: true })).arrayBuffer();
    expect(buf.byteLength).toBe(TOTAL);
  });

  test("res.body.tee() both branches drain", async () => {
    await using server = await serve("h1");
    const [a, b] = (await fetch(server.url)).body!.tee();
    const sum = async (s: ReadableStream<Uint8Array>) => {
      let n = 0;
      for await (const c of s) n += c.byteLength;
      return n;
    };
    const [na, nb] = await Promise.all([sum(a), sum(b)]);
    expect(na).toBe(TOTAL);
    expect(nb).toBe(TOTAL);
  });

  // The peer dying while the transport is receive-paused is only observable
  // once the read poll is re-armed: the resume after the first pull must
  // surface it instead of silently dropping a socket that already has an
  // error latched (which left reader.read() pending forever).
  for (const [name, kill] of [
    ["terminate (RST)", (s: import("bun").Socket) => s.terminate()],
    ["end (FIN)", (s: import("bun").Socket) => s.end()],
  ] as const) {
    test(`peer ${name} while receive is paused rejects the body`, async () => {
      // Declares far more than it will send and writes until the kernel stops taking it, which,
      // with an untouched body, is once the client holds the high-water mark and has paused.
      const declared = 1 << 30;
      const payload = Buffer.alloc(CHUNK, 65);
      const blocked = Promise.withResolvers<import("bun").Socket>();
      let sent = 0;
      const push = (s: import("bun").Socket) => {
        while (sent < declared) {
          const n = s.write(payload);
          sent += Math.max(n, 0);
          if (n < payload.length) return void (sent > 4 * CHUNK && blocked.resolve(s));
        }
      };
      using listener = Bun.listen({
        port: 0,
        hostname: "127.0.0.1",
        socket: {
          open(s) {
            s.write(`HTTP/1.1 200 OK\r\nContent-Length: ${declared}\r\n\r\n`);
            push(s);
          },
          drain: push,
          data() {},
        },
      });
      const res = await fetch(`http://127.0.0.1:${listener.port}/`);
      kill(await blocked.promise);
      const reader = res.body!.getReader();
      let total = 0;
      const err = await (async () => {
        for (let r; !(r = await reader.read()).done; ) total += r.value.byteLength;
      })().then(
        () => null,
        e => e,
      );
      expect({ code: err?.code, partial: total < declared }).toEqual({ code: "ECONNRESET", partial: true });
    });
  }

  test("two sequential keep-alive responses each drain fully", async () => {
    await using server = await serve("h1");
    for (let i = 0; i < 2; i++) {
      const reader = (await fetch(server.url, { keepalive: true })).body!.getReader();
      const first = await reader.read();
      await Bun.sleep(20);
      let total = first.value!.byteLength;
      for (let r; !(r = await reader.read()).done; ) total += r.value.byteLength;
      expect(total).toBe(TOTAL);
    }
  });
});

// A body stream that exists but that nothing reads: `res.body` was touched, or its reader
// was released. Before, the first chunk delivered to such a stream switched the fetch over
// to buffering the rest of the body in memory, with no bound, and kept the process alive
// while it did. The transport has to stay paused instead (the bytes have nowhere to go),
// the stream has to stay readable, and the paused body must not hold an idle process.

const BIG = 16384; // 1 GiB, as in the "server stops writing" tests above
const BODY = BIG * CHUNK;

// Writes the body as fast as the socket takes it; `sent()` is how far it got. A paused
// client stops it at the socket buffers (up to a few hundred MiB on some hosts), a client
// that drains lets it write all of BODY.
async function serveUntilBlocked() {
  let sent = 0;
  let closed = 0;
  const payload = Buffer.alloc(CHUNK, 65);
  // The kernel stopped taking writes with more than the client's high-water mark outstanding:
  // from here only a reader can make room.
  const blocked = Promise.withResolvers<void>();
  const firstClosed = Promise.withResolvers<void>();
  const srv = createServer((_req, res) => {
    res.on("error", () => {});
    res.on("close", () => {
      closed++;
      firstClosed.resolve();
    });
    res.flushHeaders();
    let i = 0;
    const push = () => {
      while (i < BIG && !res.destroyed) {
        i++;
        sent += CHUNK;
        if (!res.write(payload)) {
          if (i > 8) blocked.resolve();
          return void res.once("drain", push);
        }
      }
      if (!res.destroyed) res.end();
    };
    push();
  });
  srv.listen(0);
  await once(srv, "listening");
  const { port } = srv.address() as import("node:net").AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    sent: () => sent,
    // Resolves with `sent()` once it has not moved for 100ms.
    async settled() {
      let last = -1;
      for (let stable = 0; stable < 5; ) {
        await Bun.sleep(20);
        stable = sent === last ? stable + 1 : 0;
        last = sent;
      }
      return sent;
    },
    async untilClosed() {
      while (closed === 0) await Bun.sleep(5);
    },
    blocked: blocked.promise,
    closed: firstClosed.promise,
    [Symbol.asyncDispose]: () => {
      srv.closeAllConnections();
      return new Promise(r => srv.close(() => r(undefined)));
    },
  };
}

// Sends the headers and one chunk; the test writes the rest through `response`.
async function serveByHand() {
  let respond!: (res: import("node:http").ServerResponse) => void;
  const response = new Promise<import("node:http").ServerResponse>(resolve => (respond = resolve));
  const srv = createServer((_req, res) => {
    res.on("error", () => {});
    res.flushHeaders();
    res.write(Buffer.alloc(CHUNK, 65));
    respond(res);
  });
  srv.listen(0);
  await once(srv, "listening");
  const { port } = srv.address() as import("node:net").AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    response,
    [Symbol.asyncDispose]: () => {
      srv.closeAllConnections();
      return new Promise(r => srv.close(() => r(undefined)));
    },
  };
}

// Sequential on purpose: each test watches one server's write progress, and a sibling
// test draining a body on the same HTTP thread would blur that signal.
describe("fetch() receive backpressure — body stream nothing is reading", () => {
  const shapes: [string, (res: Response) => Promise<ReadableStream<Uint8Array>>][] = [
    ["res.body read by nothing", async res => res.body!],
    [
      "one read(), then releaseLock()",
      async res => {
        const reader = res.body!.getReader();
        await reader.read();
        reader.releaseLock();
        return res.body!;
      },
    ],
  ];

  for (const [name, shape] of shapes) {
    test(`${name}: the server blocks, and a later reader resumes the body`, async () => {
      await using server = await serveUntilBlocked();
      const body = await shape(await fetch(server.url));

      expect(await server.settled()).toBeLessThan(BODY);

      const reader = body.getReader();
      let got = 0;
      while (got < 16 * CHUNK) got += (await reader.read()).value!.byteLength;

      await reader.cancel();
      await server.untilClosed();
    }, 60_000);
  }

  // The other half of the rule: a small body nobody reads is still taken off the socket, so
  // the keep-alive connection goes back to the pool instead of staying pinned under it.
  test("small unread bodies complete and their connection is reused", async () => {
    // The body trails the headers in several packets, so it reaches a stream nothing reads
    // chunk by chunk; the client has to keep taking it (it is under the high-water mark) for
    // the response to finish and the connection to go back to the pool. A client that parks
    // on the first unread chunk needs a new connection for every request here.
    const PART = 32 * 1024;
    const PARTS = 4;
    let connections = 0;
    let finished = Promise.resolve();
    const srv = createServer(async (_req, res) => {
      finished = new Promise(r => res.on("finish", () => r()));
      res.setHeader("content-length", String(PART * PARTS));
      res.flushHeaders();
      for (let i = 0; i < PARTS; i++) {
        await new Promise(r => setTimeout(r, 2));
        res.write(Buffer.alloc(PART, 65));
      }
      res.end();
    }).on("connection", () => connections++);
    srv.listen(0);
    await once(srv, "listening");
    try {
      const url = `http://127.0.0.1:${(srv.address() as import("node:net").AddressInfo).port}/`;
      const N = 10;
      for (let i = 0; i < N; i++) {
        const res = await fetch(url);
        expect(res.status).toBe(200);
        void res.body;
        await finished;
      }
      // Not exactly 1: a request can start before the previous body's last packet was taken.
      expect(connections).toBeLessThan(N / 2);
    } finally {
      srv.closeAllConnections();
      await new Promise(r => srv.close(() => r(undefined)));
    }
  });

  // The other ways back to a parked body: a buffered read and a native sink both have to
  // pick the transport up again and see the whole body.
  for (const [name, drain] of [
    ["res.text()", (res: Response) => res.text().then(t => t.length)],
    [
      "HTMLRewriter.transform(res)",
      (res: Response) =>
        new HTMLRewriter()
          .on("x", {})
          .transform(res)
          .arrayBuffer()
          .then(b => b.byteLength),
    ],
  ] as const) {
    test(`res.body read by nothing, then ${name} drains the whole body`, async () => {
      await using server = await serve("h1");
      const res = await fetch(server.url);
      void res.body;
      // Let the client park (16 MiB body, 256 KiB mark): wait until bytes stop moving. How far
      // the server got is not asserted; loopback buffers on some hosts can take the whole body.
      let last = -1;
      for (let stable = 0; stable < 3; ) {
        await Bun.sleep(20);
        stable = server.sent() === last ? stable + 1 : 0;
        last = server.sent();
      }
      expect(await drain(res)).toBe(TOTAL);
    });
  }
});

// A Response whose body nothing ever touches (looked at for its status, then forgotten). The
// rule above applies to it as well: its body is received up to the mark, so a short one
// completes and its connection goes back to the pool while the Response is still around, and a
// long one leaves the transport paused until the Response is collected, at which point its fetch
// is aborted like an abandoned stream's.

type Framing = "content-length" | "chunked" | "close-delimited";

// A raw HTTP/1.1 origin, so that each test says exactly how its bodies are framed. Every
// response is `length` bytes of body, written as fast as the socket takes them. With `holdTail`
// the last CHUNK of every body is held back until `finishHeld()`, which also stops holding.
// The origin never ends a body by closing, so every close it sees is the client's.
async function rawOrigin(framing: Framing, length: number, holdTail = false) {
  const payload = Buffer.alloc(CHUNK, 65);
  const frame =
    framing === "chunked"
      ? Buffer.concat([Buffer.from(`${CHUNK.toString(16)}\r\n`), payload, Buffer.from("\r\n")])
      : payload;
  const tail = framing === "chunked" ? Buffer.concat([frame, Buffer.from("0\r\n\r\n")]) : frame;
  const head =
    framing === "content-length"
      ? `HTTP/1.1 200 OK\r\nContent-Length: ${length}\r\n\r\n`
      : framing === "chunked"
        ? "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
        : "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";

  let connections = 0;
  let closed = 0;
  let holding = holdTail;
  const held: (() => void)[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const closeWaiters: [number, () => void][] = [];
  let requested = 0;
  const requestWaiters: [number, () => void][] = [];

  function respond(socket: import("node:net").Socket) {
    socket.write(head);
    let left = length / CHUNK;
    const push = () => {
      while (left > 1 && !socket.destroyed) {
        left--;
        if (!socket.write(frame)) return void socket.once("drain", push);
      }
      const end = () => void (socket.destroyed || socket.write(tail));
      if (holding) held.push(end);
      else end();
    };
    push();
  }

  const srv = createTcpServer(socket => {
    connections++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => {
      closed++;
      sockets.delete(socket);
      for (const [n, resolve] of closeWaiters) if (closed >= n) resolve();
    });
    // A pooled connection carries one request after another.
    let pending = "";
    socket.on("data", data => {
      pending += data.toString("latin1");
      for (let end; (end = pending.indexOf("\r\n\r\n")) !== -1; ) {
        pending = pending.slice(end + 4);
        requested++;
        for (const [n, resolve] of requestWaiters) if (requested >= n) resolve();
        respond(socket);
      }
    });
  });
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  const { port } = srv.address() as import("node:net").AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    connections: () => connections,
    closed: () => closed,
    closedAtLeast: (n: number) =>
      closed >= n ? Promise.resolve() : new Promise<void>(resolve => closeWaiters.push([n, resolve])),
    requests: (n: number) =>
      requested >= n ? Promise.resolve() : new Promise<void>(resolve => requestWaiters.push([n, resolve])),
    finishHeld() {
      holding = false;
      for (const end of held.splice(0)) end();
    },
    [Symbol.asyncDispose]: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>(resolve => srv.close(() => resolve()));
    },
  };
}

// One full collection per event-loop turn (an fs round trip, not a timer) until `event` settles.
// What `event` waits for is several hops away from the collection itself: the finalizer runs in
// the sweep, the abort is a message to the HTTP thread, and the origin sees the close on its own
// socket. Loop on the event, not on a count of collections.
async function collectUntil<T>(event: Promise<T>): Promise<T> {
  let settled = false;
  const result = event.finally(() => (settled = true));
  while (!settled) {
    await stat(import.meta.path);
    Bun.gc(true);
  }
  return result;
}

// Sequential on purpose, as above: these watch connections and closes on their own origin.
describe("fetch() receive backpressure — a Response whose body nothing touches", () => {
  const N = 4;

  test("a long body, Response held untouched: the process is not held and the body stays where it is", async () => {
    await using server = await serveUntilBlocked();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `globalThis.keep = await fetch(${JSON.stringify(server.url)});`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(server.sent()).toBeLessThan(BODY);
  });

  for (const framing of ["content-length", "chunked", "close-delimited"] as Framing[]) {
    test(`a long ${framing} body, Response collected: its fetch is aborted`, async () => {
      await using origin = await rawOrigin(framing, TOTAL);
      // Its own frame, so that nothing on this one still refers to a response afterwards.
      async function abandonOne() {
        expect((await fetch(origin.url)).status).toBe(200);
      }
      for (let i = 0; i < N; i++) await abandonOne();
      await collectUntil(origin.closedAtLeast(N));
    });
  }

  // Not close-delimited: such a body ends with its connection, so there is nothing to reuse.
  for (const framing of ["content-length", "chunked"] as Framing[]) {
    test(`a short ${framing} body, Response still held: it is received, and its connection is reused`, async () => {
      // Each body's tail is held back until its Response exists, so every body is still underway
      // when fetch() resolves, as it is over a real network.
      await using origin = await rawOrigin(framing, 2 * CHUNK, true);
      const responses: Response[] = [];
      for (let i = 0; i < N; i++) responses.push(await fetch(origin.url));
      // Every body is underway, so no connection was free for the next request.
      expect(origin.connections()).toBe(N);

      origin.finishHeld();
      // The held bodies complete on their own and give their connections back. One request after
      // another from here needs at most one more connection (the first can leave before the tails
      // were taken); before, every one of them did, since each held body pinned its connection.
      for (let i = 0; i < N; i++) expect((await (await fetch(origin.url)).arrayBuffer()).byteLength).toBe(2 * CHUNK);
      expect(origin.connections() - N).toBeLessThanOrEqual(1);
      expect({ closed: origin.closed(), held: responses.length }).toEqual({ closed: 0, held: N });
    });
  }

  // The boundary of the abort above: a consumer that waits for the whole body (`.text()` through
  // a promise, `Bun.write()` through a native callback) may be all that is left of a Response.
  // Its body still has to arrive.
  const wholeBodyConsumers: [string, (res: Response, dir: string) => Promise<number>][] = [
    ["res.text()", res => res.text().then(text => text.length)],
    ["Bun.write(file, res)", (res, dir) => Bun.write(join(dir, "body"), res)],
  ];
  for (const [name, consume] of wholeBodyConsumers) {
    test(`a Response collected while ${name} waits for its body: the body still arrives`, async () => {
      using dir = tempDir("fetch-collected-while-consumed", {});
      await using origin = await rawOrigin("content-length", 2 * CHUNK, true);
      let response!: WeakRef<Response>;
      // Its own frame: once it returns, the consumer's promise is all that is held.
      async function start() {
        const res = await fetch(origin.url);
        response = new WeakRef(res);
        return consume(res, String(dir));
      }
      const received = start();
      await origin.requests(1);
      // One full collection per event-loop turn (an fs round trip) until the Response is gone.
      do {
        await stat(import.meta.path);
        Bun.gc(true);
      } while (!response || response.deref());
      origin.finishHeld();
      // Before, the collection let go of the body instead, and Bun.write() never settled.
      expect({ received: await received, closed: origin.closed() }).toEqual({ received: 2 * CHUNK, closed: 0 });
    });
  }
});

// S3 downloads go through the same HTTP client with their own body producer
// (S3DownloadStreamWrapper). The same rule applies: a reader that stalls pauses the transport,
// an unread stream does not hold the process, and a collected one aborts the download.
describe("S3 receive backpressure", () => {
  // A GET-only fake bucket: every object is BODY bytes written as fast as the socket takes them.
  async function fakeBucket() {
    const server = await serveUntilBlocked();
    const s3 = new S3Client({ accessKeyId: "test", secretAccessKey: "test", endpoint: server.url, bucket: "b" });
    return Object.assign(server, { s3 });
  }

  test("a reader that stalls and comes back drains the body; cancel() closes the connection", async () => {
    await using bucket = await fakeBucket();
    const reader = bucket.s3.file("big").stream().getReader();
    let got = (await reader.read()).value!.byteLength;
    await bucket.blocked;
    while (got < 64 * CHUNK) got += (await reader.read()).value!.byteLength;
    await reader.cancel();
    await bucket.closed;
  });

  test("Bun.write(file, s3file) streams to disk with the byte count", async () => {
    using dir = tempDir("s3-to-file", {});
    await using server = await serve("h1");
    const s3 = new S3Client({ accessKeyId: "test", secretAccessKey: "test", endpoint: server.url, bucket: "b" });
    const dest = join(String(dir), "out.bin");
    expect(await Bun.write(dest, s3.file("k"))).toBe(TOTAL);
    expect(statSync(dest).size).toBe(TOTAL);
  });

  // A paused, unread stream releases the loop: the process exits with most of the body unsent.
  // Without the pause it would either read all of BODY first or never exit.
  test("an unread S3 stream does not hold the process", async () => {
    await using bucket = await fakeBucket();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const s3 = new Bun.S3Client({ accessKeyId: "t", secretAccessKey: "t", endpoint: ${JSON.stringify(bucket.url)}, bucket: "b" });
         globalThis.keep = s3.file("k").stream();
         const r = globalThis.keep.getReader(); await r.read(); r.releaseLock();`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(bucket.sent()).toBeLessThan(BODY);
  });

  test("a collected S3 stream aborts the download", async () => {
    await using bucket = await fakeBucket();
    // Its own frame: after it returns nothing refers to the stream.
    await (async () => {
      const r = bucket.s3.file("k").stream().getReader();
      await r.read();
      r.releaseLock();
    })();
    await bucket.blocked;
    await collectUntil(bucket.closed);
    expect(bucket.sent()).toBeLessThan(BODY);
  });

  // An error body is collected whole for the error message; the mark must not pause it.
  test("a non-2xx response larger than the mark rejects instead of stalling", async () => {
    const message = Buffer.alloc(400 * 1024, "e").toString();
    await using bucket = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(`<Error><Code>AccessDenied</Code><Message>${message}</Message></Error>`, { status: 403 }),
    });
    const s3 = new S3Client({ accessKeyId: "t", secretAccessKey: "t", endpoint: bucket.url.href, bucket: "b" });
    await expect(s3.file("denied").stream().getReader().read()).rejects.toThrow(
      expect.objectContaining({ code: "AccessDenied" }),
    );
  });

  // The other direction: a fetch body uploaded to S3. The multipart sink's queue back-pressures
  // the fetch, and both `Bun.write(s3file, res)` and `s3file.writer()` resolve with the bytes sent.
  async function fakeUploadBucket(holdParts?: Promise<void>) {
    let uploaded = 0;
    let parts = 0;
    let completed = 0;
    const firstPart = Promise.withResolvers<void>();
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "POST" && url.searchParams.has("uploads"))
          return new Response("<InitiateMultipartUploadResult><UploadId>u</UploadId></InitiateMultipartUploadResult>");
        if (req.method === "PUT") {
          const body = await req.arrayBuffer();
          firstPart.resolve();
          await holdParts;
          uploaded += body.byteLength;
          return new Response("", { headers: { etag: `"e${++parts}"` } });
        }
        if (req.method === "POST" && url.searchParams.has("uploadId")) {
          await req.text();
          completed++;
          return new Response(
            "<CompleteMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><ETag>e</ETag></CompleteMultipartUploadResult>",
          );
        }
        if (req.method === "DELETE") return new Response(null, { status: 204 });
        return new Response("", { status: 400 });
      },
    });
    const s3 = new S3Client({ accessKeyId: "t", secretAccessKey: "t", endpoint: server.url.href, bucket: "b" });
    return Object.assign(server, {
      s3,
      firstPart: firstPart.promise,
      uploaded: () => uploaded,
      completed: () => completed,
    });
  }

  test("fetch → Bun.write(s3file, res) is paced by the part uploads, and an aborted source commits nothing", async () => {
    const hold = Promise.withResolvers<void>();
    await using origin = await serveUntilBlocked();
    await using bucket = await fakeUploadBucket(hold.promise);
    const abort = new AbortController();
    // partSize 5 MiB × queueSize 1: with the first part held, the sink fills and the origin has
    // to stop long before its 1 GiB is out.
    const written = Bun.write(
      bucket.s3.file("up", { partSize: 5 * 1024 * 1024, queueSize: 1 }),
      await fetch(origin.url, { signal: abort.signal }),
    );
    await bucket.firstPart;
    await origin.blocked;
    expect(origin.sent()).toBeLessThan(BODY);
    // Aborting the source fails the upload: nothing is committed.
    abort.abort();
    hold.resolve();
    await expect(written).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(bucket.completed()).toBe(0);
  });

  test("Bun.write(s3file, res) resolves with the byte count", async () => {
    await using origin = await serve("h1");
    await using bucket = await fakeUploadBucket();
    expect(await Bun.write(bucket.s3.file("up"), await fetch(origin.url))).toBe(TOTAL);
    expect(bucket.uploaded()).toBe(TOTAL);
  });

  test("s3file.writer().end() resolves with the byte count, also once the writer is collected", async () => {
    const hold = Promise.withResolvers<void>();
    await using bucket = await fakeUploadBucket(hold.promise);
    const collected = Promise.withResolvers<void>();
    const registry = new FinalizationRegistry(() => collected.resolve());
    // Its own frame: once it returns, only the pending end() refers to the upload.
    function start() {
      const writer = bucket.s3.file("up2").writer();
      registry.register(writer, null);
      writer.write(Buffer.alloc(1000, 1));
      writer.write("héllo");
      return writer.end();
    }
    const ended = start();
    await bucket.firstPart;
    // The count must not depend on the writer object: it is collectable while the PUT is out.
    await collectUntil(collected.promise);
    hold.resolve();
    expect(await ended).toBe(1006);
  });
});

describe.concurrent("fetch() receive backpressure — a body nothing waits for does not hold the process", () => {
  // The client keeps the unread body reachable and has nothing else to do: it has to exit
  // on its own. Before, it stayed alive draining the body into memory, or, when the pause
  // won the race at start, stayed alive holding the paused body.
  const idleClients = [
    ["the Response, body touched", /* js */ `globalThis.keep = res; void res.body;`],
    [
      "the stream, reader released",
      /* js */ `const reader = res.body.getReader(); await reader.read(); reader.releaseLock(); globalThis.keep = res.body;`,
    ],
    ["an idle reader", /* js */ `const reader = res.body.getReader(); await reader.read(); globalThis.keep = reader;`],
  ] as const;

  // If the process is still around after 6 s, say what it is holding (an unref'd timer, so it
  // cannot itself be the reason), then how much a late reader finds buffered and whether more
  // follows. Only ever printed by a failing run.
  const diagnose = /* js */ `
    setTimeout(async () => {
      const { getEventLoopStats } = require("bun:internal-for-testing");
      const stats = getEventLoopStats();
      const reader = (globalThis.keep instanceof Response ? globalThis.keep.body : globalThis.keep instanceof ReadableStream ? globalThis.keep : null)?.getReader() ?? globalThis.keep;
      const reads = [];
      for (let i = 0; i < 6; i++) {
        const r = await Promise.race([reader.read(), Bun.sleep(300).then(() => null)]);
        reads.push(r === null ? "pending" : r.done ? "done" : r.value.byteLength);
        if (r === null) break;
      }
      console.error("still alive: " + JSON.stringify({ stats, reads, after: getEventLoopStats() }));
    }, 6000).unref();
  `;

  for (const [holding, script] of idleClients) {
    test(`a process holding ${holding} exits on its own`, async () => {
      await using server = await serveUntilBlocked();
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `const res = await fetch(${JSON.stringify(server.url)}); ${script} ${diagnose}`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = proc.stderr.text();
      const exited = proc.exited.then(exitCode => ({ exitCode }));
      const deadline = performance.now() + 10_000;
      let outcome: { exitCode: number } | { stillAlive: true; serverSentKiB: number } | undefined;
      while (outcome === undefined) {
        outcome = await Promise.race([exited, Bun.sleep(20).then(() => undefined)]);
        // Took the whole body: it is draining. Took little and is still around: it is
        // holding the paused body. Neither exited.
        if (outcome === undefined && (server.sent() >= BODY || performance.now() >= deadline)) {
          outcome = { stillAlive: true, serverSentKiB: server.sent() >> 10 };
          proc.kill();
        }
      }
      expect({ outcome, stderr: await stderr }).toEqual({ outcome: { exitCode: 0 }, stderr: "" });
    }, 20_000);
  }

  // The other half of the rule: a consumer that does wait for bytes keeps the process
  // alive, including one that picks the body up again after a release (the chunk that
  // arrives while the body is released is what lets go of the loop).
  const waitingClients = [
    [
      "read() pending on a reader",
      /* js */ `
        const reader = res.body.getReader();
        let total = (await reader.read()).value.byteLength;
        console.log("waiting");
        for (let r; !(r = await reader.read()).done; ) total += r.value.byteLength;
        console.log("total " + total);
      `,
      2,
    ],
    [
      "read() pending on a reader acquired after a release",
      /* js */ `
        let reader = res.body.getReader();
        let total = (await reader.read()).value.byteLength;
        reader.releaseLock();
        console.log("released");
        // Lets the chunk the test writes on "released" arrive while nothing reads the body.
        // A slow machine only narrows what this exercises; the assertions do not depend on it.
        await Bun.sleep(50);
        reader = res.body.getReader();
        const next = reader.read();
        console.log("waiting");
        for (let r = await next; !r.done; r = await reader.read()) total += r.value.byteLength;
        console.log("total " + total);
      `,
      3,
    ],
  ] as const;

  for (const [name, script, chunks] of waitingClients) {
    test(`a process with a ${name} stays alive until the body ends`, async () => {
      await using server = await serveByHand();
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `const res = await fetch(${JSON.stringify(server.url)}); ${script}`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = proc.stderr.text();
      const upstream = await server.response;
      const lines: string[] = [];
      let pending = "";
      for await (const text of proc.stdout.pipeThrough(new TextDecoderStream())) {
        pending += text;
        for (let nl; (nl = pending.indexOf("\n")) !== -1; ) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          lines.push(line);
          if (line === "released") upstream.write(Buffer.alloc(CHUNK, 66));
          if (line === "waiting") upstream.end(Buffer.alloc(CHUNK, 67));
        }
      }
      expect({ lines: lines.slice(-2), stderr: await stderr, exitCode: await proc.exited }).toEqual({
        lines: ["waiting", `total ${chunks * CHUNK}`],
        stderr: "",
        exitCode: 0,
      });
    });
  }
});
