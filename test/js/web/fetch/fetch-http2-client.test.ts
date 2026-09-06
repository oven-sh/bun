import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tls } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import nodetls from "node:tls";
import zlib from "node:zlib";

// `protocol: "http2"` offers only h2 in ALPN, so these fetches run in the test
// process without the startup-only BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT
// env var. Everything after ALPN selects h2 is the same code path either way.
// The tests about the flag itself and about ALPN negotiation spawn a subprocess.
const tlsOpts = { rejectUnauthorized: false };
function h2(url: string, init: BunFetchRequestInit & { duplex?: "half" } = {}) {
  return fetch(url, { protocol: "http2", tls: tlsOpts, ...init });
}

type Listening = { url: string; port: number; [Symbol.dispose](): void };

// Listens on port 0. Dispose destroys every accepted socket so the client's
// pooled h2 session to this port is dropped; a later test whose server lands
// on a reused port must never reach this server's handler.
async function listen(server: net.Server, { scheme = "https", host = "" } = {}): Promise<Listening> {
  const sockets = new Set<net.Socket>();
  server.on("connection", s => {
    sockets.add(s);
    s.once("close", () => sockets.delete(s));
  });
  if (host) server.listen(0, host);
  else server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `${scheme}://${host || "localhost"}:${port}`,
    port,
    [Symbol.dispose]() {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

// allowHTTP1: false forces the server to reject anything that didn't
// negotiate "h2" via ALPN, so these tests only pass when fetch actually
// speaks HTTP/2 on the wire.
//
// Dispose tears the TLS socket down under a live session, so the server-side
// socket sees ECONNRESET. http2's tlsClientError handler forwards that to
// socket.destroy(err) when there's no clientError listener, which surfaces as
// an unhandled 'error' event in the test process: swallow those.
function makeH2Server(
  opts: http2.SecureServerOptions = {},
  handler?: (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => void,
) {
  const server = http2.createSecureServer({ ...tls, allowHTTP1: false, ...opts }, handler);
  server.on("clientError", () => {});
  server.on("secureConnection", s => s.on("error", () => {}));
  return server;
}

// --- Raw HTTP/2 frame server -------------------------------------------------
// Minimal TLS+ALPN(h2) server that speaks the wire format directly so tests
// can inject frames that a conforming server (nghttp2) would never emit.

function frame(type: number, flags: number, streamId: number, payload: Uint8Array | Buffer = Buffer.alloc(0)) {
  const buf = Buffer.alloc(9 + payload.length);
  buf.writeUIntBE(payload.length, 0, 3);
  buf[3] = type;
  buf[4] = flags;
  buf.writeUInt32BE(streamId & 0x7fffffff, 5);
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(buf, 9);
  return buf;
}
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};

const FT_DATA = 0;
const FT_HEADERS = 1;
const FT_RST_STREAM = 3;
const FT_SETTINGS = 4;
const FT_PING = 6;
const FT_WINDOW_UPDATE = 8;
const FLAG_END_STREAM = 1;

// HPACK static-table indices we need.
const hpackStatus = (code: 100 | 200 | 204 | 404) =>
  code === 100
    ? Buffer.concat([Buffer.from([0x10, 7]), Buffer.from(":status"), Buffer.from([3]), Buffer.from("100")])
    : Buffer.from([0x80 | { 200: 8, 204: 9, 404: 13 }[code]]);
// Literal field never-indexed, new name (4-bit prefix 0001 0000): len(name) name len(value) value.
const hpackLit = (name: string, value: string) =>
  Buffer.concat([Buffer.from([0x10, name.length]), Buffer.from(name), Buffer.from([value.length]), Buffer.from(value)]);

type RawConn = {
  socket: nodetls.TLSSocket;
  settings(): void;
  headers(streamId: number, block: Buffer, opts?: { endStream?: boolean; endHeaders?: boolean }): void;
  data(streamId: number, chunk: string | Buffer, endStream?: boolean): void;
  rst(streamId: number, code: number): void;
  goaway(lastId: number, code: number): void;
};

type Frame = { id: number; type: number; flags: number; len: number };

type RawServer = Listening & {
  readonly connections: number;
  /** Every client frame in arrival order, all connections. */
  frames: Frame[];
  rst: Array<{ id: number; code: number }>;
  /** Resolves with the first recorded frame matching `pred`, past or future. */
  waitForFrame(pred: (f: Frame) => boolean): Promise<Frame>;
};

async function rawH2Server(
  onStream: (conn: RawConn, streamId: number, connIndex: number) => void,
  opts: {
    /** Runs once the client preface arrived. Default: send an empty SETTINGS. */
    onPreface?: (conn: RawConn) => void;
    onFrame?: (conn: RawConn, f: Frame, payload: Buffer) => void;
  } = {},
): Promise<RawServer> {
  let connections = 0;
  const frames: Frame[] = [];
  const rst: RawServer["rst"] = [];
  const waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];
  const server = nodetls.createServer({ ...tls, ALPNProtocols: ["h2"] }, socket => {
    const connIndex = connections++;
    const conn: RawConn = {
      socket,
      settings: () => socket.write(frame(FT_SETTINGS, 0, 0)),
      headers: (id, block, o = {}) =>
        socket.write(
          frame(FT_HEADERS, (o.endHeaders === false ? 0 : 4) | (o.endStream ? FLAG_END_STREAM : 0), id, block),
        ),
      data: (id, chunk, end = false) =>
        socket.write(
          frame(FT_DATA, end ? FLAG_END_STREAM : 0, id, typeof chunk === "string" ? Buffer.from(chunk) : chunk),
        ),
      rst: (id, code) => socket.write(frame(FT_RST_STREAM, 0, id, u32be(code))),
      goaway: (lastId, code) => socket.write(frame(7, 0, 0, Buffer.concat([u32be(lastId), u32be(code)]))),
    };
    let buf = Buffer.alloc(0);
    let prefaceSeen = false;
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!prefaceSeen) {
        if (buf.length < 24) return;
        buf = buf.subarray(24);
        prefaceSeen = true;
        (opts.onPreface ?? (c => c.settings()))(conn);
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) return;
        const f: Frame = { id: buf.readUInt32BE(5) & 0x7fffffff, type: buf[3], flags: buf[4], len };
        const payload = buf.subarray(9, 9 + len);
        buf = buf.subarray(9 + len);
        if (f.type === FT_SETTINGS && !(f.flags & 1)) socket.write(frame(FT_SETTINGS, 1, 0)); // ack their SETTINGS
        if (f.type === FT_RST_STREAM) rst.push({ id: f.id, code: payload.readUInt32BE(0) });
        frames.push(f);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].pred(f)) waiters.splice(i, 1)[0].resolve(f);
        }
        opts.onFrame?.(conn, f, payload);
        if (f.type === FT_HEADERS) onStream(conn, f.id, connIndex); // HEADERS opens a stream
      }
    });
    socket.on("error", () => {});
  });
  const listening = await listen(server);
  return {
    ...listening,
    get connections() {
      return connections;
    },
    frames,
    rst,
    waitForFrame(pred) {
      const hit = frames.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise(resolve => waiters.push({ pred, resolve }));
    },
  };
}

