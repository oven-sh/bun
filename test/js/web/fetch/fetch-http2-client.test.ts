import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import nodetls from "node:tls";
import zlib from "node:zlib";

// Most tests here fetch in-process with `protocol: "http2"`. That pins the
// ALPN offer to h2 only; once the handshake has picked h2 it runs the exact
// same ClientSession code as the BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT /
// --experimental-http2-fetch path (the flags only add http/1.1 to the offer
// and an h1 fallback). Every server below listens on its own ephemeral port,
// so each test gets a fresh session/pool entry even though they share one
// process. The tests that are about the negotiation itself (the env flag, the
// CLI flag, protocol: "http1.1", the h1 fallback, BUN_CONFIG_HTTP_IDLE_TIMEOUT)
// and the one whose failure mode is a crash spawn a subprocess instead, since
// those knobs are read at process startup.
const h2 = { protocol: "http2", tls: { rejectUnauthorized: false } } as const;
// h2 failures carry their name in `code`; aborts are DOMExceptions whose
// `code` is the legacy numeric ABORT_ERR, so fall back to `name` for those.
const errcode = (e: any) => (typeof e?.code === "string" ? e.code : e?.name);
const statusOrCode = (p: Promise<Response>) => p.then(r => r.status, errcode);
// A response whose failure may surface either from fetch() itself or from the
// body read, depending on whether the server's frames landed in one TLS read.
const bodyOrCode = (p: Promise<Response>) => p.then(r => r.text(), errcode).catch(errcode);

// allowHTTP1: false forces the server to reject anything that didn't
// negotiate "h2" via ALPN, so these tests only pass when fetch actually
// speaks HTTP/2 on the wire.
//
// Subprocesses pool their h2 connection and are then SIGKILLed at exit, so
// the server-side TLS socket sees ECONNRESET. http2's tlsClientError handler
// forwards that to socket.destroy(err) when there's no clientError listener,
// which surfaces as an unhandled 'error' event in the test process — swallow
// those on every test server.
function makeH2Server(
  opts: http2.SecureServerOptions = {},
  handler?: (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => void,
) {
  const server = http2.createSecureServer({ ...tls, allowHTTP1: false, ...opts }, handler);
  server.on("clientError", () => {});
  server.on("secureConnection", s => s.on("error", () => {}));
  return server;
}

// Listens on an ephemeral port, runs `fn`, then destroys every session the
// server accepted: an in-process fetch() keeps its h2 session pooled after the
// response, and server.close() alone would leave those connections open.
async function listenH2(server: http2.Http2SecureServer, fn: (url: string) => Promise<void>) {
  const sessions = new Set<http2.ServerHttp2Session>();
  server.on("session", s => sessions.add(s));
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;
  try {
    await fn(`https://localhost:${port}`);
  } finally {
    for (const s of sessions) s.destroy();
    server.close();
  }
}

async function withH2Server(
  handler: (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => void,
  fn: (url: string, server: http2.Http2SecureServer) => Promise<void>,
) {
  const server = makeH2Server({}, handler);
  await listenH2(server, url => fn(url, server));
}

// Same for servers that are not http2 servers (https / raw tls / plain tcp):
// sockets still open when `fn` returns are destroyed. The url is built on
// 127.0.0.1 so connection counts are exact: "localhost" resolves to both
// loopback addresses and fetch races a TCP connect to each of them.
async function listenTcp(server: net.Server, scheme: "http" | "https", fn: (url: string) => Promise<void>) {
  const sockets = new Set<net.Socket>();
  server.on("connection", s => sockets.add(s));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;
  try {
    await fn(`${scheme}://127.0.0.1:${port}`);
  } finally {
    for (const s of sockets) s.destroy();
    server.close();
  }
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

// HPACK static-table indices we need.
const hpackStatus = (code: 100 | 200 | 204 | 404) =>
  code === 100
    ? Buffer.concat([Buffer.from([0x10, 7]), Buffer.from(":status"), Buffer.from([3]), Buffer.from("100")])
    : Buffer.from([0x80 | { 200: 8, 204: 9, 404: 13 }[code]]);
// Literal field never-indexed, new name (4-bit prefix 0001 0000): len(name) name len(value) value.
const hpackLit = (name: string, value: string) =>
  Buffer.concat([Buffer.from([0x10, name.length]), Buffer.from(name), Buffer.from([value.length]), Buffer.from(value)]);

const FRAME_DATA = 0;
const FRAME_HEADERS = 1;
const FLAG_END_STREAM = 1;

type RawFrame = { id: number; type: number; flags: number; len: number };

type RawConn = {
  socket: nodetls.TLSSocket;
  settings(): void;
  headers(streamId: number, block: Buffer, opts?: { endStream?: boolean; endHeaders?: boolean }): void;
  data(streamId: number, chunk: string | Buffer, endStream?: boolean): void;
  rst(streamId: number, code: number): void;
  goaway(lastId: number, code: number): void;
  /** Sends a PING and resolves once the client ACKs it. The client answers
   *  frames in arrival order, so the ACK proves every frame it wrote before
   *  seeing the PING has already reached the `onFrame` handler. */
  ping(): Promise<void>;
  /** Called for every frame the client sends on a non-zero stream id. */
  onFrame?: (f: RawFrame) => void;
};

type RawState = {
  connections: number;
  rst: Array<{ id: number; code: number }>;
  /** Every stream-addressed frame received from the client, in wire order. */
  frames: RawFrame[];
};

async function withRawH2Server(
  onStream: (conn: RawConn, streamId: number, connIndex: number) => void,
  fn: (url: string, state: RawState) => Promise<void>,
) {
  const state: RawState = { connections: 0, rst: [], frames: [] };
  const server = nodetls.createServer({ ...tls, ALPNProtocols: ["h2"] }, socket => {
    const connIndex = state.connections++;
    const pingWaiters: Array<() => void> = [];
    const conn: RawConn = {
      socket,
      settings: () => socket.write(frame(4, 0, 0)),
      headers: (id, block, o = {}) =>
        socket.write(frame(1, (o.endHeaders === false ? 0 : 4) | (o.endStream ? 1 : 0), id, block)),
      data: (id, chunk, end = false) =>
        socket.write(frame(0, end ? 1 : 0, id, typeof chunk === "string" ? Buffer.from(chunk) : chunk)),
      rst: (id, code) => socket.write(frame(3, 0, id, u32be(code))),
      goaway: (lastId, code) => socket.write(frame(7, 0, 0, Buffer.concat([u32be(lastId), u32be(code)]))),
      ping: () =>
        new Promise<void>(resolve => {
          pingWaiters.push(resolve);
          socket.write(frame(6, 0, 0, Buffer.alloc(8)));
        }),
    };
    let buf = Buffer.alloc(0);
    let prefaceSeen = false;
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!prefaceSeen) {
        if (buf.length < 24) return;
        buf = buf.subarray(24);
        prefaceSeen = true;
        conn.settings();
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) return;
        const type = buf[3],
          flags = buf[4],
          id = buf.readUInt32BE(5) & 0x7fffffff;
        const payload = buf.subarray(9, 9 + len);
        buf = buf.subarray(9 + len);
        if (type === 4 && !(flags & 1)) socket.write(frame(4, 1, 0)); // ack their SETTINGS
        if (type === 6 && flags & 1) pingWaiters.shift()?.();
        if (id !== 0) {
          const f = { id, type, flags, len };
          state.frames.push(f);
          conn.onFrame?.(f);
        }
        if (type === 1) onStream(conn, id, connIndex); // HEADERS opens a stream
        if (type === 3) state.rst.push({ id, code: payload.readUInt32BE(0) });
      }
    });
    socket.on("error", () => {});
  });
  await listenTcp(server, "https", url => fn(url, state));
}

