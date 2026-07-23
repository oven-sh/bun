// Receive-side backpressure: a stalled `res.body.getReader()` must stop the
// HTTP thread from buffering the entire response in memory.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls } from "harness";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createSecureServer } from "node:http2";
import { createServer as createHttpsServer } from "node:https";
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
  async function settleRss() {
    const before = process.memoryUsage.rss();
    let last = before, stable = 0;
    while (stable < 3) {
      await Bun.sleep(20);
      const now = process.memoryUsage.rss();
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
      const { promise, resolve } = Promise.withResolvers<import("bun").Socket>();
      using listener = Bun.listen({
        port: 0,
        hostname: "127.0.0.1",
        socket: {
          open(s) {
            // Declared length far exceeds what is sent, so the client parks
            // in the body stage (and pauses) right after this first chunk.
            s.write(`HTTP/1.1 200 OK\r\nContent-Length: ${TOTAL}\r\n\r\n` + Buffer.alloc(CHUNK, 65).toString());
            s.flush();
            resolve(s);
          },
          data() {},
        },
      });
      // By the time fetch() resolves, the first body chunk was delivered with
      // more expected, so the transport is paused; nothing re-arms it until
      // the body is pulled.
      const res = await fetch(`http://127.0.0.1:${listener.port}/`);
      kill(await promise);
      const reader = res.body!.getReader();
      let total = 0;
      const err = await (async () => {
        for (let r; !(r = await reader.read()).done; ) total += r.value.byteLength;
      })().then(
        () => null,
        e => e,
      );
      expect({ code: err?.code, partial: total < TOTAL }).toEqual({ code: "ECONNRESET", partial: true });
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

// Runs in a child so BUN_CONFIG_MAX_HTTP_REQUESTS can be capped without
// affecting the rest of the suite. Before the fix the retain loop wedged at
// the cap and both probes reported HUNG, even the one to a fresh origin.
test("retained unread Responses do not starve later fetch() requests", async () => {
  const fixture = /* js */ `
    import { createServer } from "node:http";
    import { once } from "node:events";

    const body = Buffer.alloc(512 * 1024, 97);
    async function mk() {
      const s = createServer((_, w) => { w.setHeader("content-length", body.length); w.end(body); });
      s.listen(0, "127.0.0.1");
      await once(s, "listening");
      return s;
    }
    const s1 = await mk(), s2 = await mk();
    const O1 = "http://127.0.0.1:" + s1.address().port;
    const O2 = "http://127.0.0.1:" + s2.address().port;

    const race = (p, ms) => Promise.race([
      p.then(v => ({ ok: true, v })),
      new Promise(r => setTimeout(() => r({ ok: false }), ms)),
    ]);

    const hold = [];
    let wedgedAt = 0;
    for (let i = 1; i <= 12; i++) {
      const r = await race(fetch(O1 + "/x" + i), 3000);
      if (!r.ok) { wedgedAt = i; break; }
      hold.push(r.v);
    }

    const same   = await race(fetch(O1 + "/same").then(r => r.arrayBuffer()), 3000);
    const second = await race(fetch(O2 + "/second").then(r => r.arrayBuffer()), 3000);

    // Draining a retained Response must re-acquire the slot and let the
    // body finish so the counter stays balanced.
    const drained = hold[0] ? (await hold[0].arrayBuffer()).byteLength : 0;

    process.stdout.write(JSON.stringify({
      wedgedAt,
      retained: hold.length,
      same: same.ok,
      second: second.ok,
      drained,
    }));

    hold.length = 0;
    s1.closeAllConnections(); s1.close();
    s2.closeAllConnections(); s2.close();
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, BUN_CONFIG_MAX_HTTP_REQUESTS: "4" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const filteredStderr = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(filteredStderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    wedgedAt: 0,
    retained: 12,
    same: true,
    second: true,
    drained: 512 * 1024,
  });
  expect(exitCode).toBe(0);
}, 30_000);