// Plain TCP server that never speaks TLS, so an h2 fetch to it sits in its
// handshake until aborted. `settle()` sends a plain-http sentinel fetch through
// the same HTTP thread and resolves, with the accept count, once the server
// reads the sentinel's request line. Loopback connects are accepted in the
// order they were issued, so every h2 connect issued before the sentinel is in
// that count; a sleep would only guess at that.
async function silentTcpServer() {
  let conns = 0;
  const accepts: Array<() => void> = [];
  let sentinel = Promise.withResolvers<void>();
  const server = net.createServer(sock => {
    conns++;
    for (const r of accepts.splice(0)) r();
    sock.on("error", () => {});
    sock.once("data", d => {
      if (d[0] !== 0x16) sentinel.resolve(); // not a TLS record: the sentinel's "GET / HTTP/1.1"
    });
  });
  const listening = await listen(server, { host: "127.0.0.1" });
  return {
    ...listening,
    get conns() {
      return conns;
    },
    nextAccept: () => new Promise<void>(r => accepts.push(r)),
    async settle() {
      const ac = new AbortController();
      const sentinelFetch = fetch(`http://127.0.0.1:${listening.port}/`, { signal: ac.signal }).catch(() => {});
      await sentinel.promise;
      sentinel = Promise.withResolvers<void>();
      const seen = conns;
      ac.abort();
      await sentinelFetch;
      return seen;
    },
  };
}

// The env-flag and ALPN tests below need a fresh process because the flag is
// read at startup. Under ASAN each debug subprocess is large, so cap how many
// are alive at once; the in-process tests keep running meanwhile.
const slotLimit = isASAN ? 4 : 20;
let live = 0;
const waiters: Array<() => void> = [];
async function spawnCapped(options: Parameters<typeof Bun.spawn>[0]) {
  if (live >= slotLimit) {
    await new Promise<void>(r => waiters.push(r)); // slot handed off to us, `live` already counts it
  } else {
    live++;
  }
  const proc = Bun.spawn(options);
  proc.exited.finally(() => {
    const next = waiters.shift();
    if (next)
      next(); // hand the slot off directly; `live` stays as-is
    else live--;
  });
  return proc;
}