// The handful of tests that need a knob read at process startup run fetch in
// a child. `env` holds exactly those knobs; by default that is the h2 env flag.
const h2EnvFlag = { BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: "1" };
function spawnFetch(script: string, env: Record<string, string> = h2EnvFlag, ...flags: string[]) {
  return Bun.spawn({
    cmd: [bunExe(), "--no-warnings", ...flags, "-e", script],
    env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function collect(proc: ReturnType<typeof spawnFetch>) {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

// https://github.com/oven-sh/bun/issues/16682 (h2 aggregate path): the
// session's shared socket timer is the max over every attached client's
// effective idle deadline.
//
// Declared before everything else on purpose: it has to hold its requests
// open for 10s of wall time, and as the first member of the file's concurrent
// group that hold overlaps the rest of the file instead of being added to it.
test.concurrent(
  "h2: per-request `timeout` extends the session idle deadline, and {timeout:false} is not killed by a sibling's shorter explicit timeout",
  async () => {
    const HOLD_MS = 10_000;
    const holdTimers = new Set<ReturnType<typeof setTimeout>>();
    const server = makeH2Server({}, (_req, res) => {
      // Hold every request idle past uSockets' worst-case firing window for a
      // 1s short-tick timer (~5s), then respond.
      const timer = setTimeout(() => {
        holdTimers.delete(timer);
        try {
          res.end("hello");
        } catch {}
      }, HOLD_MS);
      holdTimers.add(timer);
    });
    try {
      await listenH2(server, async url => {
        const run = (idleDefault: string, body: string) =>
          collect(
            spawnFetch(
              /* js */ `
                const url = ${JSON.stringify(url)};
                const get = init => fetch(url, { tls: { rejectUnauthorized: false }, ...init })
                  .then(r => r.text(), e => "ERR:" + (e?.code ?? e?.name ?? e));
                ${body}
              `,
              { ...h2EnvFlag, BUN_CONFIG_HTTP_IDLE_TIMEOUT: idleDefault },
            ),
          );
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
      });
    } finally {
      for (const timer of holdTimers) clearTimeout(timer);
    }
  },
  60_000,
);

describe.concurrent("fetch() over HTTP/2 (BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT)", () => {
  // The two round-trips below keep the env-flag (ALPN "h2, http/1.1") path
  // covered end to end; the rest of the file fetches in-process.
  test("GET: status, headers and body round-trip", async () => {
    await withH2Server(
      (req, res) => {
        res.setHeader("x-seen-path", req.url);
        res.setHeader("x-seen-method", req.method);
        res.setHeader("x-seen-foo", String(req.headers["x-foo"]));
        res.setHeader("x-http-version", req.httpVersion);
        res.writeHead(201, { "content-type": "text/plain" });
        res.end("hello over h2");
      },
      async url => {
        await using proc = spawnFetch(`
          const res = await fetch(${JSON.stringify(url)} + "/hello?x=1", {
            headers: { "X-Foo": "bar" },
            tls: { rejectUnauthorized: false },
          });
          const body = await res.text();
          console.log(JSON.stringify({
            status: res.status,
            ct: res.headers.get("content-type"),
            seenPath: res.headers.get("x-seen-path"),
            seenMethod: res.headers.get("x-seen-method"),
            seenFoo: res.headers.get("x-seen-foo"),
            httpVersion: res.headers.get("x-http-version"),
            body,
          }));
        `);
        const { stdout, stderr, exitCode } = await collect(proc);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual({
          status: 201,
          ct: "text/plain",
          seenPath: "/hello?x=1",
          seenMethod: "GET",
          seenFoo: "bar",
          httpVersion: "2.0",
          body: "hello over h2",
        });
        expect(exitCode).toBe(0);
      },
    );
  });

  test("POST: request body is delivered as DATA frames", async () => {
    await withH2Server(
      (req, res) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", c => (body += c));
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ got: body, method: req.method, httpVersion: req.httpVersion }));
        });
      },
      async url => {
        await using proc = spawnFetch(`
          const res = await fetch(${JSON.stringify(url)} + "/echo", {
            method: "POST",
            body: "the payload",
            tls: { rejectUnauthorized: false },
          });
          console.log(JSON.stringify({ status: res.status, echoed: await res.json() }));
        `);
        const { stdout, stderr, exitCode } = await collect(proc);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual({
          status: 200,
          echoed: { got: "the payload", method: "POST", httpVersion: "2.0" },
        });
        expect(exitCode).toBe(0);
      },
    );
  });

  test("response body larger than one DATA frame", async () => {
    const big = Buffer.alloc(70_000, "a").toString();
    await withH2Server(
      (_req, res) => {
        res.writeHead(200);
        res.end(big);
      },
      async url => {
        const res = await fetch(url, h2);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(big);
      },
    );
  });

  test("gzip content-encoding is decompressed", async () => {
    const payload = "compressed body via h2";
    const gz = zlib.gzipSync(payload);
    await withH2Server(
      (_req, res) => {
        res.writeHead(200, { "content-encoding": "gzip", "content-type": "text/plain" });
        res.end(gz);
      },
      async url => {
        const res = await fetch(url, h2);
        expect({ status: res.status, ct: res.headers.get("content-type"), body: await res.text() }).toEqual({
          status: 200,
          ct: "text/plain",
          body: payload,
        });
      },
    );
  });

  test("concurrent requests multiplex on one h2 session", async () => {
    let sessions = 0;
    let maxOpen = 0;
    let open = 0;
    const held: Array<() => void> = [];
    const server = makeH2Server();
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      const path = String(headers[":path"]);
      const answer = () => {
        stream.respond({ ":status": 200 });
        stream.end(path);
      };
      if (path === "/warmup") return answer();
      open++;
      maxOpen = Math.max(maxOpen, open);
      stream.on("close", () => open--);
      // Hold every stream of the burst until all 8 are open at once, then
      // answer them: maxOpen === 8 below is only reachable by multiplexing.
      held.push(answer);
      if (held.length === 8) for (const a of held.splice(0)) a();
    });
    await listenH2(server, async url => {
      // Warmup so the session exists before the concurrent burst.
      expect(await fetch(`${url}/warmup`, h2).then(r => r.text())).toBe("/warmup");
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => fetch(`${url}/${i}`, h2).then(r => r.text())),
      );
      expect(results).toEqual(["/0", "/1", "/2", "/3", "/4", "/5", "/6", "/7"]);
      expect({ sessions, maxOpen }).toEqual({ sessions: 1, maxOpen: 8 });
    });
  });

  test("POST with ReadableStream body streams as raw DATA frames", async () => {
    let received = "";
    await withH2Server(
      (req, res) => {
        req.setEncoding("utf8");
        req.on("data", c => (received += c));
        req.on("end", () => {
          res.writeHead(200, { "x-len": String(received.length) });
          res.end(received);
        });
      },
      async url => {
        const chunks = ["alpha-", "bravo-", "charlie-", "delta-", "echo"];
        // One chunk per pull(): each is handed to the client on its own turn,
        // so the upload goes out as a sequence of DATA frames.
        const body = new ReadableStream({
          pull(ctrl) {
            const c = chunks.shift();
            if (c === undefined) ctrl.close();
            else ctrl.enqueue(new TextEncoder().encode(c));
          },
        });
        const res = await fetch(`${url}/stream`, { ...h2, method: "POST", body, duplex: "half" });
        expect({ status: res.status, len: res.headers.get("x-len"), body: await res.text() }).toEqual({
          status: 200,
          len: "30",
          body: "alpha-bravo-charlie-delta-echo",
        });
        // No chunked-encoding artifacts leaked into the framed body.
        expect(received).toBe("alpha-bravo-charlie-delta-echo");
      },
    );
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
    await listenH2(server, async url => {
      const N = 24,
        M = 24;
      // Warmup so the h2 session exists and SETTINGS have been exchanged
      // before the concurrent burst; otherwise requests can fan out to
      // additional connections while the first is still handshaking.
      expect(await fetch(url, { ...h2, method: "POST", body: "warmup" }).then(r => r.text())).toBe("warmup");
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) => {
          let k = 0;
          const body = new ReadableStream({
            pull(ctrl) {
              if (k < M) ctrl.enqueue(new TextEncoder().encode(`${i}:${k++},`));
              else ctrl.close();
            },
          });
          return fetch(url, { ...h2, method: "POST", body, duplex: "half" }).then(r => r.text());
        }),
      );
      expect(results).toEqual(
        Array.from({ length: N }, (_, i) => Array.from({ length: M }, (_, k) => `${i}:${k},`).join("")),
      );
      expect(sessions).toBe(1);
    });
  });

  test("POST with ReadableStream body larger than initial send window", async () => {
    await withH2Server(
      (req, res) => {
        let total = 0;
        req.on("data", c => (total += c.length));
        req.on("end", () => {
          res.writeHead(200);
          res.end(String(total));
        });
      },
      async url => {
        // 256 KiB > 64 KiB default INITIAL_WINDOW_SIZE: requires the
        // client to honour the server's WINDOW_UPDATE before continuing.
        const buf = new Uint8Array(256 * 1024).fill(0x61);
        const body = new ReadableStream({
          start(ctrl) {
            for (let i = 0; i < 4; i++) ctrl.enqueue(buf.subarray(i * 65536, (i + 1) * 65536));
            ctrl.close();
          },
        });
        const res = await fetch(`${url}/big`, { ...h2, method: "POST", body, duplex: "half" });
        expect({ status: res.status, body: await res.text() }).toEqual({ status: 200, body: "262144" });
      },
    );
  });

  test("upload larger than the write-buffer high-water mark when the peer window never runs out", async () => {
    // The peer advertises a 1 MiB stream window and a 16 MiB connection
    // window, so flow control never pauses a 2 MB body; the client must keep
    // framing after a flush that fully drains instead of waiting for a
    // writable event that never comes.
    const received = new Map<number, number>();
    const server = nodetls.createServer({ ...tls, ALPNProtocols: ["h2"] }, socket => {
      let buf = Buffer.alloc(0);
      let prefaceSeen = false;
      socket.on("error", () => {});
      socket.on("data", chunk => {
        buf = Buffer.concat([buf, chunk]);
        if (!prefaceSeen) {
          if (buf.length < 24) return;
          buf = buf.subarray(24);
          prefaceSeen = true;
          // SETTINGS_INITIAL_WINDOW_SIZE (0x4) = 1 MiB, then open the connection window by 16 MiB.
          socket.write(frame(4, 0, 0, Buffer.concat([Buffer.from([0, 4]), u32be(1 << 20)])));
          socket.write(frame(8, 0, 0, u32be(1 << 24)));
        }
        while (buf.length >= 9) {
          const len = buf.readUIntBE(0, 3);
          if (buf.length < 9 + len) return;
          const type = buf[3],
            flags = buf[4],
            id = buf.readUInt32BE(5) & 0x7fffffff;
          buf = buf.subarray(9 + len);
          if (type === 4 && !(flags & 1)) socket.write(frame(4, 1, 0));
          if (type === 0) {
            received.set(id, (received.get(id) ?? 0) + len);
            // Top the stream window back up in 1 MiB steps so it is never the limiter.
            if ((received.get(id)! & ((1 << 20) - 1)) < len) socket.write(frame(8, 0, id, u32be(1 << 20)));
            if (flags & 1) {
              socket.write(frame(1, 4, id, hpackStatus(200)));
              socket.write(frame(0, 1, id, Buffer.from(String(received.get(id)))));
            }
          }
        }
      });
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = await spawnFetch(`
        const opts = { method: "POST", tls: { rejectUnauthorized: false } };
        const one = await fetch("https://localhost:${port}/", { ...opts, body: new Blob([new Uint8Array(2_000_000)]) });
        console.log(one.status, await one.text());
        const many = await Promise.all(
          Array.from({ length: 4 }, () =>
            fetch("https://localhost:${port}/", { ...opts, body: new Blob([new Uint8Array(512 * 1024)]) }).then(r => r.text()),
          ),
        );
        console.log(many.join(","));
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("200 2000000\n524288,524288,524288,524288");
      expect(exitCode).toBe(0);
    } finally {
      server.close();
    }
  });

  test("cold-start: parallel requests coalesce onto one TLS connect", async () => {
    let sessions = 0;
    const server = makeH2Server();
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      stream.respond({ ":status": 200 });
      stream.end(String(headers[":path"]));
    });
    await listenH2(server, async url => {
      // No warmup: all 12 race the same fresh handshake.
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => fetch(`${url}/${i}`, h2).then(r => r.text())),
      );
      expect(results).toEqual(Array.from({ length: 12 }, (_, i) => `/${i}`));
      expect(sessions).toBe(1);
    });
  });

  test("abort sends RST_STREAM; siblings on the session survive", async () => {
    let sessions = 0;
    const { promise: slowClosed, resolve: resolveSlowClosed } = Promise.withResolvers<number>();
    const server = makeH2Server();
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      if (headers[":path"] === "/slow") {
        stream.on("close", () => resolveSlowClosed(stream.rstCode));
        // never respond; client will abort
      } else {
        stream.respond({ ":status": 200 });
        stream.end("survivor");
      }
    });
    await listenH2(server, async url => {
      // Warmup so /slow, /fast, /after share one session.
      expect(await fetch(`${url}/warmup`, h2).then(r => r.text())).toBe("survivor");
      const ac = new AbortController();
      const slow = fetch(`${url}/slow`, { ...h2, signal: ac.signal }).then(() => "resolved", errcode);
      const fast = await fetch(`${url}/fast`, h2).then(r => r.text());
      ac.abort();
      expect(await slow).toBe("AbortError");
      const after = await fetch(`${url}/after`, h2).then(r => r.text());
      expect({ fast, after }).toEqual({ fast: "survivor", after: "survivor" });
      // Aborting one stream must not tear down the connection: all four
      // requests rode one session, and /slow's stream was closed with
      // RST_STREAM(CANCEL) while /fast and /after on the same session completed.
      expect(sessions).toBe(1);
      expect(await slowClosed).toBe(http2.constants.NGHTTP2_CANCEL);
    });
  });

  test("server SETTINGS_MAX_CONCURRENT_STREAMS=1 is honoured per session", async () => {
    const perSessionMax: number[] = [];
    const server = makeH2Server({ settings: { maxConcurrentStreams: 1 } });
    server.on("session", s => {
      const idx = perSessionMax.push(0) - 1;
      let open = 0;
      s.on("stream", stream => {
        open++;
        perSessionMax[idx] = Math.max(perSessionMax[idx], open);
        stream.on("close", () => open--);
        // Keep the stream open for a moment so a client that ignored the cap
        // would be caught with a second stream open on this session.
        setTimeout(() => {
          stream.respond({ ":status": 200 });
          stream.end("x");
        }, 30);
      });
    });
    await listenH2(server, async url => {
      // First request alone so the server's SETTINGS arrives before the
      // burst, then fire 4 concurrently against the cap.
      expect(await fetch(url, h2).then(r => r.text())).toBe("x");
      const burst = await Promise.all(Array.from({ length: 4 }, () => fetch(url, h2).then(r => r.text())));
      expect(burst).toEqual(["x", "x", "x", "x"]);
      // The cap is per-connection: no session may ever see >1 open stream.
      // Excess concurrent requests fan out to additional connections.
      expect(perSessionMax.length).toBeGreaterThanOrEqual(1);
      expect(perSessionMax).toEqual(perSessionMax.map(() => 1));
    });
  });

  test("keep-alive: sequential requests reuse one h2 session", async () => {
    let sessions = 0;
    const seen: number[] = [];
    const server = makeH2Server();
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      seen.push(stream.id);
      stream.respond({ ":status": 200, "content-type": "text/plain" });
      stream.end(`req=${headers[":path"]}`);
    });
    await listenH2(server, async url => {
      const bodies: string[] = [];
      for (let i = 0; i < 4; i++) bodies.push(await fetch(`${url}/${i}`, h2).then(r => r.text()));
      expect(bodies).toEqual(["req=/0", "req=/1", "req=/2", "req=/3"]);
      expect(sessions).toBe(1);
      // stream ids must be fresh odd numbers on the reused session
      expect(seen).toEqual([1, 3, 5, 7]);
    });
  });

  test("GOAWAY after a request: next request reconnects", async () => {
    // One "closed by the peer" promise per accepted session, armed as soon as
    // the session exists so a close that lands before we look is not missed.
    const sessionClosed: Promise<void>[] = [];
    const server = makeH2Server();
    server.on("session", s => sessionClosed.push(new Promise(resolve => s.once("close", resolve))));
    server.on("stream", (stream, headers) => {
      const session = stream.session!;
      stream.respond({ ":status": 200 });
      stream.end("ok");
      if (headers[":path"] === "/first") {
        session.goaway(http2.constants.NGHTTP2_NO_ERROR, stream.id);
      }
    });
    await listenH2(server, async url => {
      const a = await fetch(`${url}/first`, h2).then(r => r.text());
      // A GOAWAY'd session can't be pooled, so the client closes it as soon as
      // it has processed the frame; once that close has arrived the next
      // request cannot land on the old session, so it has to open a new one.
      await sessionClosed[0];
      const b = await fetch(`${url}/second`, h2).then(r => r.text());
      expect([a, b]).toEqual(["ok", "ok"]);
      expect(sessionClosed).toHaveLength(2);
    });
  });

  test("response body larger than initial window triggers WINDOW_UPDATE", async () => {
    const big = Buffer.alloc(20 * 1024 * 1024, 0x61);
    await withH2Server(
      (_req, res) => {
        res.writeHead(200);
        res.end(big);
      },
      async url => {
        const res = await fetch(url, h2);
        const body = await res.bytes();
        expect(res.status).toBe(200);
        expect(body.byteLength).toBe(big.byteLength);
        expect(big.equals(body)).toBe(true);
      },
    );
  });

  test("response trailers are consumed without breaking the body", async () => {
    const server = makeH2Server();
    server.on("stream", stream => {
      stream.respond({ ":status": 200, "content-type": "text/plain" }, { waitForTrailers: true });
      stream.on("wantTrailers", () => stream.sendTrailers({ "x-trailer": "hello" }));
      stream.end("body-text");
    });
    await listenH2(server, async url => {
      const r = await fetch(url, h2);
      expect({ status: r.status, ct: r.headers.get("content-type"), body: await r.text() }).toEqual({
        status: 200,
        ct: "text/plain",
        body: "body-text",
      });
      // Trailer fields must not be merged into the response headers.
      expect(r.headers.get("x-trailer")).toBeNull();
    });
  });

  // Bun's node:http2 server currently emits an empty DATA+END_STREAM for
  // stream.close(code) rather than RST_STREAM, so this also covers the
  // RFC 9113 §8.1 "DATA before HEADERS" stream-error case (HTTP2ProtocolError);
  // once it sends a real RST_STREAM the request fails with HTTP2StreamReset.
  test("server-reset stream fails that request; sibling on the session survives", async () => {
    let sessions = 0;
    let good: http2.ServerHttp2Stream | undefined;
    let badReset = false;
    const answerGood = () => {
      if (!good || !badReset) return;
      good.respond({ ":status": 200 });
      good.end("ok");
    };
    const server = makeH2Server();
    server.on("session", () => sessions++);
    server.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      if (headers[":path"] === "/bad") {
        stream.close(http2.constants.NGHTTP2_PROTOCOL_ERROR);
        badReset = true;
      } else {
        good = stream;
      }
      // /good is only answered once /bad has been reset, so its response is
      // queued behind the reset on the one connection: receiving it proves
      // the client processed the reset without dropping the session.
      answerGood();
    });
    await listenH2(server, async url => {
      const [goodResult, badResult] = await Promise.all([
        fetch(`${url}/good`, h2).then(r => r.text()),
        bodyOrCode(fetch(`${url}/bad`, h2)),
      ]);
      expect(goodResult).toBe("ok");
      expect(badResult).toMatch(/^HTTP2(ProtocolError|StreamReset)$/);
      expect(sessions).toBe(1);
    });
  });

  test("connection-specific request headers are stripped before HPACK", async () => {
    let seen: string[] = [];
    const server = makeH2Server();
    server.on("stream", (stream, headers) => {
      seen = Object.keys(headers).filter(k => !k.startsWith(":"));
      stream.respond({ ":status": 200 });
      stream.end();
    });
    await listenH2(server, async url => {
      const sent = {
        "x-keep": "me",
        "Connection": "keep-alive",
        "Keep-Alive": "timeout=5",
        "Proxy-Connection": "x",
        "Transfer-Encoding": "chunked",
        "Upgrade": "ws",
      };
      const r = await fetch(url, { ...h2, headers: sent });
      expect(r.status).toBe(200);
      // Of the headers we sent, only the non-connection-specific one reached
      // the server (fetch adds its own accept/user-agent/etc. on top).
      const ours = Object.keys(sent).map(k => k.toLowerCase());
      expect(seen.filter(k => ours.includes(k))).toEqual(["x-keep"]);
    });
  });

  test("multiple Set-Cookie response headers survive HPACK decode", async () => {
    const server = makeH2Server();
    server.on("stream", stream => {
      stream.respond({ ":status": 200, "set-cookie": ["a=b", "c=d", "e=f"] });
      stream.end();
    });
    await listenH2(server, async url => {
      const r = await fetch(url, h2);
      expect(r.status).toBe(200);
      expect(r.headers.getSetCookie()).toEqual(["a=b", "c=d", "e=f"]);
    });
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
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      await using proc = await spawnFetch(`
        const results = [];
        for (const [path, init] of [["/204", {}], ["/205", {}], ["/head", { method: "HEAD" }]]) {
          const r = await fetch("https://localhost:${port}" + path, { ...init, tls: { rejectUnauthorized: false } });
          results.push({
            status: r.status,
            contentLength: r.headers.get("content-length"),
            body: r.body,
            text: await r.text(),
            bodyUsed: r.bodyUsed,
            cloneBody: r.clone().body,
          });
        }
        console.log(JSON.stringify(results));
      `);
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        { status: 204, contentLength: null, body: null, text: "", bodyUsed: false, cloneBody: null },
        { status: 205, contentLength: null, body: null, text: "", bodyUsed: false, cloneBody: null },
        { status: 200, contentLength: "5", body: null, text: "", bodyUsed: false, cloneBody: null },
      ]);
      expect(exitCode).toBe(0);
    } finally {
      server.close();
    }
  });

  describe("raw frame server", () => {
    test("REFUSED_STREAM is transparently retried on the same connection", async () => {
      let attempts = 0;
      await withRawH2Server(
        (conn, id) => {
          attempts++;
          if (attempts === 1) return conn.rst(id, http2.constants.NGHTTP2_REFUSED_STREAM);
          conn.headers(id, hpackStatus(204), { endStream: true });
        },
        async (url, state) => {
          const r = await fetch(url, h2);
          expect({ status: r.status, body: await r.text(), attempts, connections: state.connections }).toEqual({
            status: 204,
            body: "",
            attempts: 2,
            connections: 1,
          });
          // The retry must use a fresh stream id on the same connection.
          expect(state.frames.filter(f => f.type === FRAME_HEADERS).map(f => f.id)).toEqual([1, 3]);
        },
      );
    });

    test("RST_STREAM(NO_ERROR) after a complete response keeps the response; a later RST is ignored", async () => {
      // RFC 9113 §8.1: the server may finish the response before the request
      // body and reset with NO_ERROR; DATA we had in flight can then draw a
      // second RST_STREAM(STREAM_CLOSED), which must not clobber the result.
      await withRawH2Server(
        (conn, id) => {
          conn.headers(id, hpackStatus(200));
          conn.data(id, "early", true);
          conn.rst(id, http2.constants.NGHTTP2_NO_ERROR);
          conn.rst(id, http2.constants.NGHTTP2_STREAM_CLOSED);
        },
        async url => {
          await using proc = await spawnFetch(`
            const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1024)); /* never closes */ } });
            const r = await fetch("${url}", { method: "POST", body, duplex: "half", tls: { rejectUnauthorized: false } });
            console.log(r.status, await r.text());
          `);
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stderr).toBe("");
          expect(stdout.trim()).toBe("200 early");
          expect(exitCode).toBe(0);
        },
      );
    });

    test("REFUSED_STREAM gives up after max retries", async () => {
      let attempts = 0;
      await withRawH2Server(
        (conn, id) => {
          attempts++;
          conn.rst(id, http2.constants.NGHTTP2_REFUSED_STREAM);
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2RefusedStream");
          // initial + 5 retries
          expect(attempts).toBe(6);
        },
      );
    });

    test("RST_STREAM PROTOCOL_ERROR is not retried", async () => {
      let attempts = 0;
      await withRawH2Server(
        (conn, id) => {
          attempts++;
          conn.rst(id, http2.constants.NGHTTP2_PROTOCOL_ERROR);
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2StreamReset");
          expect(attempts).toBe(1);
        },
      );
    });

    test("graceful GOAWAY past our id retries on a fresh connection", async () => {
      await withRawH2Server(
        (conn, id, connIndex) => {
          if (connIndex === 0) {
            // First connection: refuse via GOAWAY(NO_ERROR, lastId=0).
            conn.goaway(0, 0);
            conn.socket.end();
            return;
          }
          conn.headers(id, hpackStatus(200), { endStream: false });
          conn.data(id, "second-conn", true);
        },
        async (url, state) => {
          const r = await fetch(url, h2);
          expect({ status: r.status, body: await r.text(), connections: state.connections }).toEqual({
            status: 200,
            body: "second-conn",
            connections: 2,
          });
        },
      );
    });

    test("REFUSED_STREAM with a streaming body errors instead of retrying", async () => {
      let attempts = 0;
      await withRawH2Server(
        (conn, id) => {
          attempts++;
          conn.rst(id, http2.constants.NGHTTP2_REFUSED_STREAM);
        },
        async url => {
          const body = new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array([1, 2, 3]));
              c.close();
            },
          });
          expect(await statusOrCode(fetch(url, { ...h2, method: "POST", body, duplex: "half" }))).toBe(
            "HTTP2RefusedStream",
          );
          expect(attempts).toBe(1);
        },
      );
    });

    test("padded DATA: pad bytes are stripped and credited against flow control", async () => {
      await withRawH2Server(
        (conn, id) => {
          conn.headers(id, hpackStatus(200));
          // PADDED flag = 0x8; payload = padLen(1) + body + pad zeros.
          const body = Buffer.from("padded-body");
          const padLen = 200;
          const payload = Buffer.concat([Buffer.from([padLen]), body, Buffer.alloc(padLen)]);
          conn.socket.write(frame(0, 0x8 | 0x1, id, payload));
        },
        async url => {
          const r = await fetch(url, h2);
          expect({ status: r.status, body: await r.text() }).toEqual({ status: 200, body: "padded-body" });
        },
      );
    });

    test("1xx informational HEADERS are skipped, final response delivered", async () => {
      await withRawH2Server(
        (conn, id) => {
          // Single write so 100 and 200 land in the same onData pass; HPACK
          // must decode both in order.
          conn.socket.write(
            Buffer.concat([
              frame(1, 4, id, hpackStatus(100)),
              frame(1, 4, id, Buffer.concat([hpackStatus(200), hpackLit("x-after", "100")])),
              frame(0, 1, id, Buffer.from("final")),
            ]),
          );
        },
        async url => {
          const r = await fetch(url, h2);
          expect({ status: r.status, after: r.headers.get("x-after"), body: await r.text() }).toEqual({
            status: 200,
            after: "100",
            body: "final",
          });
        },
      );
    });

    test("1xx HEADERS with END_STREAM is a stream PROTOCOL_ERROR (RFC 9113 §8.1)", async () => {
      await withRawH2Server(
        (conn, id) => conn.headers(id, hpackStatus(100), { endStream: true }),
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2ProtocolError");
        },
      );
    });

    test("DATA after only a 1xx HEADERS is a stream PROTOCOL_ERROR (RFC 9113 §8.1)", async () => {
      await withRawH2Server(
        (conn, id) => {
          conn.socket.write(Buffer.concat([frame(1, 4, id, hpackStatus(100)), frame(0, 1, id, Buffer.from("body"))]));
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2ProtocolError");
        },
      );
    });

    test("response + trailers in a single packet keep HPACK in sync", async () => {
      await withRawH2Server(
        (conn, id) => {
          conn.socket.write(
            Buffer.concat([
              frame(1, 4, id, Buffer.concat([hpackStatus(200), hpackLit("x-real", "yes")])),
              frame(0, 0, id, Buffer.from("body")),
              frame(1, 4 | 1, id, hpackLit("x-trailer", "ignored")),
            ]),
          );
        },
        async url => {
          const r = await fetch(url, h2);
          expect({
            status: r.status,
            real: r.headers.get("x-real"),
            trailer: r.headers.get("x-trailer"),
            body: await r.text(),
          }).toEqual({ status: 200, real: "yes", trailer: null, body: "body" });
        },
      );
    });

    test("Expect: 100-continue withholds the body until 100 arrives", async () => {
      let dataFramesBefore100 = -1;
      await withRawH2Server(
        async (conn, id) => {
          let dataFrames = 0;
          conn.onFrame = f => {
            if (f.id !== id || f.type !== FRAME_DATA) return;
            dataFrames++;
            if (f.flags & FLAG_END_STREAM) {
              conn.headers(id, hpackStatus(200));
              conn.data(id, "got-body", true);
            }
          };
          // A client that ignored Expect would have written the DATA frames right
          // behind HEADERS, i.e. ahead of its answer to this PING; so once the
          // ACK is back, any DATA that was going to arrive before the 100 has.
          await conn.ping();
          dataFramesBefore100 = dataFrames;
          conn.headers(id, hpackStatus(100));
        },
        async (url, state) => {
          const r = await fetch(url, {
            ...h2,
            method: "POST",
            headers: { Expect: "100-continue" },
            body: "twenty-chars-body!!!",
          });
          expect({ status: r.status, body: await r.text() }).toEqual({ status: 200, body: "got-body" });
          expect(dataFramesBefore100).toBe(0);
          // HEADERS (stream left open for the body), then, only after the 100,
          // the whole body in one DATA frame carrying END_STREAM.
          expect(state.frames.map(f => ({ type: f.type, len: f.len, endStream: f.flags & FLAG_END_STREAM }))).toEqual([
            { type: FRAME_HEADERS, len: expect.any(Number), endStream: 0 },
            { type: FRAME_DATA, len: 20, endStream: FLAG_END_STREAM },
          ]);
        },
      );
    });

    test("Expect: 100-continue with final status before 100 skips body upload", async () => {
      await withRawH2Server(
        (conn, id) => {
          // Reject stream 1 immediately without a 100; the barrier request on
          // stream 3 is answered normally.
          conn.headers(id, id === 1 ? hpackStatus(404) : hpackStatus(204), { endStream: true });
        },
        async (url, state) => {
          const body = Buffer.alloc(50000, "x").toString();
          const r = await fetch(url, { ...h2, method: "POST", headers: { Expect: "100-continue" }, body });
          expect(r.status).toBe(404);
          // Anything the client wrote for stream 1 is queued ahead of the
          // barrier's HEADERS(3) on the one connection, so the 204 coming back
          // means the stream-1 frame log below is complete.
          expect((await fetch(url, h2)).status).toBe(204);
          expect(state.connections).toBe(1);
          // Body was withheld: no DATA payload bytes were ever sent for stream 1.
          const stream1 = state.frames.filter(f => f.id === 1);
          expect(stream1[0].type).toBe(FRAME_HEADERS);
          expect(stream1.filter(f => f.type === FRAME_DATA).reduce((n, f) => n + f.len, 0)).toBe(0);
        },
      );
    });

    test("Content-Length / DATA mismatch rejects", async () => {
      await withRawH2Server(
        (conn, id) => {
          conn.headers(id, Buffer.concat([hpackStatus(200), hpackLit("content-length", "42")]));
          conn.data(id, "short", true);
        },
        async url => {
          expect(await bodyOrCode(fetch(url, h2))).toBe("HTTP2ContentLengthMismatch");
        },
      );
    });

    test("Content-Length with END_STREAM on HEADERS and zero DATA rejects", async () => {
      // RFC 9113 §8.1.1: declared length must equal sum of DATA payloads even
      // when that sum is zero. Previously this hit the early-finish branch
      // and resolved with an empty body.
      await withRawH2Server(
        (conn, id) => {
          conn.headers(id, Buffer.concat([hpackStatus(200), hpackLit("content-length", "42")]), { endStream: true });
        },
        async url => {
          expect(await bodyOrCode(fetch(url, h2))).toBe("HTTP2ContentLengthMismatch");
        },
      );
    });

    test("response missing :status pseudo-header rejects cleanly", async () => {
      await withRawH2Server(
        (conn, id) => {
          conn.headers(id, hpackLit("content-type", "text/plain"), { endStream: true });
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2ProtocolError");
        },
      );
    });

    test("Content-Length satisfied before END_STREAM doesn't dereference a freed client", async () => {
      // Server sends the body in a DATA frame without END_STREAM; the frame
      // fully satisfies Content-Length, so the response completes and the JS
      // callback frees the AsyncHTTP. The stray empty DATA(END_STREAM) for that
      // stream is only sent once the client opens stream 3, i.e. after the
      // first response has been consumed in JS, and it is queued ahead of the
      // stream-3 response, so the second fetch resolving proves the stale
      // stream-1 frame was processed. Runs in a subprocess because the
      // failure mode is a crash.
      await withRawH2Server(
        (conn, id) => {
          if (id === 1) {
            conn.headers(id, Buffer.concat([hpackStatus(200), hpackLit("content-length", "5")]));
            conn.data(id, "hello", false);
          } else {
            conn.data(1, "", true);
            conn.headers(id, hpackStatus(204), { endStream: true });
          }
        },
        async (url, state) => {
          await using proc = spawnFetch(`
            const r = await fetch(${JSON.stringify(url)}, { protocol: "http2", tls: { rejectUnauthorized: false } });
            console.log(r.status, await r.text());
            console.log((await fetch(${JSON.stringify(url)}, { protocol: "http2", tls: { rejectUnauthorized: false } })).status);
          `);
          const { stdout, stderr, exitCode } = await collect(proc);
          expect(stderr).toBe("");
          expect(stdout).toBe("200 hello\n204");
          expect(exitCode).toBe(0);
          expect(state.connections).toBe(1);
        },
      );
    });

    test("SETTINGS_MAX_FRAME_SIZE below 16384 is rejected as a connection error", async () => {
      // RFC 9113 §6.5.2: values outside [16384, 2^24-1] are PROTOCOL_ERROR.
      // Without the lower bound a MAX_FRAME_SIZE of 0 made writeHeaderBlock
      // loop forever emitting zero-length frames; with it the connection
      // should fail promptly.
      await withRawH2Server(
        (conn, id) => {
          conn.socket.write(frame(4, 0, 0, Buffer.concat([Buffer.from([0, 5]), u32be(0)])));
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2ProtocolError");
        },
      );
    });

    test("SETTINGS_INITIAL_WINDOW_SIZE above 2^31-1 is a connection FLOW_CONTROL_ERROR", async () => {
      // RFC 9113 §6.5.2.
      await withRawH2Server(
        (conn, id) => {
          // setting type 4 (INITIAL_WINDOW_SIZE), value 0x80000000
          conn.socket.write(frame(4, 0, 0, Buffer.concat([Buffer.from([0, 4]), u32be(0x80000000)])));
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2FlowControlError");
        },
      );
    });

    test("WINDOW_UPDATE with zero increment on stream 0 is a connection PROTOCOL_ERROR", async () => {
      // RFC 9113 §6.9.
      await withRawH2Server(
        (conn, id) => {
          conn.socket.write(frame(8, 0, 0, u32be(0)));
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2ProtocolError");
        },
      );
    });

    test("HEADERS on a stream id we never opened is a connection PROTOCOL_ERROR", async () => {
      // RFC 9113 §5.1: receiving a frame on an idle stream (id >= our next
      // odd id) or an even (server-initiated) id while push is disabled is a
      // connection error, not a discardable orphan.
      await withRawH2Server(
        (conn, id) => {
          conn.headers(2, hpackStatus(200), { endStream: true });
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2ProtocolError");
        },
      );
    });

    test("frame larger than the local SETTINGS_MAX_FRAME_SIZE is a connection FRAME_SIZE_ERROR", async () => {
      // RFC 9113 §4.2. We never advertise above the 16384 default, so a peer
      // declaring a 16385-byte payload is a connection error and must not be
      // buffered (the unbounded path would let a peer balloon read_buffer to
      // ~16 MiB).
      await withRawH2Server(
        conn => {
          conn.socket.write(frame(0, 0, 1, Buffer.alloc(16385)));
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2FrameSizeError");
        },
      );
    });

    test("SETTINGS frame on a non-zero stream id is a connection PROTOCOL_ERROR", async () => {
      // RFC 9113 §6.5.
      await withRawH2Server(
        (conn, id) => {
          conn.socket.write(frame(4, 0, 1));
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2ProtocolError");
        },
      );
    });

    test("RST_STREAM on an idle stream is a connection PROTOCOL_ERROR", async () => {
      // RFC 9113 §6.4.
      await withRawH2Server(
        (conn, id) => {
          conn.rst(id + 2, 0);
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2ProtocolError");
        },
      );
    });

    test("PING with length != 8 is a connection FRAME_SIZE_ERROR", async () => {
      // RFC 9113 §6.7.
      await withRawH2Server(
        (conn, id) => {
          conn.socket.write(frame(6, 0, 0, Buffer.alloc(4)));
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2FrameSizeError");
        },
      );
    });

    test("PING on a non-zero stream id is a connection PROTOCOL_ERROR", async () => {
      // RFC 9113 §6.7.
      await withRawH2Server(
        (conn, id) => {
          conn.socket.write(frame(6, 0, 1, Buffer.alloc(8)));
          conn.headers(id, hpackStatus(200), { endStream: true });
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2ProtocolError");
        },
      );
    });

    test("303 redirect on a streaming-body POST RSTs the half-open upload stream", async () => {
      // The redirect detaches stream 1 before END_STREAM is ever written for
      // the request body. Without an RST_STREAM(CANCEL) the server is left
      // holding it half-open against MAX_CONCURRENT_STREAMS.
      await withRawH2Server(
        (conn, id) => {
          if (id === 1) {
            conn.headers(id, Buffer.concat([hpackLit(":status", "303"), hpackLit("location", "/target")]), {
              endStream: true,
            });
          } else {
            conn.headers(id, hpackStatus(200), { endStream: true });
          }
        },
        async (url, state) => {
          // Never closes: the 303 has to cancel the upload.
          const body = new ReadableStream({
            start(ctrl) {
              ctrl.enqueue(new Uint8Array([1, 2, 3]));
            },
            pull() {
              return new Promise<void>(() => {});
            },
          });
          const r = await fetch(`${url}/upload`, { ...h2, method: "POST", body, duplex: "half" });
          expect({ status: r.status, redirected: r.redirected, url: r.url }).toEqual({
            status: 200,
            redirected: true,
            url: `${url}/target`,
          });
          // The follow-up GET rode the same connection, and its HEADERS(3) was
          // queued behind RST_STREAM(1), so the 200 arriving means the RST did.
          expect({ rst: state.rst, connections: state.connections }).toEqual({
            rst: [{ id: 1, code: http2.constants.NGHTTP2_CANCEL }],
            connections: 1,
          });
        },
      );
    });

    test("client RSTs the stream when it abandons on a local error", async () => {
      // handleResponseBody throws on invalid gzip; the catch path must send
      // RST_STREAM(CANCEL) so the server doesn't keep the stream open
      // counting against MAX_CONCURRENT_STREAMS.
      await withRawH2Server(
        (conn, id) => {
          if (id === 1) {
            conn.headers(id, Buffer.concat([hpackStatus(200), hpackLit("content-encoding", "gzip")]));
            conn.data(id, Buffer.from("not gzip"));
          } else {
            // Barrier request, see below.
            conn.headers(id, hpackStatus(204), { endStream: true });
          }
        },
        async (url, state) => {
          expect(await bodyOrCode(fetch(url, h2))).toBe("ZlibError");
          // Second request on the same pooled session acts as a delivery
          // barrier: RST_STREAM(1) is queued ahead of HEADERS(3) on the one
          // socket, so the 204 arriving back proves the RST reached the server.
          expect((await fetch(url, h2)).status).toBe(204);
          // 0x8 = CANCEL. connections=1 proves the barrier rode the same
          // socket, so ordering actually applies.
          expect({ rst: state.rst, connections: state.connections }).toEqual({
            rst: [{ id: 1, code: http2.constants.NGHTTP2_CANCEL }],
            connections: 1,
          });
        },
      );
    });

    test("RST_STREAM(NO_ERROR) before final HEADERS fails the request instead of hanging", async () => {
      await withRawH2Server(
        (conn, id) => {
          conn.rst(id, 0);
        },
        async url => {
          expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2StreamReset");
        },
      );
    });
  });

  test("flag off: ALPN does not offer h2", async () => {
    let alpn: string | false | null = null;
    const server = nodetls.createServer({ ...tls, ALPNProtocols: ["h2", "http/1.1"] }, sock => {
      alpn = sock.alpnProtocol;
      sock.end("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 2\r\n\r\nok");
    });
    server.on("tlsClientError", () => {});
    await listenTcp(server, "https", async url => {
      await using proc = spawnFetch(
        `console.log(await fetch(${JSON.stringify(url)}, { tls: { rejectUnauthorized: false } }).then(r => r.text()));`,
        {},
      );
      const { stdout, stderr, exitCode } = await collect(proc);
      expect(stderr).toBe("");
      expect(stdout).toBe("ok");
      // The server prefers h2; if the client had offered it, ALPN would have
      // selected it and the HTTP/1.1 response above would have failed parse.
      expect(alpn).toBe("http/1.1");
      expect(exitCode).toBe(0);
    });
  });

  test("--experimental-http2-fetch enables h2 without the env flag", async () => {
    await withH2Server(
      (req, res) => {
        res.writeHead(200);
        res.end(req.httpVersion);
      },
      async url => {
        // No BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT in env; the CLI flag
        // alone should make ALPN offer h2.
        await using proc = spawnFetch(
          `const r = await fetch(${JSON.stringify(url)}, { tls: { rejectUnauthorized: false } });
           console.log(r.status, await r.text());`,
          {},
          "--experimental-http2-fetch",
        );
        const { stdout, stderr, exitCode } = await collect(proc);
        expect(stderr).toBe("");
        expect(stdout).toBe("200 2.0");
        expect(exitCode).toBe(0);
      },
    );
  });

  test("protocol:'http2' forces h2 without the env flag", async () => {
    await withH2Server(
      (req, res) => {
        res.writeHead(200);
        res.end(req.httpVersion);
      },
      async url => {
        // No BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT in env.
        await using proc = spawnFetch(
          `const r = await fetch(${JSON.stringify(url)}, { protocol: "http2", tls: { rejectUnauthorized: false } });
           console.log(r.status, await r.text());`,
          {},
        );
        const { stdout, stderr, exitCode } = await collect(proc);
        expect(stderr).toBe("");
        expect(stdout).toBe("200 2.0");
        expect(exitCode).toBe(0);
      },
    );
  });

  test.each([
    ["small (shared-buffer fast path)", 32 * 1024],
    ["large (zlib-streaming spill path)", 600 * 1024],
  ])("compress: gzip request body over h2 — %s", async (_, size) => {
    await withH2Server(
      (req, res) => {
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
      },
      async url => {
        const payload = Buffer.alloc(size, "abcdefghij");
        const r = await fetch(url, { ...h2, method: "POST", body: payload, compress: "gzip" });
        const decoded = Buffer.from(await r.arrayBuffer());
        const recvLen = Number(r.headers.get("x-recv-len"));
        expect(recvLen).toBeGreaterThan(0);
        expect(recvLen).toBeLessThan(size);
        expect({
          status: r.status,
          encoding: r.headers.get("x-recv-encoding"),
          contentLength: r.headers.get("x-recv-content-length"),
          match: decoded.equals(payload),
        }).toEqual({ status: 200, encoding: "gzip", contentLength: String(recvLen), match: true });
      },
    );
  });

  test("protocol:'http2' against an h1-only server fails with HTTP2Unsupported", async () => {
    let requests = 0;
    const server = https.createServer({ ...tls }, (_req, res) => {
      requests++;
      res.end("h1");
    });
    await listenTcp(server, "https", async url => {
      expect(await statusOrCode(fetch(url, h2))).toBe("HTTP2Unsupported");
      // Pinned to h2, the request must not be downgraded and sent over h1.
      expect(requests).toBe(0);
    });
  });

  test("ALPN h1 result re-dispatches coalesced waiters in parallel, not serial", async () => {
    // h1-only TLS server: leader's ALPN resolves to http/1.1, so waiters
    // re-dispatch. Each must open its own connection on the same loop turn
    // rather than re-coalescing onto the first waiter's new PendingConnect.
    let active = 0;
    let peak = 0;
    const { promise, resolve } = Promise.withResolvers<void>();
    const server = https.createServer({ ...tls }, (_req, res) => {
      active++;
      peak = Math.max(peak, active);
      if (active === 5) resolve();
      promise.then(() => {
        res.end("ok");
        active--;
      });
    });
    await listenTcp(server, "https", async url => {
      await using proc = spawnFetch(`
        const url = ${JSON.stringify(url)};
        const tls = { rejectUnauthorized: false };
        const rs = await Promise.all(Array.from({ length: 5 }, () => fetch(url, { tls }).then(r => r.text())));
        console.log(rs.join(","));
      `);
      const { stdout, stderr, exitCode } = await collect(proc);
      expect(stderr).toBe("");
      expect(stdout).toBe("ok,ok,ok,ok,ok");
      expect(exitCode).toBe(0);
      // If waiters re-coalesced, peak would be 1 (sequential); 5 means all
      // five connections were open before any response was written.
      expect(peak).toBe(5);
    });
  });

  test('protocol: "http1.1" overrides the env flag and pins ALPN to http/1.1', async () => {
    // Server is h2-only: the unpinned fetch (env flag on) negotiates h2, while
    // the pinned fetch advertises only http/1.1 and is rejected at ALPN —
    // proving the pin actually reached the ClientHello.
    let requests = 0;
    await withH2Server(
      (req, res) => {
        requests++;
        res.end(req.httpVersion);
      },
      async url => {
        await using proc = spawnFetch(`
          const url = ${JSON.stringify(url)};
          const tls = { rejectUnauthorized: false };
          const a = await fetch(url, { tls }).then(r => r.text());
          const b = await fetch(url, { protocol: "http1.1", tls }).then(r => "resolved:" + r.status, () => "rejected");
          console.log(a, b);
        `);
        const { stdout, stderr, exitCode } = await collect(proc);
        expect(stderr).toBe("");
        expect(stdout).toBe("2.0 rejected");
        expect(exitCode).toBe(0);
        // The pinned request never got past the handshake.
        expect(requests).toBe(1);
      },
    );
  });

  test('protocol: "http2" on a plain http:// URL fails with HTTP2Unsupported', async () => {
    // h2c is out of scope; without an explicit check the request would
    // silently complete over HTTP/1.1.
    let connections = 0;
    const server = net.createServer(sock => {
      connections++;
      sock.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
    });
    await listenTcp(server, "http", async url => {
      expect(await statusOrCode(fetch(url, { protocol: "http2" }))).toBe("HTTP2Unsupported");
      // The request is refused before anything is sent: a fresh connection to
      // the same server over h1 works and is the first one it sees.
      expect(await fetch(url).then(r => r.text())).toBe("ok");
      expect(connections).toBe(1);
    });
  });

  test("abort while coalesced onto an in-flight TLS connect resolves promptly", async () => {
    // Leader's TLS handshake never completes (server is plain TCP), so its
    // PendingConnect stays open. The waiter has no abort-tracker entry and
    // would otherwise wait for the leader before observing the abort.
    let conns = 0;
    const { promise: accepted, resolve: onAccept } = Promise.withResolvers<net.Socket>();
    const server = net.createServer(sock => {
      conns++;
      sock.on("error", () => {});
      onAccept(sock);
    });
    await listenTcp(server, "https", async url => {
      const leader = fetch(url, h2).then(() => "resolved", errcode);
      const ac = new AbortController();
      const waiter = fetch(url, { ...h2, signal: ac.signal }).then(() => "resolved", errcode);
      // Once the server has accepted the leader's TCP connection both fetches
      // have been processed on the http thread (PendingConnect creation is
      // synchronous in connect()).
      const leaderSocket = await accepted;
      ac.abort();
      // The leader is still stuck in its handshake at this point, so this can
      // only settle if the abort was observed while coalesced.
      expect(await waiter).toBe("AbortError");
      // Killing the leader's socket fails the leader; the aborted waiter must
      // not be re-dispatched as a new connect in the process.
      leaderSocket.destroy();
      expect(await leader).not.toBe("resolved");
      expect(conns).toBe(1);
    });
  });

  test("SETTINGS_HEADER_TABLE_SIZE=0: encoder emits a Dynamic Table Size Update so request 2+ decodes", async () => {
    // RFC 9113 §4.3.1 / RFC 7541 §6.3: a server that shrinks the encoder's
    // dynamic table expects the next header block to begin with a 0x20-prefix
    // size-update opcode. nghttp2 (which backs node:http2) enforces this and
    // closes the connection with COMPRESSION_ERROR if the opcode is missing,
    // so requests after the first hang/fail without the fix.
    let sessions = 0;
    const server = makeH2Server({ settings: { headerTableSize: 0 } }, (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    server.on("session", () => sessions++);
    server.on("sessionError", () => {});
    await listenH2(server, async url => {
      const results: string[] = [];
      for (let i = 0; i < 3; i++) results.push(await bodyOrCode(fetch(url, h2)));
      expect(results).toEqual(["ok", "ok", "ok"]);
      // All three header blocks were decoded by the same (shrunk) decoder; a
      // reconnect per request would have passed the body check vacuously.
      expect(sessions).toBe(1);
    });
  });

  test("303 to a streaming POST over HTTP/1.1 closes the socket instead of pooling it mid-chunked-body", async () => {
    // Regression for the doRedirect change in this PR: dropping the
    // closeAndFail(UnexpectedRedirect) guard let a 303 with a streaming
    // body fall through to the keep-alive pool even though the chunked
    // upload's terminating 0\r\n\r\n was never written. The follow-up GET
    // must open a fresh connection.
    let conns = 0;
    const server = net.createServer(sock => {
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
          sock.end(`HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 6\r\n\r\nconn=${idx}`);
        }
      });
      sock.on("error", () => {});
    });
    await listenTcp(server, "http", async url => {
      // Never closes; the 303 cancels the upload.
      const body = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(new Uint8Array([1, 2, 3, 4]));
        },
        pull() {
          return new Promise<void>(() => {});
        },
      });
      const res = await fetch(`${url}/upload`, { method: "POST", body, duplex: "half" });
      // conn=1 (zero-indexed) and conns=2 prove the follow-up GET opened a
      // fresh socket; the bug would show conn=0 or hang.
      expect({ status: res.status, body: await res.text(), conns }).toEqual({ status: 200, body: "conn=1", conns: 2 });
    });
  });

  test("leader abort does not fail a coalesced force_http2 waiter with HTTP2Unsupported", async () => {
    // Regression for resolvePendingH2 conflating "ALPN chose h1" with
    // "leader failed pre-handshake". Server never speaks TLS, so the leader
    // sits in handshake; the waiter coalesces onto its PendingConnect. When
    // the leader is aborted, the waiter must retry as the new leader (a
    // second TCP connect) rather than be told the server lacks h2.
    let conns = 0;
    const accepts = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const server = net.createServer(sock => {
      sock.on("error", () => {});
      accepts[conns++]?.resolve();
    });
    await listenTcp(server, "https", async url => {
      const leaderAc = new AbortController();
      const leader = fetch(url, { ...h2, signal: leaderAc.signal }).then(() => "resolved", errcode);
      const waiterAc = new AbortController();
      const waiter = fetch(url, { ...h2, signal: waiterAc.signal }).then(() => "resolved", errcode);
      await accepts[0].promise;
      // Only the leader has connected: the waiter coalesced onto it.
      expect(conns).toBe(1);
      leaderAc.abort();
      expect(await leader).toBe("AbortError");
      // The waiter must now show up as a second TCP connect while still
      // pending; a regressed client settles it (HTTP2Unsupported) instead.
      expect(await Promise.race([accepts[1].promise.then(() => "second connect"), waiter])).toBe("second connect");
      expect(conns).toBe(2);
      waiterAc.abort();
      expect(await waiter).toBe("AbortError");
    });
  });

  // Cloudflare sends its SETTINGS frame as TLS 1.3 0.5-RTT data, so the
  // client's first SSL_read that returns app data is also the call that
  // completes the handshake. ssl_on_data must fire on_handshake there or the
  // socket never gets re-tagged for h2 and the frame bytes hit the HTTP/1.1
  // parser as Malformed_HTTP_Response. Neither node:tls nor Bun.listen exposes
  // the 0.5-RTT write window, so this hits a real Cloudflare-fronted origin —
  // tolerate network blips by only failing on the specific regression code.
  test("GET https://registry.npmjs.org over protocol: http2", async () => {
    const out = await statusOrCode(fetch("https://registry.npmjs.org", { protocol: "http2" }));
    // The bug under test surfaces as Malformed_HTTP_Response — DNS/connect
    // failures or 5xx are environmental, not regressions.
    expect(out).not.toBe("Malformed_HTTP_Response");
    if (typeof out !== "number") {
      console.warn(`skipping live h2 assertion: ${out}`);
      return;
    }
    expect(out).toBe(200);
  });
});

test.concurrent(
  "await fetch() over HTTP/2 resolves on headers, before a content-length body is fully received",
  async () => {
    const { promise: held, resolve: hold } = Promise.withResolvers<http2.Http2Stream>();
    const server = makeH2Server();
    server.on("stream", stream => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200, "content-length": "262144" });
      stream.write(Buffer.alloc(64 * 1024));
      // The remaining 192 KiB is written from the test body once the client
      // has the Response and a first chunk in hand.
      hold(stream);
    });
    await listenH2(server, async url => {
      const r = await fetch(url, h2);
      expect({ status: r.status, contentLength: r.headers.get("content-length") }).toEqual({
        status: 200,
        contentLength: "262144",
      });
      const reader = r.body!.getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);
      let n = first.value!.byteLength;
      // Both the Response and a body chunk were delivered while the server was
      // still holding back most of the body; only now does the rest go out.
      (await held).end(Buffer.alloc(192 * 1024));
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        n += value.byteLength;
      }
      expect(n).toBe(262144);
    });
  },
);
