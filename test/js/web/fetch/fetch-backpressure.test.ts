// Receive-side backpressure: a stalled `res.body.getReader()` must stop the
// HTTP thread from buffering the entire response in memory.
import { S3Client } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isASAN, isDebug, isWindows, tempDir, tls } from "harness";
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
const PAYLOAD = Buffer.alloc(CHUNK, 65);

// What the client takes off the socket before it pauses it: `BODY_HIGH_WATER_MARK` in
// src/http/Signals.rs. Past this mark, only the kernel's buffers take bytes.
const HIGH_WATER_MARK = 256 * 1024;

function md5(data: Uint8Array | string): string {
  return Bun.CryptoHasher.hash("md5", data, "hex");
}

// Every body here is "A" repeated. A consumer that received all of a 16 MiB one hashes to this.
const DIGEST = md5(Buffer.alloc(TOTAL, 65));

// Whether every byte of `chunk` is "A". A memcmp per 2 MiB window: a byte loop over a body in JS is
// slow in debug builds.
const A_WINDOW = Buffer.alloc(2 * 1024 * 1024, 65);
function isAllA(chunk: Uint8Array): boolean {
  const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  for (let off = 0; off < buf.length; off += A_WINDOW.length) {
    const end = Math.min(off + A_WINDOW.length, buf.length);
    if (buf.compare(A_WINDOW, 0, end - off, off, end) !== 0) return false;
  }
  return true;
}

// Longer than any loopback buffer: tcp_rmem[2] + tcp_wmem[2] approach 256 MiB on some hosts. A
// server writes it only until the kernel stops taking bytes, and a test reads only as much of it as
// proves the pause and the resume; no test drains it.
const BIG = 16384; // 1 GiB declared
const BODY = BIG * CHUNK;

type Kind = "h1" | "h1-chunked" | "h1-gzip" | "h1-tls" | "h2" | "h3";

type Server = AsyncDisposable & {
  url: string;
  // Bytes handed to the socket so far (of the gzip stream, for h1-gzip).
  sent: () => number;
  // What `sent()` reaches once a whole body is out.
  wire: number;
  // Resolves with `sent()` once the body has stopped moving: the socket stopped taking writes past
  // the client's high-water mark (or the whole body is out), and `sent()` then held still for
  // three samples 10 ms apart. No event reports "nothing more is coming", so the second half has
  // to sample.
  settled: () => Promise<number>;
  // `sent()` reached `n`.
  wrote: (n: number) => Promise<void>;
  // The first response's connection closed (for a body that never ends, that is the client's doing).
  closed: Promise<void>;
};

// The bookkeeping behind `Server`, shared by every transport.
function progress(wire: number) {
  let sent = 0;
  const waiters: [number, () => void][] = [];
  const blocked = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  return {
    add(n: number) {
      sent += n;
      for (let i = waiters.length; i--; ) if (sent >= waiters[i][0]) waiters.splice(i, 1)[0][1]();
      if (sent >= wire) finished.resolve();
    },
    // A write that did not go through once the socket has taken more than the client holds before
    // it pauses. Past that mark only the kernel takes bytes, and `sent()` holding still means it is
    // full. The mark has to be this low: Windows loopback buffers can stay at about 256 KiB while
    // the peer is paused, so with chunked framing the socket takes a few bytes short of 8 chunks,
    // and a mark of 8 chunks was never reached.
    block() {
      if (sent > HIGH_WATER_MARK) blocked.resolve();
    },
    close: () => closed.resolve(),
    api: {
      sent: () => sent,
      wire,
      wrote: (n: number) => (sent >= n ? Promise.resolve() : new Promise<void>(resolve => waiters.push([n, resolve]))),
      closed: closed.promise,
      async settled() {
        await Promise.race([blocked.promise, finished.promise]);
        let last = -1;
        for (let stable = 0; stable < 3; ) {
          await Bun.sleep(10);
          stable = sent === last ? stable + 1 : 0;
          last = sent;
        }
        return sent;
      },
    },
  };
}