function spawnFetch(script: string, extraEnv: Record<string, string> = {}) {
  return spawnCapped({
    cmd: [bunExe(), "--no-warnings", "-e", script],
    env: {
      ...bunEnv,
      BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: "1",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

// https://github.com/oven-sh/bun/issues/16682 (h2 aggregate path): the
// session's shared socket timer is the max over every attached client's
// effective idle deadline.
//
// This holds every request for 10s, so it runs first and overlaps the rest of
// the file. A 1s idle timeout is padded to 5s and rounded to two 4s sweep
// ticks by uSockets, so it can fire as late as 8s after arming; the hold has
// to outlast that to prove the short deadline was really ignored.
test.concurrent(
  "h2: per-request `timeout` extends the session idle deadline, and {timeout:false} is not killed by a sibling's shorter explicit timeout",
  async () => {
    const HOLD_MS = 10_000;
    const holdTimers = new Set<ReturnType<typeof setTimeout>>();
    using srv = await listen(
      makeH2Server({}, (_req, res) => {
        const timer = setTimeout(() => {
          holdTimers.delete(timer);
          try {
            res.end("hello");
          } catch {}
        }, HOLD_MS);
        holdTimers.add(timer);
      }),
    );
    try {
      const run = async (idleDefault: string, body: string) => {
        await using proc = await spawnFetch(
          /* js */ `
            const url = ${JSON.stringify(srv.url)};
            const get = init => fetch(url, { tls: { rejectUnauthorized: false }, ...init })
              .then(r => r.text(), e => "ERR:" + (e?.code ?? e?.name ?? e));
            ${body}
          `,
          { BUN_CONFIG_HTTP_IDLE_TIMEOUT: idleDefault },
        );
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout: stdout.trim(), stderr, exitCode };
      };
      const [extendsDefault, floorsSibling, disarmsOnGlobalZero] = await Promise.all([
        // Global idle default = 1s. `{timeout:60000}` must extend the shared
        // socket's deadline past the 10s hold; the `{timeout:false}` sibling
        // coalesces onto the same session and rides along.
        run(
          "1",
          /* js */ `
            const [longTimeout, noTimeout] = await Promise.all([
              get({ timeout: 60_000 }),
              get({ timeout: false }),
            ]);
            console.log(JSON.stringify({ longTimeout, noTimeout }));
          `,
        ),
        // Global idle default = 20s. `{timeout:false}` contributes 0 to the
        // session max and the `{timeout:1000}` sibling contributes 1s; the
        // session must floor at the 20s global default so the no-timeout
        // stream is not killed by the sibling's short explicit deadline.
        run(
          "20",
          /* js */ `
            const [noTimeout, shortTimeout] = await Promise.all([
              get({ timeout: false }),
              get({ timeout: 1000 }),
            ]);
            console.log(JSON.stringify({ noTimeout, shortTimeout }));
          `,
        ),
        // Global idle default = 0 (disabled). A plain fetch with no `timeout`
        // option inherits effective deadline 0 without setting the
        // `disable_timeout` flag; the session must still disarm rather than
        // letting the `{timeout:1000}` sibling arm the shared socket.
        run(
          "0",
          /* js */ `
            const [plain, shortTimeout] = await Promise.all([
              get(undefined),
              get({ timeout: 1000 }),
            ]);
            console.log(JSON.stringify({ plain, shortTimeout }));
          `,
        ),
      ]);
      expect(extendsDefault).toEqual({
        stdout: JSON.stringify({ longTimeout: "hello", noTimeout: "hello" }),
        stderr: "",
        exitCode: 0,
      });
      expect(floorsSibling).toEqual({
        stdout: JSON.stringify({ noTimeout: "hello", shortTimeout: "hello" }),
        stderr: "",
        exitCode: 0,
      });
      expect(disarmsOnGlobalZero).toEqual({
        stdout: JSON.stringify({ plain: "hello", shortTimeout: "hello" }),
        stderr: "",
        exitCode: 0,
      });
    } finally {
      for (const timer of holdTimers) clearTimeout(timer);
    }
  },
  60_000,
);

describe.concurrent("fetch() over HTTP/2", () => {
  test("GET: status, headers and body round-trip", async () => {
    using srv = await listen(
      makeH2Server({}, (req, res) => {
        res.setHeader("x-seen-path", req.url);
        res.setHeader("x-seen-method", req.method);
        res.setHeader("x-seen-foo", String(req.headers["x-foo"]));
        res.setHeader("x-http-version", req.httpVersion);
        res.writeHead(201, { "content-type": "text/plain" });
        res.end("hello over h2");
      }),
    );
    const res = await h2(srv.url + "/hello?x=1", { headers: { "X-Foo": "bar" } });
    expect({
      status: res.status,
      ct: res.headers.get("content-type"),
      seenPath: res.headers.get("x-seen-path"),
      seenMethod: res.headers.get("x-seen-method"),
      seenFoo: res.headers.get("x-seen-foo"),
      httpVersion: res.headers.get("x-http-version"),
      body: await res.text(),
    }).toEqual({
      status: 201,
      ct: "text/plain",
      seenPath: "/hello?x=1",
      seenMethod: "GET",
      seenFoo: "bar",
      httpVersion: "2.0",
      body: "hello over h2",
    });
  });

  test("POST: request body is delivered as DATA frames", async () => {
    using srv = await listen(
      makeH2Server({}, (req, res) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", c => (body += c));
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ got: body, method: req.method }));
        });
      }),
    );
    const res = await h2(srv.url + "/echo", { method: "POST", body: "the payload" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ got: "the payload", method: "POST" });
  });

  test("response body larger than one DATA frame", async () => {
    const big = Buffer.alloc(70_000, "a");
    using srv = await listen(
      makeH2Server({}, (_req, res) => {
        res.writeHead(200);
        res.end(big);
      }),
    );
    const res = await h2(srv.url);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(big)).toBe(true);
  });

  test("gzip content-encoding is decompressed", async () => {
    const payload = "compressed body via h2";
    const gz = zlib.gzipSync(payload);
    using srv = await listen(
      makeH2Server({}, (_req, res) => {
        res.writeHead(200, { "content-encoding": "gzip", "content-type": "text/plain" });
        res.end(gz);
      }),
    );
    const res = await h2(srv.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(payload);
  });

  test("concurrent requests multiplex on one h2 session", async () => {
    let sessions = 0;
    const held: Array<{ stream: http2.ServerHttp2Stream; path: string }> = [];
    const server = makeH2Server();
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      const path = String(headers[":path"]);
      if (path === "/warmup") {
        stream.respond({ ":status": 200 });
        stream.end(path);
        return;
      }
      // Respond only once all 8 streams are open at the same time. That is the
      // proof they multiplexed; a client that serialised them would hang here.
      held.push({ stream, path });
      if (held.length === 8) {
        for (const h of held) {
          h.stream.respond({ ":status": 200 });
          h.stream.end(h.path);
        }
      }
    });
    using srv = await listen(server);
    // Warmup so the session exists before the concurrent burst.
    expect(await h2(srv.url + "/warmup").then(r => r.text())).toBe("/warmup");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => h2(srv.url + "/" + i).then(r => r.text())));
    expect(results).toEqual(["/0", "/1", "/2", "/3", "/4", "/5", "/6", "/7"]);
    expect(sessions).toBe(1);
  });

  test("POST with ReadableStream body streams as raw DATA frames", async () => {
    let received = "";
    using srv = await listen(
      makeH2Server({}, (req, res) => {
        req.setEncoding("utf8");
        req.on("data", c => (received += c));
        req.on("end", () => {
          res.writeHead(200, { "x-len": String(received.length) });
          res.end(received);
        });
      }),
    );
    const chunks = ["alpha-", "bravo-", "charlie-", "delta-", "echo"];
    let i = 0;
    // One chunk per pull, so each one is framed on its own.
    const body = new ReadableStream({
      pull(ctrl) {
        if (i < chunks.length) ctrl.enqueue(new TextEncoder().encode(chunks[i++]));
        else ctrl.close();
      },
    });
    const res = await h2(srv.url + "/stream", { method: "POST", body, duplex: "half" });
    expect([res.status, res.headers.get("x-len"), await res.text()]).toEqual([
      200,
      "30",
      "alpha-bravo-charlie-delta-echo",
    ]);
    // No chunked-encoding artifacts leaked into the framed body.
    expect(received).toBe("alpha-bravo-charlie-delta-echo");
  });

  test("concurrent ReadableStream uploads route each chunk to its own stream", async () => {
    // Exercises the async_http_id -> stream index on the client session: each
    // JS-side body chunk wakes the HTTP thread which must resolve the target
    // stream without crossing the other 23 in-flight uploads.
    let sessions = 0;
    const server = makeH2Server();
    server.on("session", () => sessions++);
    server.on("stream", stream => {
      const chunks: Buffer[] = [];
      stream.on("data", c => chunks.push(c));
      stream.on("end", () => {
        stream.respond({ ":status": 200 });
        stream.end(Buffer.concat(chunks));
      });
    });
    using srv = await listen(server);
    const N = 24,
      M = 24;
    // Warmup so the h2 session exists and SETTINGS have been exchanged
    // before the concurrent burst; otherwise requests can fan out to
    // additional connections while the first is still handshaking.
    expect(await h2(srv.url, { method: "POST", body: "warmup" }).then(r => r.text())).toBe("warmup");
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => {
        let k = 0;
        const body = new ReadableStream({
          pull(ctrl) {
            if (k < M) {
              ctrl.enqueue(new TextEncoder().encode(i + ":" + k + ","));
              k++;
            } else ctrl.close();
          },
        });
        return h2(srv.url, { method: "POST", body, duplex: "half" }).then(r => r.text());
      }),
    );
    expect(results).toEqual(
      Array.from({ length: N }, (_, i) => Array.from({ length: M }, (_, k) => i + ":" + k + ",").join("")),
    );
    expect(sessions).toBe(1);
  });

  test("POST with ReadableStream body larger than initial send window", async () => {
    using srv = await listen(
      makeH2Server({}, (req, res) => {
        let total = 0;
        req.on("data", c => (total += c.length));
        req.on("end", () => {
          res.writeHead(200);
          res.end(String(total));
        });
      }),
    );
    // 256 KiB > 64 KiB default INITIAL_WINDOW_SIZE: requires the
    // client to honour the server's WINDOW_UPDATE before continuing.
    const buf = new Uint8Array(256 * 1024).fill(0x61);
    const body = new ReadableStream({
      start(ctrl) {
        for (let i = 0; i < 4; i++) ctrl.enqueue(buf.subarray(i * 65536, (i + 1) * 65536));
        ctrl.close();
      },
    });
    const res = await h2(srv.url + "/big", { method: "POST", body, duplex: "half" });
    expect([res.status, await res.text()]).toEqual([200, "262144"]);
  });

  test("upload larger than the write-buffer high-water mark when the peer window never runs out", async () => {
    // The peer advertises a 1 MiB stream window and a 16 MiB connection
    // window, so flow control never pauses a 2 MB body; the client must keep
    // framing after a flush that fully drains instead of waiting for a
    // writable event that never comes.
    const received = new Map<number, number>();
    using srv = await rawH2Server(() => {}, {
      onPreface(conn) {
        // SETTINGS_INITIAL_WINDOW_SIZE (0x4) = 1 MiB, then open the connection window by 16 MiB.
        conn.socket.write(frame(FT_SETTINGS, 0, 0, Buffer.concat([Buffer.from([0, 4]), u32be(1 << 20)])));
        conn.socket.write(frame(FT_WINDOW_UPDATE, 0, 0, u32be(1 << 24)));
      },
      onFrame(conn, f) {
        if (f.type !== FT_DATA) return;
        received.set(f.id, (received.get(f.id) ?? 0) + f.len);
        // Top the stream window back up in 1 MiB steps so it is never the limiter.
        if ((received.get(f.id)! & ((1 << 20) - 1)) < f.len)
          conn.socket.write(frame(FT_WINDOW_UPDATE, 0, f.id, u32be(1 << 20)));
        if (f.flags & FLAG_END_STREAM) {
          conn.headers(f.id, hpackStatus(200));
          conn.data(f.id, String(received.get(f.id)), true);
        }
      },
    });
    const one = await h2(srv.url, { method: "POST", body: new Blob([new Uint8Array(2_000_000)]) });
    expect([one.status, await one.text()]).toEqual([200, "2000000"]);
    const many = await Promise.all(
      Array.from({ length: 4 }, () =>
        h2(srv.url, { method: "POST", body: new Blob([new Uint8Array(512 * 1024)]) }).then(r => r.text()),
      ),
    );
    expect(many).toEqual(["524288", "524288", "524288", "524288"]);
  });

  test("cold-start: parallel requests coalesce onto one TLS connect", async () => {
    let sessions = 0;
    const server = makeH2Server();
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      stream.respond({ ":status": 200 });
      stream.end(String(headers[":path"]));
    });
    using srv = await listen(server);
    // No warmup: all 12 race the same fresh handshake.
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => h2(srv.url + "/" + i).then(r => r.text())));
    expect(results).toEqual(Array.from({ length: 12 }, (_, i) => "/" + i));
    expect(sessions).toBe(1);
  });

  test("abort sends RST_STREAM(CANCEL); siblings on the session survive", async () => {
    let sessions = 0;
    const { promise: slowRstCode, resolve: resolveSlowRstCode } = Promise.withResolvers<number>();
    const server = makeH2Server();
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      if (headers[":path"] === "/slow") {
        stream.on("close", () => resolveSlowRstCode(stream.rstCode));
        // never respond; client will abort
      } else {
        stream.respond({ ":status": 200 });
        stream.end("survivor");
      }
    });
    using srv = await listen(server);
    // Warmup so /slow, /fast, /after share one session.
    expect(await h2(srv.url + "/warmup").then(r => r.text())).toBe("survivor");
    const ac = new AbortController();
    const slow = h2(srv.url + "/slow", { signal: ac.signal }).then(
      () => "resolved",
      e => "aborted:" + e.name,
    );
    expect(await h2(srv.url + "/fast").then(r => r.text())).toBe("survivor");
    ac.abort();
    expect(await slow).toBe("aborted:AbortError");
    expect(await h2(srv.url + "/after").then(r => r.text())).toBe("survivor");
    // Aborting one stream must not tear down the connection: all four
    // requests rode one session, and /slow's stream was reset with CANCEL
    // while /fast and /after on the same session completed.
    expect(sessions).toBe(1);
    expect(await slowRstCode).toBe(http2.constants.NGHTTP2_CANCEL);
  });

  test("server SETTINGS_MAX_CONCURRENT_STREAMS=1 is honoured per session", async () => {
    const perSessionMax: number[] = [];
    const held: http2.ServerHttp2Stream[] = [];
    const server = makeH2Server({ settings: { maxConcurrentStreams: 1 } });
    server.on("session", s => {
      const idx = perSessionMax.push(0) - 1;
      let open = 0;
      s.on("stream", (stream, headers) => {
        open++;
        perSessionMax[idx] = Math.max(perSessionMax[idx], open);
        stream.on("close", () => open--);
        if (headers[":path"] === "/warmup") {
          stream.respond({ ":status": 200 });
          stream.end("x");
          return;
        }
        // Hold the burst until all 4 are open at once, so any two of them
        // sharing a session would be visible as open === 2.
        held.push(stream);
        if (held.length === 4) {
          for (const h of held) {
            h.respond({ ":status": 200 });
            h.end("x");
          }
        }
      });
    });
    using srv = await listen(server);
    // First request alone so the server's SETTINGS arrives before the
    // burst, then fire 4 concurrently against the cap.
    expect(await h2(srv.url + "/warmup").then(r => r.text())).toBe("x");
    const burst = await Promise.all(Array.from({ length: 4 }, () => h2(srv.url + "/burst").then(r => r.text())));
    expect(burst).toEqual(["x", "x", "x", "x"]);
    // The cap is per-connection: no session may ever see >1 open stream.
    // Excess concurrent requests fan out to additional connections.
    expect(perSessionMax).toEqual(perSessionMax.map(() => 1));
    expect(perSessionMax.length).toBeGreaterThanOrEqual(4);
  });

  test("keep-alive: sequential requests reuse one h2 session", async () => {
    let sessions = 0;
    const seen: number[] = [];
    const server = makeH2Server();
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      seen.push(stream.id!);
      stream.respond({ ":status": 200, "content-type": "text/plain" });
      stream.end(`req=${headers[":path"]}`);
    });
    using srv = await listen(server);
    const results: string[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(await h2(srv.url + "/" + i).then(r => r.text()));
    }
    expect(results).toEqual(["req=/0", "req=/1", "req=/2", "req=/3"]);
    expect(sessions).toBe(1);
    // stream ids must be fresh odd numbers on the reused session
    expect(seen).toEqual([1, 3, 5, 7]);
  });

  test("GOAWAY after a request: next request reconnects", async () => {
    let sessions = 0;
    const { promise: firstSessionClosed, resolve: onFirstSessionClosed } = Promise.withResolvers<void>();
    const server = makeH2Server();
    server.on("session", s => {
      if (++sessions === 1) s.once("close", () => onFirstSessionClosed());
    });
    server.on("stream", (stream, headers) => {
      const session = stream.session!;
      stream.respond({ ":status": 200 });
      stream.end("ok");
      if (headers[":path"] === "/first") {
        session.goaway(http2.constants.NGHTTP2_NO_ERROR, stream.id);
      }
    });
    using srv = await listen(server);
    expect(await h2(srv.url + "/first").then(r => r.text())).toBe("ok");
    // The client must not pool a GOAWAY'd session: once its last stream is
    // done it closes the socket, which is what the server observes here.
    await firstSessionClosed;
    expect(await h2(srv.url + "/second").then(r => r.text())).toBe("ok");
    expect(sessions).toBe(2);
  });

  test("response body larger than initial window triggers WINDOW_UPDATE", async () => {
    const big = Buffer.alloc(20 * 1024 * 1024, 0x61);
    using srv = await listen(
      makeH2Server({}, (_req, res) => {
        res.writeHead(200);
        res.end(big);
      }),
    );
    const res = await h2(srv.url);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(big.length);
    expect(buf.equals(big)).toBe(true);
  });

  test("response trailers are consumed without breaking the body", async () => {
    const server = makeH2Server();
    server.on("stream", stream => {
      stream.respond({ ":status": 200, "content-type": "text/plain" }, { waitForTrailers: true });
      stream.on("wantTrailers", () => stream.sendTrailers({ "x-trailer": "hello" }));
      stream.end("body-text");
    });
    using srv = await listen(server);
    const r = await h2(srv.url);
    expect([r.status, await r.text()]).toEqual([200, "body-text"]);
  });

  // Bun's node:http2 server currently emits an empty DATA+END_STREAM for
  // stream.close(code) rather than RST_STREAM, so this also covers the
  // RFC 9113 §8.1 "DATA before HEADERS" stream-error case.
  test("server-reset stream fails that request; sibling on the session survives", async () => {
    let sessions = 0;
    const { promise: badClosed, resolve: onBadClosed } = Promise.withResolvers<void>();
    const server = makeH2Server();
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      if (headers[":path"] === "/bad") {
        stream.close(http2.constants.NGHTTP2_PROTOCOL_ERROR);
        onBadClosed();
        return;
      }
      // /good stays open until /bad has been reset, so the reset lands while
      // a sibling is in flight on the same session.
      badClosed.then(() => {
        stream.respond({ ":status": 200 });
        stream.end("ok");
      });
    });
    using srv = await listen(server);
    const [good, bad] = await Promise.allSettled([
      h2(srv.url + "/good").then(r => r.text()),
      h2(srv.url + "/bad").then(r => r.text()),
    ]);
    expect(good).toEqual({ status: "fulfilled", value: "ok" });
    expect(bad.status).toBe("rejected");
    expect(sessions).toBe(1);
  });

  test("connection-specific request headers are stripped before HPACK", async () => {
    let seen: string[] = [];
    const server = makeH2Server();
    server.on("stream", (stream, headers) => {
      seen = Object.keys(headers).filter(k => !k.startsWith(":"));
      stream.respond({ ":status": 200 });
      stream.end();
    });
    using srv = await listen(server);
    const r = await h2(srv.url, {
      headers: {
        "x-keep": "me",
        "Connection": "keep-alive",
        "Keep-Alive": "timeout=5",
        "Proxy-Connection": "x",
        "Transfer-Encoding": "chunked",
        "Upgrade": "ws",
      },
    });
    expect(r.status).toBe(200);
    expect(seen).toContain("x-keep");
    for (const bad of ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade"]) {
      expect(seen).not.toContain(bad);
    }
  });

  test("multiple Set-Cookie response headers survive HPACK decode", async () => {
    const server = makeH2Server();
    server.on("stream", stream => {
      stream.respond({ ":status": 200, "set-cookie": ["a=b", "c=d", "e=f"] });
      stream.end();
    });
    using srv = await listen(server);
    const r = await h2(srv.url);
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie()).toEqual(["a=b", "c=d", "e=f"]);
  });

  test("a 204, a 205 and the response to a HEAD request have a null body", async () => {
    const server = makeH2Server();
    server.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      if (headers[":method"] === "HEAD") {
        stream.respond({ ":status": 200, "content-length": "5" }, { endStream: true });
      } else if (headers[":path"] === "/204") {
        stream.respond({ ":status": 204 }, { endStream: true });
      } else {
        // RFC 9110 section 15.3.6 forbids content on a 205. A server that sends
        // some anyway must not get it into the body.
        stream.respond({ ":status": 205 });
        stream.end("hello");
      }
    });
    using srv = await listen(server);
    const results: Array<Record<string, unknown>> = [];
    for (const [path, init] of [
      ["/204", {}],
      ["/205", {}],
      ["/head", { method: "HEAD" }],
    ] as const) {
      const r = await h2(srv.url + path, init);
      results.push({
        status: r.status,
        contentLength: r.headers.get("content-length"),
        body: r.body,
        text: await r.text(),
        bodyUsed: r.bodyUsed,
        cloneBody: r.clone().body,
      });
    }
    expect(results).toEqual([
      { status: 204, contentLength: null, body: null, text: "", bodyUsed: false, cloneBody: null },
      { status: 205, contentLength: null, body: null, text: "", bodyUsed: false, cloneBody: null },
      { status: 200, contentLength: "5", body: null, text: "", bodyUsed: false, cloneBody: null },
    ]);
  });

  test("await fetch() resolves on headers, before a content-length body is fully received", async () => {
    const { promise: held, resolve: hold } = Promise.withResolvers<http2.Http2Stream>();
    const server = makeH2Server();
    server.on("stream", stream => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200, "content-length": "262144" });
      stream.write(Buffer.alloc(64 * 1024));
      // The remaining 192 KiB is written from the test body once the
      // Response and a first read have been observed.
      hold(stream);
    });
    using srv = await listen(server);
    const r = await h2(srv.url);
    expect([r.status, r.headers.get("content-length")]).toEqual([200, "262144"]);
    const reader = r.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    let n = first.value!.byteLength;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(64 * 1024);
    const stream = await held;
    stream.end(Buffer.alloc(192 * 1024));
    while (true) {
      const { value, done } = await reader.read();
      if (value) n += value.byteLength;
      if (done) break;
    }
    expect(n).toBe(262144);
  });

  describe("raw frame server", () => {
    test("REFUSED_STREAM is transparently retried on the same connection", async () => {
      let attempts = 0;
      using srv = await rawH2Server((conn, id) => {
        attempts++;
        if (attempts === 1) return conn.rst(id, http2.constants.NGHTTP2_REFUSED_STREAM);
        conn.headers(id, hpackStatus(204), { endStream: true });
      });
      const r = await h2(srv.url);
      expect(r.status).toBe(204);
      expect(attempts).toBe(2);
      expect(srv.connections).toBe(1);
    });

    test("RST_STREAM(NO_ERROR) after a complete response keeps the response; a later RST is ignored", async () => {
      // RFC 9113 §8.1: the server may finish the response before the request
      // body and reset with NO_ERROR; DATA we had in flight can then draw a
      // second RST_STREAM(STREAM_CLOSED), which must not clobber the result.
      using srv = await rawH2Server((conn, id) => {
        conn.headers(id, hpackStatus(200));
        conn.data(id, "early", true);
        conn.rst(id, http2.constants.NGHTTP2_NO_ERROR);
        conn.rst(id, http2.constants.NGHTTP2_STREAM_CLOSED);
      });
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(1024)); /* never closes */
        },
      });
      const r = await h2(srv.url, { method: "POST", body, duplex: "half" });
      expect([r.status, await r.text()]).toEqual([200, "early"]);
    });

    test("REFUSED_STREAM gives up after max retries", async () => {
      let attempts = 0;
      using srv = await rawH2Server((conn, id) => {
        attempts++;
        conn.rst(id, http2.constants.NGHTTP2_REFUSED_STREAM);
      });
      await expect(h2(srv.url)).rejects.toMatchObject({ code: "HTTP2RefusedStream" });
      // initial + 5 retries
      expect(attempts).toBe(6);
    });

    test("RST_STREAM PROTOCOL_ERROR is not retried", async () => {
      let attempts = 0;
      using srv = await rawH2Server((conn, id) => {
        attempts++;
        conn.rst(id, http2.constants.NGHTTP2_PROTOCOL_ERROR);
      });
      await expect(h2(srv.url)).rejects.toMatchObject({ code: "HTTP2StreamReset" });
      expect(attempts).toBe(1);
    });

    test("graceful GOAWAY past our id retries on a fresh connection", async () => {
      using srv = await rawH2Server((conn, id, connIndex) => {
        if (connIndex === 0) {
          // First connection: refuse via GOAWAY(NO_ERROR, lastId=0).
          conn.goaway(0, 0);
          conn.socket.end();
          return;
        }
        conn.headers(id, hpackStatus(200), { endStream: false });
        conn.data(id, "second-conn", true);
      });
      const r = await h2(srv.url);
      expect([r.status, await r.text()]).toEqual([200, "second-conn"]);
      expect(srv.connections).toBe(2);
    });

    test("REFUSED_STREAM with a streaming body errors instead of retrying", async () => {
      let attempts = 0;
      using srv = await rawH2Server((conn, id) => {
        attempts++;
        conn.rst(id, http2.constants.NGHTTP2_REFUSED_STREAM);
      });
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3]));
          c.close();
        },
      });
      await expect(h2(srv.url, { method: "POST", body, duplex: "half" })).rejects.toMatchObject({
        code: "HTTP2RefusedStream",
      });
      expect(attempts).toBe(1);
    });

    test("padded DATA: pad bytes are stripped and credited against flow control", async () => {
      using srv = await rawH2Server((conn, id) => {
        conn.headers(id, hpackStatus(200));
        // PADDED flag = 0x8; payload = padLen(1) + body + pad zeros.
        const body = Buffer.from("padded-body");
        const padLen = 200;
        const payload = Buffer.concat([Buffer.from([padLen]), body, Buffer.alloc(padLen)]);
        conn.socket.write(frame(FT_DATA, 0x8 | FLAG_END_STREAM, id, payload));
      });
      const r = await h2(srv.url);
      expect([r.status, await r.text()]).toEqual([200, "padded-body"]);
    });

    test("1xx informational HEADERS are skipped, final response delivered", async () => {
      using srv = await rawH2Server((conn, id) => {
        // Single write so 100 and 200 land in the same onData pass; HPACK
        // must decode both in order.
        conn.socket.write(
          Buffer.concat([
            frame(FT_HEADERS, 4, id, hpackStatus(100)),
            frame(FT_HEADERS, 4, id, Buffer.concat([hpackStatus(200), hpackLit("x-after", "100")])),
            frame(FT_DATA, FLAG_END_STREAM, id, Buffer.from("final")),
          ]),
        );
      });
      const r = await h2(srv.url);
      expect([r.status, r.headers.get("x-after"), await r.text()]).toEqual([200, "100", "final"]);
    });

    test("1xx HEADERS with END_STREAM is a stream PROTOCOL_ERROR (RFC 9113 §8.1)", async () => {
      using srv = await rawH2Server((conn, id) => conn.headers(id, hpackStatus(100), { endStream: true }));
      await expect(h2(srv.url)).rejects.toMatchObject({ code: "HTTP2ProtocolError" });
    });

    test("DATA after only a 1xx HEADERS is a stream PROTOCOL_ERROR (RFC 9113 §8.1)", async () => {
      using srv = await rawH2Server((conn, id) => {
        conn.socket.write(
          Buffer.concat([
            frame(FT_HEADERS, 4, id, hpackStatus(100)),
            frame(FT_DATA, FLAG_END_STREAM, id, Buffer.from("body")),
          ]),
        );
      });
      await expect(h2(srv.url)).rejects.toMatchObject({ code: "HTTP2ProtocolError" });
    });

    test("response + trailers in a single packet keep HPACK in sync", async () => {
      using srv = await rawH2Server((conn, id) => {
        conn.socket.write(
          Buffer.concat([
            frame(FT_HEADERS, 4, id, Buffer.concat([hpackStatus(200), hpackLit("x-real", "yes")])),
            frame(FT_DATA, 0, id, Buffer.from("body")),
            frame(FT_HEADERS, 4 | FLAG_END_STREAM, id, hpackLit("x-trailer", "ignored")),
          ]),
        );
      });
      const r = await h2(srv.url);
      expect([r.status, r.headers.get("x-real"), await r.text()]).toEqual([200, "yes", "body"]);
    });

    test("Expect: 100-continue withholds the body until 100 arrives", async () => {
      let conn1: RawConn | undefined;
      using srv = await rawH2Server(
        (conn, id) => {
          // Stream 1 gets its 100 from the test body, after the barrier below.
          if (id === 1) conn1 = conn;
          else conn.headers(id, hpackStatus(204), { endStream: true });
        },
        {
          onFrame(conn, f) {
            if (f.type === FT_DATA && f.id === 1 && f.flags & FLAG_END_STREAM) {
              conn.headers(1, hpackStatus(200));
              conn.data(1, "got-body", true);
            }
          },
        },
      );
      const expecting = h2(srv.url, {
        method: "POST",
        headers: { Expect: "100-continue" },
        body: "twenty-chars-body!!!",
      });
      await srv.waitForFrame(f => f.id === 1 && f.type === FT_HEADERS);
      // Barrier: a second request on the same session. A client that ignored
      // Expect would have flushed DATA(1) together with HEADERS(1), ahead of
      // HEADERS(3), so a 204 back with nothing but HEADERS on stream 1 proves
      // the body was withheld. Only then release the 100.
      expect(await h2(srv.url + "/barrier").then(r => r.status)).toBe(204);
      expect(srv.connections).toBe(1);
      expect(srv.frames.filter(f => f.id === 1).map(f => f.type)).toEqual([FT_HEADERS]);
      conn1!.headers(1, hpackStatus(100));
      const r = await expecting;
      expect([r.status, await r.text()]).toEqual([200, "got-body"]);
      expect(srv.frames.filter(f => f.id === 1).map(f => [f.type, f.len])).toEqual([
        [FT_HEADERS, expect.any(Number)],
        [FT_DATA, 20],
      ]);
    });

    test("Expect: 100-continue with final status before 100 skips body upload", async () => {
      using srv = await rawH2Server((conn, id) => {
        // Reject immediately without 100; client should half-close with
        // an empty DATA+END_STREAM rather than uploading the body.
        conn.headers(id, hpackStatus(404), { endStream: true });
      });
      const r = await h2(srv.url, {
        method: "POST",
        headers: { Expect: "100-continue" },
        body: Buffer.alloc(50000, "x").toString(),
      });
      expect(r.status).toBe(404);
      // Wait for the client to close its side of stream 1, then check that no
      // body byte went out: only the empty END_STREAM DATA frame is allowed.
      await srv.waitForFrame(
        f => f.id === 1 && ((f.type === FT_DATA && (f.flags & FLAG_END_STREAM) !== 0) || f.type === FT_RST_STREAM),
      );
      expect(srv.frames.filter(f => f.id === 1 && f.type === FT_DATA).map(f => f.len)).toEqual([0]);
    });

    test("Content-Length / DATA mismatch rejects", async () => {
      using srv = await rawH2Server((conn, id) => {
        conn.headers(id, Buffer.concat([hpackStatus(200), hpackLit("content-length", "42")]));
        conn.data(id, "short", true);
      });
      await expect(h2(srv.url).then(r => r.text())).rejects.toMatchObject({ code: "HTTP2ContentLengthMismatch" });
    });

    test("Content-Length with END_STREAM on HEADERS and zero DATA rejects", async () => {
      // RFC 9113 §8.1.1: declared length must equal sum of DATA payloads even
      // when that sum is zero. Previously this hit the early-finish branch
      // and resolved with an empty body.
      using srv = await rawH2Server((conn, id) => {
        conn.headers(id, Buffer.concat([hpackStatus(200), hpackLit("content-length", "42")]), { endStream: true });
      });
      await expect(h2(srv.url).then(r => r.text())).rejects.toMatchObject({ code: "HTTP2ContentLengthMismatch" });
    });

    test("response missing :status pseudo-header rejects cleanly", async () => {
      using srv = await rawH2Server((conn, id) => {
        conn.headers(id, hpackLit("content-type", "text/plain"), { endStream: true });
      });
      await expect(h2(srv.url)).rejects.toMatchObject({ code: "HTTP2ProtocolError" });
    });

    test("Content-Length satisfied before END_STREAM doesn't dereference a freed client", async () => {
      // Server sends body in one DATA frame without END_STREAM, then a
      // separate empty DATA(END_STREAM). The first frame fully satisfies
      // Content-Length, so progressUpdate fires and the JS callback frees
      // the AsyncHTTP; the second frame must not touch a stale client ptr.
      let first: RawConn | undefined;
      using srv = await rawH2Server((conn, id) => {
        if (id === 1) {
          first = conn;
          conn.headers(id, Buffer.concat([hpackStatus(200), hpackLit("content-length", "5")]));
          conn.data(id, "hello", false);
          return;
        }
        conn.headers(id, hpackStatus(204), { endStream: true });
      });
      const r = await h2(srv.url);
      expect([r.status, await r.text()]).toEqual([200, "hello"]);
      // The response is complete and its client freed. Now send the late
      // END_STREAM, and a second request on the same socket as a barrier: its
      // 204 arrives after the client has read the stale frame.
      first!.data(1, "", true);
      expect(await h2(srv.url).then(r => r.status)).toBe(204);
      expect(srv.connections).toBe(1);
    });

    test.each([
      [
        "SETTINGS_MAX_FRAME_SIZE below 16384 is rejected as a connection error",
        // RFC 9113 §6.5.2: values outside [16384, 2^24-1] are PROTOCOL_ERROR.
        // Without the lower bound a MAX_FRAME_SIZE of 0 made writeHeaderBlock
        // loop forever emitting zero-length frames.
        frame(FT_SETTINGS, 0, 0, Buffer.concat([Buffer.from([0, 5]), u32be(0)])),
        "HTTP2ProtocolError",
      ],
      [
        "SETTINGS_INITIAL_WINDOW_SIZE above 2^31-1 is a connection FLOW_CONTROL_ERROR",
        // RFC 9113 §6.5.2.
        frame(FT_SETTINGS, 0, 0, Buffer.concat([Buffer.from([0, 4]), u32be(0x80000000)])),
        "HTTP2FlowControlError",
      ],
      [
        "WINDOW_UPDATE with zero increment on stream 0 is a connection PROTOCOL_ERROR",
        // RFC 9113 §6.9.
        frame(FT_WINDOW_UPDATE, 0, 0, u32be(0)),
        "HTTP2ProtocolError",
      ],
      [
        "HEADERS on a stream id we never opened is a connection PROTOCOL_ERROR",
        // RFC 9113 §5.1: a frame on an even (server-initiated) id while push
        // is disabled is a connection error, not a discardable orphan.
        frame(FT_HEADERS, 4 | FLAG_END_STREAM, 2, hpackStatus(200)),
        "HTTP2ProtocolError",
      ],
      [
        "frame larger than the local SETTINGS_MAX_FRAME_SIZE is a connection FRAME_SIZE_ERROR",
        // RFC 9113 §4.2. We never advertise above the 16384 default, so a peer
        // declaring a 16385-byte payload is a connection error and must not be
        // buffered (the unbounded path would let a peer balloon read_buffer).
        frame(FT_DATA, 0, 1, Buffer.alloc(16385)),
        "HTTP2FrameSizeError",
      ],
      [
        "SETTINGS frame on a non-zero stream id is a connection PROTOCOL_ERROR",
        // RFC 9113 §6.5.
        frame(FT_SETTINGS, 0, 1),
        "HTTP2ProtocolError",
      ],
      [
        "RST_STREAM on an idle stream is a connection PROTOCOL_ERROR",
        // RFC 9113 §6.4.
        frame(FT_RST_STREAM, 0, 3, u32be(0)),
        "HTTP2ProtocolError",
      ],
      [
        "PING with length != 8 is a connection FRAME_SIZE_ERROR",
        // RFC 9113 §6.7.
        frame(FT_PING, 0, 0, Buffer.alloc(4)),
        "HTTP2FrameSizeError",
      ],
      [
        "PING on a non-zero stream id is a connection PROTOCOL_ERROR",
        // RFC 9113 §6.7.
        frame(FT_PING, 0, 1, Buffer.alloc(8)),
        "HTTP2ProtocolError",
      ],
    ])("%s", async (_name, badFrame, code) => {
      // The bad frame goes out first, then a valid 200 for the request; the
      // connection error must win over the response.
      using srv = await rawH2Server((conn, id) => {
        conn.socket.write(badFrame);
        conn.headers(id, hpackStatus(200), { endStream: true });
      });
      await expect(h2(srv.url)).rejects.toMatchObject({ code });
    });

    test("303 redirect on a streaming-body POST RSTs the half-open upload stream", async () => {
      // The redirect detaches stream 1 before END_STREAM is ever written for
      // the request body. Without an RST_STREAM(CANCEL) the server is left
      // holding it half-open against MAX_CONCURRENT_STREAMS.
      using srv = await rawH2Server((conn, id) => {
        if (id === 1) {
          conn.headers(id, Buffer.concat([hpackLit(":status", "303"), hpackLit("location", "/target")]), {
            endStream: true,
          });
        } else {
          conn.headers(id, hpackStatus(200), { endStream: true });
        }
      });
      // Never closes: the 303 cancels the upload.
      const body = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(new Uint8Array([1, 2, 3]));
        },
      });
      const r = await h2(srv.url + "/upload", { method: "POST", body, duplex: "half" });
      expect([r.status, r.url]).toEqual([200, srv.url + "/target"]);
      await srv.waitForFrame(f => f.type === FT_RST_STREAM);
      // 0x8 = CANCEL
      expect(srv.rst).toEqual([{ id: 1, code: 8 }]);
      expect(srv.connections).toBe(1);
    });

    test("client RSTs the stream when it abandons on a local error", async () => {
      // handleResponseBody throws on invalid gzip; the catch path must send
      // RST_STREAM(CANCEL) so the server doesn't keep the stream open
      // counting against MAX_CONCURRENT_STREAMS.
      using srv = await rawH2Server((conn, id) => {
        if (id === 1) {
          conn.headers(id, Buffer.concat([hpackStatus(200), hpackLit("content-encoding", "gzip")]));
          conn.data(id, Buffer.from("not gzip"));
        } else {
          // Barrier request, see below.
          conn.headers(id, hpackStatus(204), { endStream: true });
        }
      });
      await expect(h2(srv.url).then(r => r.arrayBuffer())).rejects.toMatchObject({ code: "ZlibError" });
      // Second request on the same pooled session acts as a delivery
      // barrier: RST_STREAM(1) is queued ahead of HEADERS(3) on the one
      // socket, so the 204 arriving back proves the RST reached the server.
      expect(await h2(srv.url).then(r => r.status)).toBe(204);
      // 0x8 = CANCEL. connections=1 proves the barrier rode the same
      // socket, so ordering actually applies.
      expect({ rst: srv.rst, connections: srv.connections }).toEqual({
        rst: [{ id: 1, code: 8 }],
        connections: 1,
      });
    });

    test("RST_STREAM(NO_ERROR) before final HEADERS fails the request instead of hanging", async () => {
      using srv = await rawH2Server((conn, id) => {
        conn.rst(id, 0);
      });
      await expect(h2(srv.url)).rejects.toMatchObject({ code: "HTTP2StreamReset" });
    });
  });

  describe("protocol selection", () => {
    test("flag off: ALPN does not offer h2", async () => {
      let alpn: string | false | null | undefined = null;
      const server = nodetls.createServer({ ...tls, ALPNProtocols: ["h2", "http/1.1"] }, sock => {
        alpn = sock.alpnProtocol;
        sock.end("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 2\r\n\r\nok");
      });
      server.on("tlsClientError", () => {});
      using srv = await listen(server);
      // The test process has neither the env flag nor the CLI flag, and this
      // fetch sets no `protocol`.
      const r = await fetch(srv.url, { tls: tlsOpts });
      expect([r.status, await r.text()]).toEqual([200, "ok"]);
      // The server prefers h2; if the client had offered it, ALPN would have
      // selected it and the HTTP/1.1 response above would have failed parse.
      expect(alpn as string | false | null | undefined).toBe("http/1.1");
    });

    test("--experimental-http2-fetch enables h2 without the env flag", async () => {
      using srv = await listen(
        makeH2Server({}, (req, res) => {
          res.writeHead(200);
          res.end(req.httpVersion);
        }),
      );
      // No BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT in env; the CLI flag
      // alone should make ALPN offer h2.
      await using proc = await spawnCapped({
        cmd: [
          bunExe(),
          "--no-warnings",
          "--experimental-http2-fetch",
          "-e",
          `const r = await fetch(${JSON.stringify(srv.url)}, { tls: { rejectUnauthorized: false } });
           console.log(r.status, await r.text());`,
        ],
        env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("200 2.0\n");
      expect(exitCode).toBe(0);
    });

    test("protocol:'http2' forces h2 without the env flag", async () => {
      using srv = await listen(
        makeH2Server({}, (req, res) => {
          res.writeHead(200);
          res.end(req.httpVersion);
        }),
      );
      const r = await h2(srv.url);
      expect([r.status, await r.text()]).toEqual([200, "2.0"]);
    });

    test.each([
      ["small (shared-buffer fast path)", 32 * 1024],
      ["large (zlib-streaming spill path)", 600 * 1024],
    ])("compress: gzip request body over h2, %s", async (_, size) => {
      using srv = await listen(
        makeH2Server({}, (req, res) => {
          const chunks: Buffer[] = [];
          req.on("data", c => chunks.push(c));
          req.on("end", () => {
            const raw = Buffer.concat(chunks);
            res.writeHead(200, {
              "x-recv-len": String(raw.length),
              "x-recv-encoding": req.headers["content-encoding"] ?? "",
              "x-recv-content-length": req.headers["content-length"] ?? "",
            });
            res.end(zlib.gunzipSync(raw));
          });
        }),
      );
      const payload = Buffer.alloc(size, "abcdefghij");
      const r = await h2(srv.url, { method: "POST", body: payload, compress: "gzip" });
      const decoded = Buffer.from(await r.arrayBuffer());
      const recvLen = Number(r.headers.get("x-recv-len"));
      expect(r.status).toBe(200);
      expect(r.headers.get("x-recv-encoding")).toBe("gzip");
      expect(recvLen).toBeLessThan(size);
      expect(r.headers.get("x-recv-content-length")).toBe(String(recvLen));
      expect(decoded.equals(payload)).toBe(true);
    });

    test("protocol:'http2' against an h1-only server fails with HTTP2Unsupported", async () => {
      using srv = await listen(https.createServer({ ...tls }, (_req, res) => res.end("h1")));
      await expect(h2(srv.url)).rejects.toMatchObject({ code: "HTTP2Unsupported" });
    });

    test("ALPN h1 result re-dispatches coalesced waiters in parallel, not serial", async () => {
      // h1-only TLS server: leader's ALPN resolves to http/1.1, so waiters
      // re-dispatch. Each must open its own connection on the same loop turn
      // rather than re-coalescing onto the first waiter's new PendingConnect.
      let active = 0;
      let peak = 0;
      const { promise, resolve } = Promise.withResolvers<void>();
      using srv = await listen(
        https.createServer({ ...tls }, (req, res) => {
          active++;
          peak = Math.max(peak, active);
          if (active === 5) resolve();
          promise.then(() => {
            res.end("ok");
            active--;
          });
        }),
      );
      // Needs the env flag: h2 is offered alongside h1 and the server picks h1.
      await using proc = await spawnFetch(`
        const url = ${JSON.stringify(srv.url + "/")};
        const tls = { rejectUnauthorized: false };
        const rs = await Promise.all(Array.from({ length: 5 }, () => fetch(url, { tls }).then(r => r.text())));
        console.log(rs.join(","));
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("ok,ok,ok,ok,ok\n");
      expect(exitCode).toBe(0);
      // If waiters re-coalesced, peak would be 1 (sequential); 5 means all
      // five connections were open before any response was written.
      expect(peak).toBe(5);
    });

    test('protocol: "http1.1" overrides the env flag and pins ALPN to http/1.1', async () => {
      // Server is h2-only: the unpinned fetch (env flag on) negotiates h2, while
      // the pinned fetch advertises only http/1.1 and is rejected at ALPN,
      // proving the pin actually reached the ClientHello.
      using srv = await listen(makeH2Server({}, (req, res) => res.end(req.httpVersion)));
      await using proc = await spawnFetch(`
        const url = ${JSON.stringify(srv.url)};
        const tls = { rejectUnauthorized: false };
        const a = await fetch(url, { tls }).then(r => r.text());
        const b = await fetch(url, { protocol: "http1.1", tls }).then(r => r.text(), e => "rejected");
        console.log(a, b);
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("2.0 rejected\n");
      expect(exitCode).toBe(0);
    });

    test('protocol: "http2" on a plain http:// URL fails with HTTP2Unsupported', async () => {
      // h2c is out of scope; without an explicit check the request would
      // silently complete over HTTP/1.1.
      await expect(fetch("http://127.0.0.1:1/", { protocol: "http2" })).rejects.toMatchObject({
        code: "HTTP2Unsupported",
      });
    });

    test("abort while coalesced onto an in-flight TLS connect resolves promptly", async () => {
      // Leader's TLS handshake never completes (server is plain TCP), so its
      // PendingConnect stays open. The waiter has no abort-tracker entry and
      // would otherwise wait for the leader before observing the abort.
      using srv = await silentTcpServer();
      const leaderAc = new AbortController();
      const leader = h2(srv.url + "/", { signal: leaderAc.signal }).then(
        () => "unexpected-ok",
        e => e.name,
      );
      const ac = new AbortController();
      const waiter = h2(srv.url + "/", { signal: ac.signal }).then(
        () => "unexpected-ok",
        e => e.name,
      );
      // Leader + sentinel only: the waiter coalesced instead of connecting.
      expect(await srv.settle()).toBe(2);
      ac.abort();
      expect(await waiter).toBe("AbortError");
      leaderAc.abort();
      expect(await leader).toBe("AbortError");
    });

    test("leader abort does not fail a coalesced force_http2 waiter with HTTP2Unsupported", async () => {
      // Regression for resolvePendingH2 conflating "ALPN chose h1" with
      // "leader failed pre-handshake". Server never speaks TLS, so the leader
      // sits in handshake; the waiter coalesces onto its PendingConnect. When
      // the leader is aborted, the waiter must retry as the new leader (a
      // second TCP connect) rather than be told the server lacks h2.
      using srv = await silentTcpServer();
      const leaderAc = new AbortController();
      const leader = h2(srv.url + "/", { signal: leaderAc.signal }).then(
        () => "unexpected-ok",
        e => e.name,
      );
      const waiterAc = new AbortController();
      const waiter = h2(srv.url + "/", { signal: waiterAc.signal }).then(
        () => "unexpected-ok",
        e => (typeof e?.code === "string" ? e.code : e?.name) || String(e),
      );
      // Leader + sentinel only: the waiter coalesced.
      expect(await srv.settle()).toBe(2);
      const retry = srv.nextAccept();
      leaderAc.abort();
      expect(await leader).toBe("AbortError");
      // The waiter retries as the new leader: a third TCP connect arrives.
      await retry;
      expect(srv.conns).toBe(3);
      waiterAc.abort();
      expect(await waiter).toBe("AbortError");
    });
  });

  test("SETTINGS_HEADER_TABLE_SIZE=0: encoder emits a Dynamic Table Size Update so request 2+ decodes", async () => {
    // RFC 9113 §4.3.1 / RFC 7541 §6.3: a server that shrinks the encoder's
    // dynamic table expects the next header block to begin with a 0x20-prefix
    // size-update opcode. nghttp2 (which backs node:http2) enforces this and
    // closes the connection with COMPRESSION_ERROR if the opcode is missing,
    // so requests after the first hang/fail without the fix.
    const server = makeH2Server({ settings: { headerTableSize: 0 } }, (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    server.on("sessionError", () => {});
    using srv = await listen(server);
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await h2(srv.url);
      results.push(`${i} ${res.status} ${await res.text()}`);
    }
    expect(results).toEqual(["0 200 ok", "1 200 ok", "2 200 ok"]);
  });

  test("303 to a streaming POST over HTTP/1.1 closes the socket instead of pooling it mid-chunked-body", async () => {
    // A 303 with a streaming body must not fall through to the keep-alive
    // pool: the chunked upload's terminating 0\r\n\r\n was never written.
    // The follow-up GET must open a fresh connection.
    let conns = 0;
    using srv = await listen(
      net.createServer(sock => {
        const idx = conns++;
        let buf = "";
        let replied = false;
        sock.on("data", c => {
          buf += c;
          if (idx === 0 && buf.includes("\r\n\r\n") && !replied) {
            replied = true;
            sock.write(
              "HTTP/1.1 303 See Other\r\nLocation: /target\r\nConnection: keep-alive\r\nContent-Length: 0\r\n\r\n",
            );
          }
          if (buf.includes("GET /target")) {
            sock.end("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 6\r\n\r\nconn=" + idx);
          }
        });
        sock.on("error", () => {});
      }),
      { scheme: "http", host: "127.0.0.1" },
    );
    // Never closes: the 303 cancels the upload.
    const body = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new Uint8Array([1, 2, 3, 4]));
      },
    });
    const res = await fetch(srv.url + "/upload", { method: "POST", body, duplex: "half" } as RequestInit);
    // conn=1 (zero-indexed) and conns=2 prove the follow-up GET opened a
    // fresh socket; the bug would show conn=0 or hang.
    expect([res.status, await res.text(), conns]).toEqual([200, "conn=1", 2]);
  });

  // Cloudflare sends its SETTINGS frame as TLS 1.3 0.5-RTT data, so the
  // client's first SSL_read that returns app data is also the call that
  // completes the handshake. ssl_on_data must fire on_handshake there or the
  // socket never gets re-tagged for h2 and the frame bytes hit the HTTP/1.1
  // parser as Malformed_HTTP_Response. Neither node:tls nor Bun.listen exposes
  // the 0.5-RTT write window, so this hits a real Cloudflare-fronted origin.
  // Network failures are environmental: only the specific regression fails.
  test("GET https://registry.npmjs.org over protocol: http2", async () => {
    const out = await fetch("https://registry.npmjs.org", { protocol: "http2" }).then(
      r => "status " + r.status,
      e => "error " + (e?.code ?? e?.name ?? String(e)),
    );
    expect(out).not.toContain("Malformed_HTTP_Response");
    if (!out.startsWith("status")) {
      console.warn(`skipping live h2 assertion: ${out}`);
      return;
    }
    expect(out).toBe("status 200");
  });
});