// Writes `count` chunks of "A" as fast as the socket takes them.
async function serve(kind: Kind, count = COUNT): Promise<Server> {
  if (kind === "h2") {
    const p = progress(CHUNK * count);
    const srv = createSecureServer({ ...tls, allowHTTP1: false });
    const sockets = new Set<import("node:net").Socket>();
    srv.on("connection", s => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    srv.on("stream", stream => {
      stream.respond({ ":status": 200, "content-type": "application/octet-stream" });
      stream.on("error", () => {});
      stream.on("close", p.close);
      let i = 0;
      const push = () => {
        while (i < count) {
          i++;
          p.add(CHUNK);
          if (!stream.write(PAYLOAD)) {
            p.block();
            return void stream.once("drain", push);
          }
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
      ...p.api,
      [Symbol.asyncDispose]: async () => {
        for (const s of sockets) s.destroy();
        await new Promise(r => srv.close(r));
      },
    };
  }

  if (kind === "h3") {
    const p = progress(CHUNK * count);
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
              if (i++ < count) {
                p.add(CHUNK);
                ctrl.enqueue(PAYLOAD);
                // A pull-fed stream reports no failed write; past the client's mark, its pace is
                // the client's pause.
                p.block();
              } else ctrl.close();
            },
          }),
        );
      },
    });
    return { url: String(srv.url), ...p.api, [Symbol.asyncDispose]: () => srv.stop(true) };
  }

  // h1 / h1-chunked / h1-gzip / h1-tls
  // Stored blocks (level 0): the wire carries about as many bytes as the body, so the transport can
  // pause on it, and the decoder still runs over every byte.
  const gz = kind === "h1-gzip" ? gzipSync(Buffer.alloc(CHUNK * count, 65), { level: 0 }) : null;
  const p = progress(gz ? gz.length : CHUNK * count);
  const handler = (_req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    res.on("error", () => {});
    res.on("close", p.close);
    if (gz) {
      res.setHeader("content-encoding", "gzip");
      res.setHeader("content-length", String(gz.length));
      let off = 0;
      const push = () => {
        while (off < gz.length && !res.destroyed) {
          const end = Math.min(off + CHUNK, gz.length);
          const slice = gz.subarray(off, end);
          off = end;
          p.add(slice.length);
          if (!res.write(slice)) {
            p.block();
            return void res.once("drain", push);
          }
        }
        if (!res.destroyed) res.end();
      };
      return push();
    }
    if (kind === "h1" || kind === "h1-tls") res.setHeader("content-length", String(CHUNK * count));
    res.flushHeaders();
    let i = 0;
    const push = () => {
      while (i < count && !res.destroyed) {
        i++;
        p.add(CHUNK);
        if (!res.write(PAYLOAD)) {
          p.block();
          return void res.once("drain", push);
        }
      }
      if (!res.destroyed) res.end();
    };
    push();
  };
  const srv = kind === "h1-tls" ? createHttpsServer(tls, handler) : createServer(handler);
  srv.listen(0);
  await once(srv, "listening");
  const { port } = srv.address() as import("node:net").AddressInfo;
  return {
    url: `${kind === "h1-tls" ? "https" : "http"}://127.0.0.1:${port}/`,
    ...p.api,
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

// Reads a body whose server is stalled at `stalled` until the server has written a MiB more, which
// it can only do once the client takes bytes off the socket again. Then cancels the rest.
async function readUntilResumed(reader: ReadableStreamDefaultReader<Uint8Array>, server: Server, stalled: number) {
  let total = 0;
  let foreign = 0;
  let ended = false;
  while (server.sent() < stalled + 16 * CHUNK) {
    const { value, done } = await reader.read();
    if (done) {
      ended = true;
      break;
    }
    total += value.byteLength;
    if (!isAllA(value)) foreign++;
  }
  await reader.cancel();
  return { total, foreign, ended };
}

// What every client script starts with: `url`, `opts`, a `hasher` for the bytes it receives,
// `stall()`, which tells the test that the client holds its first chunk and then waits until the
// server has stopped writing, and `report(total)`.
const CLIENT = /* js */ `
  const hasher = new Bun.CryptoHasher("md5");
  async function stall() {
    process.stdout.write("stalled\\n");
    for await (const line of console) if (line === "go") break;
  }
  function report(total) {
    process.stdout.write(JSON.stringify({ total, digest: hasher.digest("hex") }) + "\\n");
  }
`;

async function spawnClient(server: Server, kind: Kind, script: string) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const url=${JSON.stringify(server.url)};const opts=${JSON.stringify(fetchOpts(kind))};${CLIENT}${script}`,
    ],
    env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0", BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: "1" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = proc.stderr.text();
  let result = "";
  for await (const line of forEachLine(proc.stdout)) {
    if (line === "stalled") {
      // The client holds its first chunk and reads no further. Let the server run into the pause
      // (or, where loopback buffers take all 16 MiB, finish) before the client goes on.
      await server.settled();
      proc.stdin.write("go\n");
      proc.stdin.end();
    } else result = line;
  }
  const exitCode = await proc.exited;
  if (!result) throw new Error(`client exited ${exitCode}: ${await stderr}`);
  return { ...JSON.parse(result), stderr: await stderr, exitCode };
}

const STALL_READER = /* js */ `
  const res = await fetch(url, opts);
  const reader = res.body.getReader();
  const first = await reader.read();
  await stall();
  hasher.update(first.value);
  let total = first.value.byteLength;
  for (let r; !(r = await reader.read()).done; ) {
    hasher.update(r.value);
    total += r.value.byteLength;
  }
  report(total);
`;

const STALL_PIPE_TO = /* js */ `
  const res = await fetch(url, opts);
  let total = 0, first = true;
  await res.body.pipeTo(new WritableStream({
    async write(chunk) {
      if (first) { first = false; await stall(); }
      hasher.update(chunk);
      total += chunk.byteLength;
    },
  }));
  report(total);
`;

const STALL_FOR_AWAIT = /* js */ `
  const res = await fetch(url, opts);
  let total = 0, first = true;
  for await (const chunk of res.body) {
    if (first) { first = false; await stall(); }
    hasher.update(chunk);
    total += chunk.byteLength;
  }
  report(total);
`;

const STALL_NO_CONSUMER = /* js */ `
  const response = await fetch(url, opts);
  await stall();
  const body = new Uint8Array(await response.arrayBuffer());
  hasher.update(body);
  report(body.byteLength);
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
      // How far the server got at the stall is not asserted: loopback buffers on some CI hosts take
      // all 16 MiB. These assert that the resume path delivers the whole body intact, that the
      // server wrote all of it, and that the client exits cleanly; the in-process "server stops
      // writing" tests below prove the pause.
      test.skipIf(skip)(`stalled ${name} drains the full body`, async () => {
        await using server = await serve(kind);
        const { total, digest, stderr, exitCode } = await spawnClient(server, kind, script);
        expect({ total, digest, sent: server.sent(), stderr }).toEqual({
          total: TOTAL,
          digest: DIGEST,
          sent: server.wire,
          stderr: "",
        });
        expect(exitCode).toBe(0);
      });
    }

    if (kind === "h1" || kind === "h1-chunked" || kind === "h1-tls") {
      test("server stops writing while the reader is stalled, then resumes", async () => {
        await using server = await serve(kind, BIG);
        const res = await fetch(server.url, fetchOpts(kind));
        const reader = res.body!.getReader();
        const first = await reader.read();
        // One chunk out and no read pending: the client pauses, and the server runs into the
        // kernel's buffers.
        const stalled = await server.settled();
        expect(stalled).toBeLessThan(BODY);
        const { total, foreign, ended } = await readUntilResumed(reader, server, stalled);
        expect({ ended, foreign, firstIsA: isAllA(first.value!), took: total > 0 && total <= server.sent() }).toEqual({
          ended: false,
          foreign: 0,
          firstIsA: true,
          took: true,
        });
      });
    }
  });
}

describe.concurrent("fetch() receive backpressure — Readable.fromWeb bridge", () => {
  // `Readable.fromWeb(res.body)` takes the native handle off the ReadableStream
  // (NativeReadable fast path) and hands chunks to node streams. A stalled
  // pipe must keep the HTTP-thread socket paused just like `getReader()` does;
  // when the pipe resumes, the body must keep coming.
  test("server stops writing while Readable.fromWeb is piped to a stalled Writable, then resumes", async () => {
    await using server = await serve("h1", BIG);
    const res = await fetch(server.url);
    let release!: () => void;
    let got = 0;
    let foreign = 0;
    let stalled = -1;
    const enough = new Error("enough");
    const sink = new Writable({
      write(chunk, _enc, cb) {
        got += chunk.length;
        if (!isAllA(chunk)) foreign++;
        // The first chunk stalls the pipe until the test releases it.
        if (!release) return void (release = cb);
        // Resumed: the server wrote a MiB past where the stall left it.
        if (server.sent() >= stalled + 16 * CHUNK) return cb(enough);
        cb();
      },
    });
    const done = pipeline(Readable.fromWeb(res.body!), sink).then(
      () => null,
      e => e,
    );

    stalled = await server.settled();
    expect(stalled).toBeLessThan(BODY);

    release();
    expect({ err: await done, foreign, took: got > 0 && got <= server.sent() }).toEqual({
      err: enough,
      foreign: 0,
      took: true,
    });
  });

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
      expect({ short, peakMB, stderr }).toEqual({ short: 0, peakMB: expect.any(Number), stderr: "" });
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
  const cases: [string, (r: Response) => Promise<string>][] = [
    ["res.arrayBuffer()", async r => md5(new Uint8Array(await r.arrayBuffer()))],
    ["res.bytes()", async r => md5(await r.bytes())],
    ["res.text()", async r => md5(await r.text())],
    ["res.blob()", async r => md5(await (await r.blob()).bytes())],
    ["res.body.bytes()", async r => md5(await r.body!.bytes())],
    ["res.body.text()", async r => md5(await r.body!.text())],
    ["res.body.blob()", async r => md5(await (await r.body!.blob()).bytes())],
    [
      "Bun.readableStreamToArrayBuffer(res.body)",
      async r => md5(new Uint8Array(await Bun.readableStreamToArrayBuffer(r.body!))),
    ],
    ["Bun.readableStreamToBytes(res.body)", async r => md5(await Bun.readableStreamToBytes(r.body!))],
    ["Bun.readableStreamToText(res.body)", async r => md5(await Bun.readableStreamToText(r.body!))],
    ["Bun.readableStreamToBlob(res.body)", async r => md5(await (await Bun.readableStreamToBlob(r.body!)).bytes())],
    [
      "Bun.readableStreamToArray(res.body)",
      async r => {
        const hasher = new Bun.CryptoHasher("md5");
        for (const chunk of await Bun.readableStreamToArray(r.body!)) hasher.update(chunk);
        return hasher.digest("hex");
      },
    ],
  ];

  for (const [name, consume] of cases) {
    test(name, async () => {
      await using server = await serve("h1");
      expect({ digest: await consume(await fetch(server.url)), sent: server.sent() }).toEqual({
        digest: DIGEST,
        sent: TOTAL,
      });
    });
  }

  // 16 MiB of "A" is not JSON. The parse only runs once the whole body is in.
  test("res.body.json() rejects on full body", async () => {
    await using server = await serve("h1");
    const err = await (await fetch(server.url)).body!.json().then(
      () => null,
      e => e,
    );
    expect({ name: err?.name, sent: server.sent() }).toEqual({ name: "SyntaxError", sent: TOTAL });
  });
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
    const body = await (await fetch(server.url, { keepalive: true })).bytes();
    expect({ length: body.byteLength, digest: md5(body) }).toEqual({ length: TOTAL, digest: DIGEST });
  });

  test("res.body.tee() both branches drain", async () => {
    await using server = await serve("h1");
    const [a, b] = (await fetch(server.url)).body!.tee();
    const sum = async (s: ReadableStream<Uint8Array>) => {
      const hasher = new Bun.CryptoHasher("md5");
      let n = 0;
      for await (const c of s) {
        n += c.byteLength;
        hasher.update(c);
      }
      return { n, digest: hasher.digest("hex") };
    };
    expect(await Promise.all([sum(a), sum(b)])).toEqual([
      { n: TOTAL, digest: DIGEST },
      { n: TOTAL, digest: DIGEST },
    ]);
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
      const blocked = Promise.withResolvers<import("bun").Socket>();
      let sent = 0;
      const push = (s: import("bun").Socket) => {
        while (sent < declared) {
          const n = s.write(PAYLOAD);
          sent += Math.max(n, 0);
          if (n < PAYLOAD.length) return void (sent > HIGH_WATER_MARK && blocked.resolve(s));
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
      let foreign = 0;
      const err = await (async () => {
        for (let r; !(r = await reader.read()).done; ) {
          total += r.value.byteLength;
          if (!isAllA(r.value)) foreign++;
        }
      })().then(
        () => null,
        e => e,
      );
      expect({ name: err?.name, code: err?.code, message: err?.message, partial: total < declared, foreign }).toEqual({
        name: "TypeError",
        code: "ECONNRESET",
        message:
          "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
        partial: true,
        foreign: 0,
      });
    });
  }

  test("two sequential keep-alive responses each drain fully", async () => {
    await using server = await serve("h1");
    for (let i = 0; i < 2; i++) {
      const reader = (await fetch(server.url, { keepalive: true })).body!.getReader();
      const first = await reader.read();
      // Hold the first chunk until the server has run into the pause (or written everything).
      await server.settled();
      const hasher = new Bun.CryptoHasher("md5").update(first.value!);
      let total = first.value!.byteLength;
      for (let r; !(r = await reader.read()).done; ) {
        total += r.value.byteLength;
        hasher.update(r.value);
      }
      expect({ total, digest: hasher.digest("hex") }).toEqual({ total: TOTAL, digest: DIGEST });
    }
    expect(server.sent()).toBe(2 * TOTAL);
  });
});

// A body stream that exists but that nothing reads: `res.body` was touched, or its reader
// was released. Before, the first chunk delivered to such a stream switched the fetch over
// to buffering the rest of the body in memory, with no bound, and kept the process alive
// while it did. The transport has to stay paused instead (the bytes have nowhere to go),
// the stream has to stay readable, and the paused body must not hold an idle process.

// Sends the headers and one chunk; the test writes the rest through `response`.
async function serveByHand() {
  let respond!: (res: import("node:http").ServerResponse) => void;
  const response = new Promise<import("node:http").ServerResponse>(resolve => (respond = resolve));
  const srv = createServer((_req, res) => {
    res.on("error", () => {});
    res.flushHeaders();
    res.write(PAYLOAD);
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

describe.concurrent("fetch() receive backpressure — body stream nothing is reading", () => {
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
      await using server = await serve("h1-chunked", BIG);
      const body = await shape(await fetch(server.url));

      const stalled = await server.settled();
      expect(stalled).toBeLessThan(BODY);

      const { total, foreign, ended } = await readUntilResumed(body.getReader(), server, stalled);
      expect({ ended, foreign, took: total > 0 && total <= server.sent() }).toEqual({
        ended: false,
        foreign: 0,
        took: true,
      });
      // cancel() closed the connection.
      await server.closed;
    });
  }

  // The other ways back to a parked body: a buffered read and a native sink both have to
  // pick the transport up again and see the whole body.
  for (const [name, drain] of [
    ["res.text()", (res: Response) => res.text().then(md5)],
    ["HTMLRewriter.transform(res)", (res: Response) => new HTMLRewriter().on("x", {}).transform(res).bytes().then(md5)],
  ] as const) {
    test(`res.body read by nothing, then ${name} drains the whole body`, async () => {
      await using server = await serve("h1");
      const res = await fetch(server.url);
      void res.body;
      // Let the client park (16 MiB body, 256 KiB mark): wait until bytes stop moving. How far
      // the server got is not asserted; loopback buffers on some hosts can take the whole body.
      await server.settled();
      expect({ digest: await drain(res), sent: server.sent() }).toEqual({ digest: DIGEST, sent: TOTAL });
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
  const frame =
    framing === "chunked"
      ? Buffer.concat([Buffer.from(`${CHUNK.toString(16)}\r\n`), PAYLOAD, Buffer.from("\r\n")])
      : PAYLOAD;
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

describe.concurrent("fetch() receive backpressure — a Response whose body nothing touches", () => {
  const N = 4;

  test("a long body, Response held untouched: the process is not held and the body stays where it is", async () => {
    await using server = await serve("h1-chunked", BIG);
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
describe.concurrent("S3 receive backpressure", () => {
  // A GET-only fake bucket: every object is BODY bytes written as fast as the socket takes them.
  async function fakeBucket() {
    const server = await serve("h1-chunked", BIG);
    const s3 = new S3Client({ accessKeyId: "test", secretAccessKey: "test", endpoint: server.url, bucket: "b" });
    return Object.assign(server, { s3 });
  }

  test("a reader that stalls and comes back drains the body; cancel() closes the connection", async () => {
    await using bucket = await fakeBucket();
    const reader = bucket.s3.file("big").stream().getReader();
    const first = await reader.read();
    const stalled = await bucket.settled();
    expect(stalled).toBeLessThan(BODY);
    const { total, foreign, ended } = await readUntilResumed(reader, bucket, stalled);
    expect({ ended, foreign, firstIsA: isAllA(first.value!), took: total > 0 && total <= bucket.sent() }).toEqual({
      ended: false,
      foreign: 0,
      firstIsA: true,
      took: true,
    });
    await bucket.closed;
  });

  test("Bun.write(file, s3file) streams to disk with the byte count", async () => {
    using dir = tempDir("s3-to-file", {});
    await using server = await serve("h1");
    const s3 = new S3Client({ accessKeyId: "test", secretAccessKey: "test", endpoint: server.url, bucket: "b" });
    const dest = join(String(dir), "out.bin");
    expect(await Bun.write(dest, s3.file("k"))).toBe(TOTAL);
    expect({ size: statSync(dest).size, digest: md5(await Bun.file(dest).bytes()), sent: server.sent() }).toEqual({
      size: TOTAL,
      digest: DIGEST,
      sent: TOTAL,
    });
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
    await bucket.settled();
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
    const err = await s3
      .file("denied")
      .stream()
      .getReader()
      .read()
      .then(
        () => null,
        e => e,
      );
    expect({ name: err?.name, code: err?.code, message: err?.message }).toEqual({
      name: "S3Error",
      code: "AccessDenied",
      message,
    });
  });

  // The other direction: a fetch body uploaded to S3. The multipart sink's queue back-pressures
  // the fetch, and both `Bun.write(s3file, res)` and `s3file.writer()` resolve with the bytes sent.
  async function fakeUploadBucket(holdParts?: Promise<void>) {
    let uploaded = 0;
    let foreign = 0;
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
          const body = await req.bytes();
          firstPart.resolve();
          await holdParts;
          uploaded += body.byteLength;
          if (!isAllA(body)) foreign++;
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
      foreign: () => foreign,
      completed: () => completed,
    });
  }

  test("fetch → Bun.write(s3file, res) is paced by the part uploads, and an aborted source commits nothing", async () => {
    const hold = Promise.withResolvers<void>();
    await using origin = await serve("h1-chunked", BIG);
    await using bucket = await fakeUploadBucket(hold.promise);
    const abort = new AbortController();
    // partSize 5 MiB × queueSize 1: with the first part held, the sink fills and the origin has
    // to stop long before its 1 GiB is out.
    const written = Bun.write(
      bucket.s3.file("up", { partSize: 5 * 1024 * 1024, queueSize: 1 }),
      await fetch(origin.url, { signal: abort.signal }),
    );
    await bucket.firstPart;
    expect(await origin.settled()).toBeLessThan(BODY);
    // Aborting the source fails the upload: nothing is committed.
    abort.abort();
    hold.resolve();
    const err = await written.then(
      () => null,
      e => e,
    );
    expect({ name: err?.name, message: err?.message, completed: bucket.completed() }).toEqual({
      name: "AbortError",
      message: "The operation was aborted.",
      completed: 0,
    });
  });

  test("Bun.write(s3file, res) resolves with the byte count", async () => {
    await using origin = await serve("h1");
    await using bucket = await fakeUploadBucket();
    expect(await Bun.write(bucket.s3.file("up"), await fetch(origin.url))).toBe(TOTAL);
    expect({ uploaded: bucket.uploaded(), foreign: bucket.foreign(), completed: bucket.completed() }).toEqual({
      uploaded: TOTAL,
      foreign: 0,
      completed: 1,
    });
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
      await using server = await serve("h1-chunked", BIG);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `const res = await fetch(${JSON.stringify(server.url)}); ${script} ${diagnose}`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = proc.stderr.text();
      // Took the whole body: it is draining. Still around after 10 s with little taken: it is
      // holding the paused body. Neither exited.
      let deadline!: ReturnType<typeof setTimeout>;
      const outcome = await Promise.race([
        proc.exited.then(exitCode => ({ exitCode })),
        server.wrote(BODY).then(() => ({ stillAlive: true, drained: true })),
        new Promise<{ stillAlive: true; serverSentKiB: number }>(resolve => {
          deadline = setTimeout(() => resolve({ stillAlive: true, serverSentKiB: server.sent() >> 10 }), 10_000);
        }),
      ]);
      clearTimeout(deadline);
      if ("stillAlive" in outcome) proc.kill();
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
        // The test writes a chunk on "released" and says "go" once the socket took it: that chunk
        // arrives while nothing reads the body.
        for await (const line of console) if (line === "go") break;
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
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = proc.stderr.text();
      const upstream = await server.response;
      const lines: string[] = [];
      for await (const line of forEachLine(proc.stdout)) {
        lines.push(line);
        if (line === "released")
          upstream.write(Buffer.alloc(CHUNK, 66), () => {
            proc.stdin.write("go\n");
            proc.stdin.end();
          });
        if (line === "waiting") upstream.end(Buffer.alloc(CHUNK, 67));
      }
      expect({ lines: lines.slice(-2), stderr: await stderr, exitCode: await proc.exited }).toEqual({
        lines: ["waiting", `total ${chunks * CHUNK}`],
        stderr: "",
        exitCode: 0,
      });
    });
  }
});

// Serial on purpose: both count the connections a pooled client opens, and a connection is back in
// the pool only once the HTTP thread has taken the last of its body. A sibling test keeping that
// thread busy would turn a late return into an extra connection.
describe.serial("fetch() receive backpressure — an unread body hands its connection back", () => {
  // A small body nobody reads is still taken off the socket, so the keep-alive connection goes
  // back to the pool instead of staying pinned under it.
  test("small unread bodies complete and their connection is reused", async () => {
    // The body trails the headers in several packets; the last one is held until the Response
    // exists and its body is a stream nothing reads, so it reaches such a stream chunk by chunk.
    // The client has to keep taking it (it is under the high-water mark) for the response to
    // finish and the connection to go back to the pool. A client that parks on the first unread
    // chunk needs a new connection for every request here.
    const PART = 32 * 1024;
    const PARTS = 4;
    let connections = 0;
    let lastPart = Promise.withResolvers<void>();
    let finished = Promise.withResolvers<void>();
    const srv = createServer(async (_req, res) => {
      res.on("finish", () => finished.resolve());
      res.setHeader("content-length", String(PART * PARTS));
      res.flushHeaders();
      for (let i = 0; i < PARTS - 1; i++) await new Promise(r => res.write(Buffer.alloc(PART, 65), r));
      await lastPart.promise;
      res.end(Buffer.alloc(PART, 65));
    }).on("connection", () => connections++);
    srv.listen(0);
    await once(srv, "listening");
    try {
      const url = `http://127.0.0.1:${(srv.address() as import("node:net").AddressInfo).port}/`;
      const N = 10;
      for (let i = 0; i < N; i++) {
        lastPart = Promise.withResolvers();
        finished = Promise.withResolvers();
        const res = await fetch(url);
        expect(res.status).toBe(200);
        void res.body;
        lastPart.resolve();
        await finished.promise;
      }
      // Not exactly 1: a request can start before the previous body's last packet was taken.
      expect(connections).toBeLessThan(N / 2);
    } finally {
      srv.closeAllConnections();
      await new Promise(r => srv.close(() => r(undefined)));
    }
  });

  // Not close-delimited: such a body ends with its connection, so there is nothing to reuse.
  for (const framing of ["content-length", "chunked"] as Framing[]) {
    test(`a short ${framing} body, Response still held: it is received, and its connection is reused`, async () => {
      const N = 4;
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
      for (let i = 0; i < N; i++) {
        const body = await (await fetch(origin.url)).bytes();
        expect({ length: body.byteLength, allA: isAllA(body) }).toEqual({ length: 2 * CHUNK, allA: true });
      }
      expect(origin.connections() - N).toBeLessThanOrEqual(1);
      expect({ closed: origin.closed(), held: responses.length }).toEqual({ closed: 0, held: N });
    });
  }
});
