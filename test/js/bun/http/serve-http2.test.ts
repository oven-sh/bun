import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "crypto";
import { bunEnv, bunExe, tempDir, tls as tlsCert } from "harness";
import http2 from "node:http2";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

// ─── fixture ────────────────────────────────────────────────────────────────
// One long-lived server per describe block, driven over real sockets. The
// fixture reports its port on stdout and stops on stdin EOF.

const fixtureSource = (opts: { tls: boolean; http1?: boolean; http3?: boolean; extra?: string }) => `
import { serve } from "bun";
const big = Buffer.alloc(5 * 1024 * 1024, "abcdefghijklmnop");
let lateRead;
const makeRoutes = () => ({
    "/api/:id": req => new Response("id=" + req.params.id, { headers: { "x-route": "api" } }),
    "/route-only": { POST: () => new Response("posted") },
    "/static": new Response("from-static-route", { headers: { "content-type": "text/plain", etag: '"v1"' } }),
    "/static-hop": new Response("hop", { headers: { connection: "keep-alive", "keep-alive": "timeout=5", te: "gzip", "x-kept": "1" } }),
    "/file-hop": new Response(Bun.file(process.env.BIG_FILE), { headers: { connection: "close", upgrade: "x", "x-kept": "1" } }),
    "/file-route": Bun.file(process.env.BIG_FILE),
    "/cookies": req => {
      req.cookies.set("seen", (req.cookies.get("seen") ?? "") + "x");
      return new Response("ok");
    },
});
const routes = makeRoutes();
const server = serve({
  port: 0,
  ${opts.tls ? `tls: ${JSON.stringify(tlsCert)},` : ""}
  http2: true,
  http1: ${opts.http1 ?? true},
  ${opts.http3 ? "http3: true," : ""}
  idleTimeout: Number(process.env.IDLE_TIMEOUT ?? 30),
  routes,
  fetch: handler,
  websocket: { message() {} },
  ${opts.extra ?? ""}
});
async function handler(req, server) {
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/hello":
        return new Response("hello", { headers: { "x-proto": "h2", "content-type": "text/plain" } });
      case "/echo": {
        const body = await req.text();
        return new Response(body, {
          status: 201,
          headers: { "x-method": req.method, "x-echo": req.headers.get("x-echo") ?? "", "x-len": String(body.length) },
        });
      }
      case "/echo-bytes": {
        const body = await req.arrayBuffer();
        return new Response(body, { headers: { "x-len": String(body.byteLength) } });
      }
      case "/digest": {
        const hash = new Bun.CryptoHasher("sha256");
        let n = 0;
        for await (const chunk of req.body) { hash.update(chunk); n += chunk.byteLength; }
        return new Response(hash.digest("hex"), { headers: { "x-len": String(n) } });
      }
      case "/big":
        return new Response(big, { headers: { "content-type": "application/octet-stream" } });
      case "/stream": {
        let i = 0;
        return new Response(new ReadableStream({
          pull(controller) {
            if (i++ >= 64) return controller.close();
            controller.enqueue(new TextEncoder().encode("chunk" + i + Buffer.alloc(1019, ";").toString()));
          },
        }), { headers: { "content-type": "text/plain" } });
      }
      case "/file":
        return new Response(Bun.file(process.env.BIG_FILE));
      case "/file-stream":
        return new Response(Bun.file(process.env.BIG_FILE).stream());
      case "/status/204":
        return new Response(null, { status: 204, headers: { "x-empty": "1" } });
      case "/headers": {
        const out = {};
        for (const [k, v] of req.headers) out[k] = v;
        return Response.json({ url: req.url, method: req.method, headers: out });
      }
      case "/set-cookies":
        return new Response("ok", { headers: [["set-cookie", "a=1"], ["set-cookie", "b=2"], ["x-multi", "1"], ["x-multi", "2"]] });
      case "/many-headers": {
        const h = new Headers();
        for (let i = 0; i < 3000; i++) h.set("x-header-" + i, "x-value-" + i);
        return new Response("ok", { headers: h });
      }
      case "/hop-headers":
        return new Response("hi", { headers: { "transfer-encoding": "chunked", connection: "close", "keep-alive": "timeout=5", upgrade: "websocket", "proxy-connection": "x", "x-kept": "1" } });
      case "/empty":
        return new Response("");
      case "/pull-1mb": {
        let i = 0;
        return new Response(new ReadableStream({ async pull(c) { await null; if (i++ < 8) c.enqueue(new Uint8Array(1 << 20).fill(i)); else c.close(); } }));
      }
      case "/big-headers": {
        const n = Number(url.searchParams.get("kb") ?? "12");
        return new Response("x", { headers: { "x-pad": Buffer.alloc(n * 1024, "p").toString() } });
      }
      case "/small":
        return Response.json({ ok: true });
      case "/fixed":
        return new Response(Buffer.alloc(Number(url.searchParams.get("n") ?? "264"), "a"));
      case "/read-report": {
        try { await req.text(); console.error("READ-OK"); } catch { console.error("READ-ERR"); }
        return new Response("x");
      }
      case "/infinite":
        return new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(16384)); }, cancel() { console.error("CANCELLED"); } }));
      case "/ip":
        return Response.json(server.requestIP(req));
      case "/upgrade":
        return new Response(String(server.upgrade(req)), { status: 200 });
      case "/ws":
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400 });
      case "/late-read": {
        // Reads the body only once GET /release-late-read arrives.
        await (lateRead ??= Promise.withResolvers()).promise;
        let n = 0;
        for await (const c of req.body) n += c.length;
        return new Response(String(n));
      }
      case "/release-late-read":
        (lateRead ??= Promise.withResolvers()).resolve();
        lateRead = undefined;
        return new Response("released");
      case "/slow": {
        await Bun.sleep(Number(url.searchParams.get("ms") ?? "50"));
        return new Response("slow");
      }
      case "/abort": {
        const { promise, resolve } = Promise.withResolvers();
        req.signal.addEventListener("abort", () => { console.error("ABORTED"); resolve(); });
        await promise;
        return new Response("unreachable");
      }
      case "/passthrough":
        return new Response(req.body, { headers: { "x-passthrough": "1" } });
      case "/stop":
        setTimeout(() => server.stop(), 0);
        return new Response("stopping");
      case "/reload":
        server.reload({ routes: { ...makeRoutes(), "/reloaded-route": new Response("after-reload") }, fetch: handler, websocket: { message() {} } });
        return new Response("reloaded");
      case "/keepalive": {
        server.timeout(req, 0);
        const { promise, resolve } = Promise.withResolvers();
        req.signal.addEventListener("abort", () => { console.error("KEEPALIVE-ABORTED"); resolve(); });
        setTimeout(resolve, Number(url.searchParams.get("ms")));
        await promise;
        return new Response(req.signal.aborted ? "aborted" : "kept");
      }
    }
    return new Response("not found: " + url.pathname, { status: 404 });
}
console.log(JSON.stringify({ port: server.port }));
process.stdin.on("end", () => { server.stop(true); process.stderr.write("", () => process.exit(0)); });
process.stdin.resume();
`;

type Fixture = {
  port: number;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  stderr: () => string;
  [Symbol.asyncDispose](): Promise<void>;
};

let bigFileDir: ReturnType<typeof tempDir> | undefined;
afterAll(() => bigFileDir?.[Symbol.dispose]());
function bigFilePath() {
  if (!bigFileDir) {
    bigFileDir = tempDir("serve-http2", { "big.bin": Buffer.alloc(3 * 1024 * 1024 + 17, "0123456789") });
  }
  return join(String(bigFileDir), "big.bin");
}

async function startFixture(opts: {
  tls: boolean;
  http1?: boolean;
  http3?: boolean;
  extra?: string;
  idleTimeout?: number;
  execArgv?: string[];
}): Promise<Fixture> {
  const proc = Bun.spawn({
    cmd: [bunExe(), ...(opts.execArgv ?? []), "-e", fixtureSource(opts)],
    env: { ...bunEnv, BIG_FILE: bigFilePath(), IDLE_TIMEOUT: String(opts.idleTimeout ?? 30) },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let stderr = "";
  (async () => {
    for await (const chunk of proc.stderr) stderr += new TextDecoder().decode(chunk);
  })();
  const reader = proc.stdout.getReader();
  let line = "";
  while (!line.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("fixture exited before listening: " + stderr);
    line += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  const { port } = JSON.parse(line.trim());
  return {
    port,
    proc,
    stderr: () => stderr,
    async [Symbol.asyncDispose]() {
      proc.stdin.end();
      await proc.exited;
    },
  };
}

// ─── node:http2 client helpers ──────────────────────────────────────────────

function connectH2(port: number, secure: boolean): Promise<http2.ClientHttp2Session> {
  return new Promise((resolve, reject) => {
    const session = http2.connect(`${secure ? "https" : "http"}://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    });
    session.once("connect", () => resolve(session));
    session.once("error", reject);
  });
}

type H2Result = { status: number; headers: http2.IncomingHttpHeaders; body: Buffer };
function request(
  session: http2.ClientHttp2Session,
  headers: http2.OutgoingHttpHeaders,
  body?: Buffer | string | null,
  opts: { endStream?: boolean } = {},
): Promise<H2Result> {
  return new Promise((resolve, reject) => {
    const req = session.request(headers, { endStream: opts.endStream ?? body == null });
    const chunks: Buffer[] = [];
    let responseHeaders: http2.IncomingHttpHeaders = {};
    req.on("response", h => (responseHeaders = h));
    req.on("data", c => chunks.push(c));
    req.on("end", () =>
      resolve({ status: Number(responseHeaders[":status"]), headers: responseHeaders, body: Buffer.concat(chunks) }),
    );
    req.on("error", reject);
    if (body != null) req.end(body);
  });
}

const sha256 = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

// ─── raw frame client ───────────────────────────────────────────────────────
// For protocol-level assertions node:http2 can't express (malformed frames,
// exact GOAWAY/RST codes, flow-control accounting).

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
const T = {
  DATA: 0,
  HEADERS: 1,
  PRIORITY: 2,
  RST_STREAM: 3,
  SETTINGS: 4,
  PING: 6,
  GOAWAY: 7,
  WINDOW_UPDATE: 8,
  CONTINUATION: 9,
};
const F = { END_STREAM: 1, ACK: 1, END_HEADERS: 4, PADDED: 8, PRIORITY: 0x20 };

function frame(type: number, flags: number, streamId: number, payload: Buffer | Uint8Array = Buffer.alloc(0)) {
  const buf = Buffer.alloc(9 + payload.length);
  buf.writeUIntBE(payload.length, 0, 3);
  buf[3] = type;
  buf[4] = flags;
  buf.writeUInt32BE(streamId & 0x7fffffff, 5);
  Buffer.from(payload).copy(buf, 9);
  return buf;
}

/** HPACK without compression: every field as "literal without indexing, new name". */
function hpackLiteral(headers: [string, string][]) {
  const parts: number[] = [];
  const int = (value: number, prefixBits: number, pattern: number) => {
    const max = (1 << prefixBits) - 1;
    if (value < max) return parts.push(pattern | value);
    parts.push(pattern | max);
    value -= max;
    while (value >= 128) {
      parts.push((value & 0x7f) | 0x80);
      value >>= 7;
    }
    parts.push(value);
  };
  for (const [name, value] of headers) {
    parts.push(0x00);
    const n = Buffer.from(name, "latin1");
    int(n.length, 7, 0);
    parts.push(...n);
    const v = Buffer.from(value, "latin1");
    int(v.length, 7, 0);
    parts.push(...v);
  }
  return Buffer.from(parts);
}

type RawFrame = { type: number; flags: number; streamId: number; payload: Buffer };

class RawH2 {
  socket!: net.Socket | tls.TLSSocket;
  frames: RawFrame[] = [];
  private buf = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  closed = false;

  static async connect(port: number, secure: boolean, opts: { sendPreface?: boolean; settings?: Buffer } = {}) {
    const c = new RawH2();
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      if (secure) {
        c.socket = tls.connect({ port, host: "127.0.0.1", ALPNProtocols: ["h2"], rejectUnauthorized: false }, () =>
          resolve(),
        );
      } else {
        c.socket = net.connect({ port, host: "127.0.0.1" }, () => resolve());
      }
      c.socket.once("error", onErr);
    });
    c.socket.on("data", (d: Buffer) => c.onData(d));
    c.socket.on("close", () => {
      c.closed = true;
      c.wake();
    });
    c.socket.on("error", () => {});
    if (opts.sendPreface ?? true) {
      c.socket.write(PREFACE);
      c.socket.write(frame(T.SETTINGS, 0, 0, opts.settings ?? Buffer.alloc(0)));
    }
    return c;
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 9) {
      const len = this.buf.readUIntBE(0, 3);
      if (this.buf.length < 9 + len) break;
      this.frames.push({
        type: this.buf[3],
        flags: this.buf[4],
        streamId: this.buf.readUInt32BE(5) & 0x7fffffff,
        payload: this.buf.subarray(9, 9 + len),
      });
      this.buf = this.buf.subarray(9 + len);
    }
    this.wake();
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  write(b: Buffer) {
    this.socket.write(b);
  }

  /** Resolve with the first frame matching `pred`, waiting for more data as needed. */
  async waitFor(pred: (f: RawFrame) => boolean): Promise<RawFrame> {
    for (;;) {
      const found = this.frames.find(pred);
      if (found) return found;
      if (this.closed) throw new Error("connection closed before expected frame; got " + this.describe());
      await new Promise<void>(r => this.waiters.push(r));
    }
  }

  async waitForClose() {
    while (!this.closed) await new Promise<void>(r => this.waiters.push(r));
  }

  describe() {
    return JSON.stringify(
      this.frames.map(f => ({ type: f.type, flags: f.flags, id: f.streamId, len: f.payload.length })),
    );
  }

  goaway() {
    return this.waitFor(f => f.type === T.GOAWAY).then(f => ({
      lastStreamId: f.payload.readUInt32BE(0) & 0x7fffffff,
      code: f.payload.readUInt32BE(4),
    }));
  }

  /** All DATA payload for `streamId` once END_STREAM has arrived. */
  async body(streamId: number) {
    await this.waitFor(f => f.type === T.DATA && f.streamId === streamId && (f.flags & F.END_STREAM) !== 0);
    return Buffer.concat(this.frames.filter(f => f.type === T.DATA && f.streamId === streamId).map(f => f.payload));
  }

  rst(streamId: number) {
    return this.waitFor(f => f.type === T.RST_STREAM && f.streamId === streamId).then(f => f.payload.readUInt32BE(0));
  }

  /** HEADERS (+ CONTINUATION when the block exceeds the default 16 KB frame size). */
  headers(streamId: number, fields: [string, string][], flags = F.END_HEADERS | F.END_STREAM) {
    const block = hpackLiteral(fields);
    if (block.length <= 16384) return this.write(frame(T.HEADERS, flags, streamId, block));
    this.write(frame(T.HEADERS, flags & ~F.END_HEADERS, streamId, block.subarray(0, 16384)));
    for (let off = 16384; off < block.length; off += 16384) {
      const last = off + 16384 >= block.length;
      this.write(frame(T.CONTINUATION, last ? F.END_HEADERS : 0, streamId, block.subarray(off, off + 16384)));
    }
  }

  close() {
    this.socket.destroy();
  }
}

const baseHeaders = (path: string, method = "GET"): [string, string][] => [
  [":method", method],
  [":scheme", "https"],
  [":path", path],
  [":authority", "localhost"],
];

/** Just enough HPACK to read the `:status` the server always encodes first:
 * either an indexed static-table entry (200/204/206/304/400/404/500) or a
 * literal with indexed name whose 3-digit value may be Huffman-coded. */
function decodeStatus(block: Buffer): number {
  const b = block[0];
  const map: Record<number, number> = { 0x88: 200, 0x89: 204, 0x8a: 206, 0x8b: 304, 0x8c: 400, 0x8d: 404, 0x8e: 500 };
  if (map[b] !== undefined) return map[b];
  const huff = (block[1] & 0x80) !== 0;
  const len = block[1] & 0x7f;
  const value = block.subarray(2, 2 + len);
  if (!huff) return Number(value.toString("latin1"));
  // HPACK Huffman codes for '0'..'9' (RFC 7541 Appendix B).
  const codes: Record<string, string> = {
    "00000": "0",
    "00001": "1",
    "00010": "2",
    "011001": "3",
    "011010": "4",
    "011011": "5",
    "011100": "6",
    "011101": "7",
    "011110": "8",
    "011111": "9",
  };
  let bits = "";
  for (const byte of value) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  while (out.length < 3) {
    const code = Object.keys(codes).find(c => bits.startsWith(c));
    if (!code) throw new Error("test decoder: unexpected huffman symbol in :status");
    out += codes[code];
    bits = bits.slice(code.length);
  }
  return Number(out);
}

// ─── tests ──────────────────────────────────────────────────────────────────

for (const secure of [true, false]) {
  describe(`Bun.serve http2 (${secure ? "TLS + ALPN" : "cleartext prior-knowledge"})`, () => {
    let fx: Fixture;
    let session: http2.ClientHttp2Session;

    beforeAll(async () => {
      fx = await startFixture({ tls: secure });
      session = await connectH2(fx.port, secure);
    });
    afterAll(async () => {
      session.close();
      await fx[Symbol.asyncDispose]();
      if (fx.proc.exitCode !== 0) console.error(fx.stderr());
      expect(fx.proc.signalCode).toBeNull();
      expect(fx.proc.exitCode).toBe(0);
    });

    if (secure) {
      test("ALPN negotiated h2", () => {
        expect((session.socket as tls.TLSSocket).alpnProtocol).toBe("h2");
      });
    }

    test("GET through fetch handler", async () => {
      const res = await request(session, { ":path": "/hello" });
      expect(res.status).toBe(200);
      expect(res.headers["x-proto"]).toBe("h2");
      expect(res.headers["content-type"]).toBe("text/plain");
      expect(res.headers["content-length"]).toBe("5");
      expect(res.headers["date"]).toBeString();
      expect(res.body.toString()).toBe("hello");
    });

    test("POST body is echoed with status and request headers", async () => {
      const res = await request(session, { ":path": "/echo", ":method": "POST", "x-echo": "abc" }, "payload-123");
      expect(res.status).toBe(201);
      expect(res.headers["x-method"]).toBe("POST");
      expect(res.headers["x-echo"]).toBe("abc");
      expect(res.headers["x-len"]).toBe("11");
      expect(res.body.toString()).toBe("payload-123");
    });

    test("POST with END_STREAM on HEADERS (no body) resolves req.text()", async () => {
      const res = await request(session, { ":path": "/echo", ":method": "POST" }, null, { endStream: true });
      expect(res.status).toBe(201);
      expect(res.headers["x-len"]).toBe("0");
    });

    test("204 has no body", async () => {
      const res = await request(session, { ":path": "/status/204" });
      expect(res.status).toBe(204);
      expect(res.headers["x-empty"]).toBe("1");
      expect(res.body.length).toBe(0);
    });

    test("HEAD returns content-length and no body", async () => {
      const res = await request(session, { ":path": "/big", ":method": "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers["content-length"]).toBe(String(5 * 1024 * 1024));
      expect(res.body.length).toBe(0);
    });

    test("unknown route is 404 from fetch", async () => {
      const res = await request(session, { ":path": "/nope" });
      expect(res.status).toBe(404);
      expect(res.body.toString()).toBe("not found: /nope");
    });

    test("routes: params, per-method, static Response, file route", async () => {
      const api = await request(session, { ":path": "/api/42" });
      expect(api.status).toBe(200);
      expect(api.headers["x-route"]).toBe("api");
      expect(api.body.toString()).toBe("id=42");

      const wrongMethod = await request(session, { ":path": "/route-only" });
      expect(wrongMethod.status).toBe(404);
      const posted = await request(session, { ":path": "/route-only", ":method": "POST" }, "x");
      expect(posted.body.toString()).toBe("posted");

      const st = await request(session, { ":path": "/static" });
      expect(st.status).toBe(200);
      expect(st.headers["etag"]).toBe('"v1"');
      expect(st.body.toString()).toBe("from-static-route");

      const notModified = await request(session, { ":path": "/static", "if-none-match": '"v1"' });
      expect(notModified.status).toBe(304);
      expect(notModified.body.length).toBe(0);

      const file = await request(session, { ":path": "/file-route" });
      expect(file.status).toBe(200);
      expect(file.headers["content-length"]).toBe(String(3 * 1024 * 1024 + 17));
      expect(file.body.length).toBe(3 * 1024 * 1024 + 17);
      expect(sha256(file.body)).toBe(sha256(Buffer.alloc(3 * 1024 * 1024 + 17, "0123456789")));

      const ranged = await request(session, { ":path": "/file-route", range: "bytes=10-19" });
      expect(ranged.status).toBe(206);
      expect(ranged.body.toString()).toBe("0123456789");
    });

    test("request url and headers reach the handler; :authority becomes host", async () => {
      const res = await request(session, {
        ":path": "/headers?x=1",
        ":authority": "example.test:9",
        "x-a": "1",
        "x-long": Buffer.alloc(6000, "L").toString(),
        cookie: "k=v",
      });
      const json = JSON.parse(res.body.toString());
      expect(json.url).toBe(`${secure ? "https" : "http"}://example.test:9/headers?x=1`);
      expect(json.method).toBe("GET");
      expect(json.headers["x-a"]).toBe("1");
      expect(json.headers["x-long"]).toHaveLength(6000);
      expect(json.headers["host"]).toBe("example.test:9");
      expect(json.headers["cookie"]).toBe("k=v");
    });

    test("split cookie fields are joined with '; '", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      raw.headers(1, [...baseHeaders("/headers"), ["cookie", "a=1"], ["cookie", "b=2"]]);
      const data = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1);
      expect(JSON.parse(data.payload.toString()).headers.cookie).toBe("a=1; b=2");
      raw.close();
    });

    test("multi-value response headers and set-cookie", async () => {
      const res = await request(session, { ":path": "/set-cookies" });
      expect(res.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
      expect(res.headers["x-multi"]).toBe("1, 2");
      const viaCookieMap = await request(session, { ":path": "/cookies", cookie: "seen=xx" });
      expect(viaCookieMap.headers["set-cookie"]).toEqual(["seen=xxx; Path=/; SameSite=Lax"]);
    });

    test("5 MB response body (flow control + socket backpressure)", async () => {
      const res = await request(session, { ":path": "/big" });
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(5 * 1024 * 1024);
      expect(res.body.subarray(0, 16).toString()).toBe("abcdefghijklmnop");
      expect(sha256(res.body)).toBe(sha256(Buffer.alloc(5 * 1024 * 1024, "abcdefghijklmnop")));
    });

    test("2 MB request body streamed to the handler (WINDOW_UPDATE path)", async () => {
      const body = randomBytes(2 * 1024 * 1024);
      const res = await request(session, { ":path": "/digest", ":method": "POST" }, body);
      expect(res.status).toBe(200);
      expect(res.headers["x-len"]).toBe(String(body.length));
      expect(res.body.toString()).toBe(sha256(body));
    });

    test("request body without content-length", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
      raw.write(frame(T.DATA, 0, 1, Buffer.from("part1-")));
      raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("part2")));
      const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
      expect(decodeStatus(h.payload)).toBe(201);
      const d = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 0);
      expect(d.payload.toString()).toBe("part1-part2");
      raw.close();
    });

    test("pseudo-header in request trailers → RST_STREAM PROTOCOL_ERROR", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
      raw.write(frame(T.DATA, 0, 1, Buffer.from("body")));
      raw.headers(1, [[":path", "/x"]], F.END_HEADERS | F.END_STREAM);
      expect(await raw.rst(1)).toBe(1);
      raw.close();
    });

    test("request trailers end the body", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
      raw.write(frame(T.DATA, 0, 1, Buffer.from("body")));
      raw.headers(1, [["x-trailer", "t"]], F.END_HEADERS | F.END_STREAM);
      const d = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 0);
      expect(d.payload.toString()).toBe("body");
      raw.close();
    });

    test("padded HEADERS and DATA, PRIORITY flag", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      const block = hpackLiteral(baseHeaders("/echo", "POST"));
      // PADDED + PRIORITY: [padLen][streamDep(4)][weight][block][padding]
      const hp = Buffer.concat([Buffer.from([3]), Buffer.from([0, 0, 0, 0, 15]), block, Buffer.alloc(3)]);
      raw.write(frame(T.HEADERS, F.END_HEADERS | F.PADDED | F.PRIORITY, 1, hp));
      const dp = Buffer.concat([Buffer.from([5]), Buffer.from("padded-body"), Buffer.alloc(5)]);
      raw.write(frame(T.DATA, F.END_STREAM | F.PADDED, 1, dp));
      const d = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 0);
      expect(d.payload.toString()).toBe("padded-body");
      raw.close();
    });

    test("CONTINUATION frames are reassembled", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      // 12 KB header (under the 16 KB default list limit) split 4K/4K/rest.
      const block = hpackLiteral([...baseHeaders("/headers"), ["x-big", Buffer.alloc(12000, "B").toString()]]);
      raw.write(frame(T.HEADERS, 0, 1, block.subarray(0, 4000)));
      raw.write(frame(T.CONTINUATION, 0, 1, block.subarray(4000, 8000)));
      raw.write(frame(T.CONTINUATION, F.END_HEADERS, 1, block.subarray(8000)));
      // No END_STREAM on HEADERS; finish the (empty) body.
      raw.write(frame(T.DATA, F.END_STREAM, 1));
      expect(JSON.parse((await raw.body(1)).toString()).headers["x-big"]).toHaveLength(12000);
      raw.close();
    });

    test("ReadableStream response", async () => {
      const res = await request(session, { ":path": "/stream" });
      expect(res.status).toBe(200);
      // 64 chunks of "chunk" + i + 1019×";"
      expect(res.body.length).toBe(64 * 1024 + 9 * 1 + 55 * 2);
      expect(res.body.subarray(0, 7).toString()).toBe("chunk1;");
    });

    test("Bun.file response via fetch handler, and via .stream()", async () => {
      const expected = sha256(Buffer.alloc(3 * 1024 * 1024 + 17, "0123456789"));
      const a = await request(session, { ":path": "/file" });
      expect(a.headers["content-length"]).toBe(String(3 * 1024 * 1024 + 17));
      expect(sha256(a.body)).toBe(expected);
      const b = await request(session, { ":path": "/file-stream" });
      expect(sha256(b.body)).toBe(expected);
    });

    test("Response(req.body) passthrough", async () => {
      const body = randomBytes(300 * 1024);
      const res = await request(session, { ":path": "/passthrough", ":method": "POST" }, body);
      expect(res.headers["x-passthrough"]).toBe("1");
      expect(sha256(res.body)).toBe(sha256(body));
    });

    test("100 concurrent streams on one connection", async () => {
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          request(session, { ":path": "/echo", ":method": "POST", "x-echo": String(i) }, "body-" + i),
        ),
      );
      for (let i = 0; i < 100; i++) {
        expect(results[i].headers["x-echo"]).toBe(String(i));
        expect(results[i].body.toString()).toBe("body-" + i);
      }
    });

    test("8 concurrent large downloads on one connection are byte-exact", async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => request(session, { ":path": "/big" })));
      const expected = sha256(Buffer.alloc(5 * 1024 * 1024, "abcdefghijklmnop"));
      for (const r of results) expect(sha256(r.body)).toBe(expected);
    });

    test("expect: 100-continue gets an interim response", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS);
      raw.headers(1, [...baseHeaders("/echo", "POST"), ["expect", "100-continue"]], F.END_HEADERS);
      const interim = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
      expect(decodeStatus(interim.payload)).toBe(100);
      expect(interim.flags & F.END_STREAM).toBe(0);
      raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("after-continue")));
      const d = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && f.payload.length > 0);
      expect(d.payload.toString()).toBe("after-continue");
      raw.close();
    });

    test("server.requestIP works", async () => {
      const res = await request(session, { ":path": "/ip" });
      const ip = JSON.parse(res.body.toString());
      expect(["127.0.0.1", "::ffff:127.0.0.1", "::1"]).toContain(ip.address);
      expect(ip.port).toBeGreaterThan(0);
    });

    test("server.upgrade() returns false", async () => {
      const res = await request(session, {
        ":path": "/upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      });
      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe("false");
    });

    test("client RST_STREAM fires req.signal and leaves the connection usable", async () => {
      const before = (fx.stderr().match(/ABORTED/g) ?? []).length;
      const req = session.request({ ":path": "/abort" });
      req.on("error", () => {});
      // A round trip on the same connection: HEADERS for /abort has reached the server.
      await request(session, { ":path": "/hello" });
      req.close(http2.constants.NGHTTP2_CANCEL);
      while ((fx.stderr().match(/ABORTED/g) ?? []).length === before) {
        await request(session, { ":path": "/hello" });
      }
      const ok = await request(session, { ":path": "/hello" });
      expect(ok.body.toString()).toBe("hello");
    });

    test("PING is answered", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      raw.write(frame(T.PING, 0, 0, Buffer.from("pingpong")));
      const pong = await raw.waitFor(f => f.type === T.PING && (f.flags & F.ACK) !== 0);
      expect(pong.payload.toString()).toBe("pingpong");
      raw.close();
    });

    test("server SETTINGS and SETTINGS ACK", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      const settings = await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) === 0);
      const map = new Map<number, number>();
      for (let i = 0; i + 6 <= settings.payload.length; i += 6) {
        map.set(settings.payload.readUInt16BE(i), settings.payload.readUInt32BE(i + 2));
      }
      expect(map.get(3)).toBeGreaterThanOrEqual(100); // MAX_CONCURRENT_STREAMS
      expect(map.get(4)).toBeGreaterThanOrEqual(65535); // INITIAL_WINDOW_SIZE
      expect(map.get(5)).toBeGreaterThanOrEqual(16384); // MAX_FRAME_SIZE
      expect(map.get(6)).toBeGreaterThan(0); // MAX_HEADER_LIST_SIZE advertised
      expect(map.get(8) ?? 0).toBe(0); // no extended CONNECT
      await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
      // The connection window is widened right after SETTINGS; a 1 MiB upload
      // in 16 KB frames needs no further connection-level credit.
      const wu = await raw.waitFor(f => f.type === T.WINDOW_UPDATE && f.streamId === 0);
      expect(65535 + wu.payload.readUInt32BE(0)).toBeGreaterThanOrEqual(1 << 20);
      raw.headers(1, baseHeaders("/digest", "POST"), F.END_HEADERS);
      const chunk = Buffer.alloc(16384, 7);
      for (let i = 0; i < 63; i++) raw.write(frame(T.DATA, 0, 1, chunk));
      raw.write(frame(T.DATA, F.END_STREAM, 1, chunk));
      expect((await raw.body(1)).toString()).toBe(
        new Bun.CryptoHasher("sha256").update(Buffer.alloc(1 << 20, 7)).digest("hex"),
      );
      raw.close();
    });

    test("request body: stream window stays at the initial 64 KB until the handler reads, then opens", async () => {
      const raw = await RawH2.connect(fx.port, secure);
      await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
      raw.headers(1, [...baseHeaders("/late-read", "POST"), ["content-length", String(1 << 20)]], F.END_HEADERS);
      // Fill exactly the advertised 64 KB stream window.
      for (let i = 0; i < 4; i++) raw.write(frame(T.DATA, 0, 1, Buffer.alloc(16384, 1)));
      raw.write(frame(T.PING, 0, 0, Buffer.from("windowed")));
      await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "windowed");
      // Handler hasn't touched req.body yet: no stream-level WINDOW_UPDATE.
      expect(raw.frames.some(f => f.type === T.WINDOW_UPDATE && f.streamId === 1)).toBe(false);
      // Let the handler start reading; the window opens and the rest of the body is accepted.
      raw.headers(3, baseHeaders("/release-late-read"));
      expect((await raw.body(3)).toString()).toBe("released");
      const wu = await raw.waitFor(f => f.type === T.WINDOW_UPDATE && f.streamId === 1);
      expect(wu.payload.readUInt32BE(0)).toBeGreaterThanOrEqual((1 << 20) - 65536);
      for (let sent = 65536; sent < 1 << 20; sent += 16384) {
        raw.write(frame(T.DATA, sent + 16384 >= 1 << 20 ? F.END_STREAM : 0, 1, Buffer.alloc(16384, 1)));
      }
      expect((await raw.body(1)).toString()).toBe(String(1 << 20));
      raw.close();
    });

    test("response respects a small peer INITIAL_WINDOW_SIZE", async () => {
      const settings = Buffer.alloc(6);
      settings.writeUInt16BE(4, 0);
      settings.writeUInt32BE(1024, 2);
      const raw = await RawH2.connect(fx.port, secure, { settings });
      await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
      raw.headers(1, baseHeaders("/big"));
      await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
      // Give the server a chance to (wrongly) overrun the window.
      await raw.waitFor(f => f.type === T.DATA && f.streamId === 1);
      raw.write(frame(T.PING, 0, 0, Buffer.from("12345678")));
      await raw.waitFor(f => f.type === T.PING);
      const received = () =>
        raw.frames.filter(f => f.type === T.DATA && f.streamId === 1).reduce((a, f) => a + f.payload.length, 0);
      expect(received()).toBe(1024);
      // Open the stream window; the connection window (65535) becomes the limit.
      const inc = Buffer.alloc(4);
      inc.writeUInt32BE(10 * 1024 * 1024, 0);
      raw.write(frame(T.WINDOW_UPDATE, 0, 1, inc));
      raw.write(frame(T.PING, 0, 0, Buffer.from("abcdefgh")));
      await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "abcdefgh");
      while (received() < 65535) await raw.waitFor(f => f.type === T.DATA && received() >= 65535);
      expect(received()).toBe(65535);
      // Now open the connection window and drain the rest.
      raw.write(frame(T.WINDOW_UPDATE, 0, 0, inc));
      await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
      expect(received()).toBe(5 * 1024 * 1024);
      for (const f of raw.frames) if (f.type === T.DATA) expect(f.payload.length).toBeLessThanOrEqual(16384);
      raw.close();
    });

    describe("protocol errors", () => {
      test("bad preface closes the connection", async () => {
        const raw = await RawH2.connect(fx.port, secure, { sendPreface: false });
        raw.write(Buffer.from("PRI * HTTP/2.0\r\n\r\nXX\r\n\r\n"));
        raw.write(frame(T.SETTINGS, 0, 0));
        await raw.waitForClose();
        // and the server is still fine
        expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
      });

      test("first frame not SETTINGS → GOAWAY PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure, { sendPreface: false });
        raw.write(PREFACE);
        raw.write(frame(T.PING, 0, 0, Buffer.alloc(8)));
        expect((await raw.goaway()).code).toBe(1);
        raw.close();
      });

      test("SETTINGS with bad length → GOAWAY FRAME_SIZE_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure, { sendPreface: false });
        raw.write(PREFACE);
        raw.write(frame(T.SETTINGS, 0, 0, Buffer.alloc(5)));
        expect((await raw.goaway()).code).toBe(6);
        raw.close();
      });

      test("oversized frame → GOAWAY FRAME_SIZE_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.write(frame(T.DATA, 0, 1, Buffer.alloc(16385)));
        expect((await raw.goaway()).code).toBe(6);
        raw.close();
      });

      test("WINDOW_UPDATE of 0 on the connection → GOAWAY PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.write(frame(T.WINDOW_UPDATE, 0, 0, Buffer.alloc(4)));
        expect((await raw.goaway()).code).toBe(1);
        raw.close();
      });

      test("connection WINDOW_UPDATE overflow → GOAWAY FLOW_CONTROL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        const inc = Buffer.alloc(4);
        inc.writeUInt32BE(0x7fffffff, 0);
        raw.write(frame(T.WINDOW_UPDATE, 0, 0, inc));
        expect((await raw.goaway()).code).toBe(3);
        raw.close();
      });

      test("even stream id → GOAWAY PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(2, baseHeaders("/hello"));
        expect((await raw.goaway()).code).toBe(1);
        raw.close();
      });

      test("HEADERS interleaved before CONTINUATION → GOAWAY PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.write(frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello"))));
        raw.write(frame(T.PING, 0, 0, Buffer.alloc(8)));
        expect((await raw.goaway()).code).toBe(1);
        raw.close();
      });

      test("PUSH_PROMISE from client → GOAWAY PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.write(frame(5, F.END_HEADERS, 1, Buffer.concat([Buffer.alloc(4), hpackLiteral(baseHeaders("/x"))])));
        expect((await raw.goaway()).code).toBe(1);
        raw.close();
      });

      test("invalid HPACK → GOAWAY COMPRESSION_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        // Indexed field with index 127+ (way past the table) is a decoding error.
        raw.write(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, Buffer.from([0xff, 0xff, 0x7f])));
        expect((await raw.goaway()).code).toBe(9);
        raw.close();
      });

      for (const [name, fields] of [
        [
          "missing :path",
          [
            [":method", "GET"],
            [":scheme", "https"],
          ],
        ],
        ["unknown pseudo-header", [...baseHeaders("/hello"), [":foo", "bar"]]],
        [
          "pseudo-header after regular",
          [
            [":method", "GET"],
            ["x-a", "1"],
            [":scheme", "https"],
            [":path", "/hello"],
          ],
        ],
        ["duplicate :method", [...baseHeaders("/hello"), [":method", "GET"]]],
        ["uppercase field name", [...baseHeaders("/hello"), ["X-Upper", "1"]]],
        ["connection header", [...baseHeaders("/hello"), ["connection", "keep-alive"]]],
        ["te: gzip", [...baseHeaders("/hello"), ["te", "gzip"]]],
        ["transfer-encoding header", [...baseHeaders("/hello"), ["transfer-encoding", "chunked"]]],
        ["host differs from :authority", [...baseHeaders("/hello"), ["host", "elsewhere"]]],
        [
          ":authority with userinfo",
          [
            [":method", "GET"],
            [":scheme", "https"],
            [":path", "/hello"],
            [":authority", "user@localhost"],
          ],
        ],
        [
          "omitted :method",
          [
            [":scheme", "https"],
            [":path", "/hello"],
            [":authority", "localhost"],
          ],
        ],
        [
          "omitted :scheme",
          [
            [":method", "GET"],
            [":path", "/hello"],
            [":authority", "localhost"],
          ],
        ],
        [
          "empty :method",
          [
            [":method", ""],
            [":scheme", "https"],
            [":path", "/hello"],
            [":authority", "localhost"],
          ],
        ],
        ["duplicate :scheme", [...baseHeaders("/hello"), [":scheme", "https"]]],
        ["duplicate :path", [...baseHeaders("/hello"), [":path", "/hello"]]],
        ["upgrade header", [...baseHeaders("/hello"), ["upgrade", "x"]]],
        ["keep-alive header", [...baseHeaders("/hello"), ["keep-alive", "x"]]],
        ["proxy-connection header", [...baseHeaders("/hello"), ["proxy-connection", "x"]]],
        ["te: trailers, deflate", [...baseHeaders("/hello"), ["te", "trailers, deflate"]]],
        ["field name with colon", [...baseHeaders("/hello"), ["has:colon", "x"]]],
        ["field name with NUL", [...baseHeaders("/hello"), ["has\0nul", "x"]]],
        ["field value with LF", [...baseHeaders("/hello"), ["x-v", "a\nb"]]],
        ["field value with CR", [...baseHeaders("/hello"), ["x-v", "a\rb"]]],
        ["field value with NUL", [...baseHeaders("/hello"), ["x-v", "a\0b"]]],
        ["content-length +3", [...baseHeaders("/echo", "POST"), ["content-length", "+3"]]],
        ["content-length -3", [...baseHeaders("/echo", "POST"), ["content-length", "-3"]]],
        ["content-length abc", [...baseHeaders("/echo", "POST"), ["content-length", "abc"]]],
        ["content-length 2^63", [...baseHeaders("/echo", "POST"), ["content-length", "9223372036854775808"]]],
        [
          "duplicate content-length",
          [...baseHeaders("/echo", "POST"), ["content-length", "5"], ["content-length", "5"]],
        ],
        ["content-length > 0 with END_STREAM", [...baseHeaders("/echo", "POST"), ["content-length", "5"]]],
        [
          "CONNECT with :path",
          [
            [":method", "CONNECT"],
            [":authority", "example.com:443"],
            [":path", "/"],
          ],
        ],
        [
          "CONNECT with :scheme",
          [
            [":method", "CONNECT"],
            [":authority", "example.com:443"],
            [":scheme", "https"],
          ],
        ],
        [":protocol without extended CONNECT", [...baseHeaders("/hello"), [":protocol", "websocket"]]],
        [
          ":path without leading slash",
          [
            [":method", "GET"],
            [":scheme", "https"],
            [":path", "hello"],
            [":authority", "localhost"],
          ],
        ],
        [
          ":path that would alias a route after its first byte",
          [
            [":method", "GET"],
            [":scheme", "https"],
            [":path", "xapi/1"],
            [":authority", "localhost"],
          ],
        ],
        [
          ":path * with GET",
          [
            [":method", "GET"],
            [":scheme", "https"],
            [":path", "*"],
            [":authority", "localhost"],
          ],
        ],
        [
          "absolute-form :path",
          [
            [":method", "GET"],
            [":scheme", "https"],
            [":path", "https://localhost/hello"],
            [":authority", "localhost"],
          ],
        ],
        [
          "no :authority and no host",
          [
            [":method", "GET"],
            [":scheme", "https"],
            [":path", "/hello"],
          ],
        ],
        [
          "empty :path",
          [
            [":method", "GET"],
            [":scheme", "https"],
            [":path", ""],
          ],
        ],
        ["response pseudo-header", [...baseHeaders("/hello"), [":status", "200"]]],
      ] as [string, [string, string][]][]) {
        test(`malformed request (${name}) → RST_STREAM PROTOCOL_ERROR, connection survives`, async () => {
          const raw = await RawH2.connect(fx.port, secure);
          raw.headers(1, fields);
          expect(await raw.rst(1)).toBe(1);
          // HPACK state stayed in sync: a following valid request works.
          raw.headers(3, baseHeaders("/hello"));
          const d = await raw.waitFor(f => f.type === T.DATA && f.streamId === 3);
          expect(d.payload.toString()).toBe("hello");
          raw.close();
        });
      }

      // ── frame-format checks (h2spec §4–6, hyper frame::*::load, Go TestServer_Rejects_*) ──
      const u32 = (n: number) => {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(n >>> 0);
        return b;
      };
      const setting = (id: number, v: number) => {
        const b = Buffer.alloc(6);
        b.writeUInt16BE(id);
        b.writeUInt32BE(v >>> 0, 2);
        return b;
      };
      for (const [name, build, code] of [
        ["DATA on stream 0", () => frame(T.DATA, F.END_STREAM, 0, Buffer.from("x")), 1],
        [
          "HEADERS on stream 0",
          () => frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 0, hpackLiteral(baseHeaders("/hello"))),
          1,
        ],
        [
          "HEADERS larger than max frame size",
          () => frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, Buffer.alloc(16385)),
          6,
        ],
        [
          "HEADERS with PRIORITY flag but < 5 bytes",
          () => frame(T.HEADERS, F.END_HEADERS | F.PRIORITY, 1, Buffer.from([0, 0, 1])),
          1,
        ],
        [
          "HEADERS PADDED+PRIORITY, pad exceeds remainder",
          () => frame(T.HEADERS, F.END_HEADERS | F.PADDED | F.PRIORITY, 1, Buffer.from([6, 0, 0, 0, 0, 16, 1, 2, 3])),
          1,
        ],
        [
          "DATA PADDED with empty payload",
          () =>
            Buffer.concat([
              frame(T.HEADERS, F.END_HEADERS, 1, hpackLiteral(baseHeaders("/echo", "POST"))),
              frame(T.DATA, F.PADDED, 1, Buffer.alloc(0)),
            ]),
          1,
        ],
        ["PRIORITY on stream 0", () => frame(T.PRIORITY, 0, 0, Buffer.from([0, 0, 0, 1, 0])), 1],
        ["RST_STREAM on stream 0", () => frame(T.RST_STREAM, 0, 0, u32(8)), 1],
        ["RST_STREAM on an idle stream", () => frame(T.RST_STREAM, 0, 99, u32(8)), 1],
        [
          "RST_STREAM length 3",
          () =>
            Buffer.concat([
              frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, hpackLiteral(baseHeaders("/slow?ms=500"))),
              frame(T.RST_STREAM, 0, 1, Buffer.alloc(3)),
            ]),
          6,
        ],
        ["WINDOW_UPDATE on an odd idle stream", () => frame(T.WINDOW_UPDATE, 0, 99, u32(100)), 1],
        ["WINDOW_UPDATE length 3", () => frame(T.WINDOW_UPDATE, 0, 0, Buffer.alloc(3)), 6],
        ["SETTINGS on stream 1", () => frame(T.SETTINGS, 0, 1, setting(3, 100)), 1],
        ["SETTINGS ACK with payload", () => frame(T.SETTINGS, F.ACK, 0, Buffer.alloc(1)), 6],
        ["SETTINGS ENABLE_PUSH=2", () => frame(T.SETTINGS, 0, 0, setting(2, 2)), 1],
        ["SETTINGS MAX_FRAME_SIZE=16383", () => frame(T.SETTINGS, 0, 0, setting(5, 16383)), 1],
        ["SETTINGS MAX_FRAME_SIZE=2^24", () => frame(T.SETTINGS, 0, 0, setting(5, 1 << 24)), 1],
        ["PING on stream 1", () => frame(T.PING, 0, 1, Buffer.alloc(8)), 1],
        ["PING length 6", () => frame(T.PING, 0, 0, Buffer.alloc(6)), 6],
        ["GOAWAY on stream 1", () => frame(T.GOAWAY, 0, 1, Buffer.alloc(8)), 1],
        ["GOAWAY length 7", () => frame(T.GOAWAY, 0, 0, Buffer.alloc(7)), 6],
        [
          "CONTINUATION with no header block in progress",
          () => frame(T.CONTINUATION, F.END_HEADERS, 1, hpackLiteral(baseHeaders("/hello"))),
          1,
        ],
        [
          "CONTINUATION on stream 0",
          () =>
            Buffer.concat([
              frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello"))),
              frame(T.CONTINUATION, F.END_HEADERS, 0, hpackLiteral([["x", "y"]])),
            ]),
          1,
        ],
        [
          "CONTINUATION on a different stream",
          () =>
            Buffer.concat([
              frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello"))),
              frame(T.CONTINUATION, F.END_HEADERS, 3, hpackLiteral([["x", "y"]])),
            ]),
          1,
        ],
        [
          "CONTINUATION after END_HEADERS",
          () =>
            Buffer.concat([
              frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, hpackLiteral(baseHeaders("/slow?ms=500"))),
              frame(T.CONTINUATION, F.END_HEADERS, 1, hpackLiteral([["x", "y"]])),
            ]),
          1,
        ],
        [
          "truncated HPACK literal",
          () => {
            const b = hpackLiteral(baseHeaders("/hello"));
            return frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, b.subarray(0, b.length - 1));
          },
          9,
        ],
        [
          "HPACK literal with out-of-range name index",
          () =>
            frame(
              T.HEADERS,
              F.END_HEADERS | F.END_STREAM,
              1,
              Buffer.concat([hpackLiteral(baseHeaders("/hello")), Buffer.from([0x7f, 7, 0])]),
            ),
          9,
        ],
        [
          "HPACK indexed field 0",
          () =>
            frame(
              T.HEADERS,
              F.END_HEADERS | F.END_STREAM,
              1,
              Buffer.concat([hpackLiteral(baseHeaders("/hello")), Buffer.from([0x80])]),
            ),
          9,
        ],
        [
          "HPACK table size update after a field",
          () =>
            frame(
              T.HEADERS,
              F.END_HEADERS | F.END_STREAM,
              1,
              Buffer.concat([hpackLiteral(baseHeaders("/hello")), Buffer.from([0x21])]),
            ),
          9,
        ],
        [
          "HPACK table size update above SETTINGS_HEADER_TABLE_SIZE",
          () =>
            frame(
              T.HEADERS,
              F.END_HEADERS | F.END_STREAM,
              1,
              Buffer.concat([Buffer.from([0x3f, 0xe2, 0x1f]), hpackLiteral(baseHeaders("/hello"))]),
            ),
          9,
        ],
        [
          "HPACK huffman with EOS symbol",
          () =>
            frame(
              T.HEADERS,
              F.END_HEADERS | F.END_STREAM,
              1,
              Buffer.concat([
                hpackLiteral(baseHeaders("/hello")),
                Buffer.from([0x00, 0x85, 0xf2, 0xb2, 0x4a, 0x84, 0xff, 0x87, 0x49, 0x51, 0xff, 0xff, 0xff, 0xfa, 0x7f]),
              ]),
            ),
          9,
        ],
        [
          "HPACK huffman padding longer than 7 bits",
          () =>
            frame(
              T.HEADERS,
              F.END_HEADERS | F.END_STREAM,
              1,
              Buffer.concat([
                hpackLiteral(baseHeaders("/hello")),
                Buffer.from([0x00, 0x85, 0xf2, 0xb2, 0x4a, 0x84, 0xff, 0x84, 0x49, 0x50, 0x9f, 0xff]),
              ]),
            ),
          9,
        ],
        [
          "HPACK huffman padded with zeros",
          () =>
            frame(
              T.HEADERS,
              F.END_HEADERS | F.END_STREAM,
              1,
              Buffer.concat([
                hpackLiteral(baseHeaders("/hello")),
                Buffer.from([0x00, 0x85, 0xf2, 0xb2, 0x4a, 0x84, 0xff, 0x83, 0x49, 0x50, 0x90]),
              ]),
            ),
          9,
        ],
      ] as const) {
        test(`${name} → GOAWAY ${code}`, async () => {
          const raw = await RawH2.connect(fx.port, secure);
          await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
          raw.write(build());
          expect((await raw.goaway()).code).toBe(code);
          raw.close();
        });
      }

      for (const [name, mid] of [
        ["PRIORITY", () => frame(T.PRIORITY, 0, 1, Buffer.from([0, 0, 0, 0, 15]))],
        [
          "HEADERS on another stream",
          () => frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 3, hpackLiteral(baseHeaders("/hello"))),
        ],
        ["DATA", () => frame(T.DATA, 0, 1, Buffer.from("x"))],
        ["unknown frame type", () => frame(0x16, 0, 0, Buffer.alloc(8))],
        [
          "CONTINUATION then DATA",
          () =>
            Buffer.concat([
              frame(T.CONTINUATION, 0, 1, hpackLiteral([["x", "y"]])),
              frame(T.DATA, 0, 1, Buffer.from("x")),
            ]),
        ],
      ] as const) {
        test(`${name} inside a header block → GOAWAY PROTOCOL_ERROR`, async () => {
          const raw = await RawH2.connect(fx.port, secure);
          raw.write(
            Buffer.concat([
              frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello"))),
              mid(),
              frame(T.CONTINUATION, F.END_HEADERS | F.END_STREAM, 1, hpackLiteral([["a", "b"]])),
            ]),
          );
          expect((await raw.goaway()).code).toBe(1);
          raw.close();
        });
      }

      test("CONTINUATION after a CONTINUATION with END_HEADERS → GOAWAY PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.write(
          Buffer.concat([
            frame(T.HEADERS, F.END_STREAM, 1, hpackLiteral(baseHeaders("/slow?ms=500"))),
            frame(T.CONTINUATION, F.END_HEADERS, 1, hpackLiteral([["a", "b"]])),
            frame(T.CONTINUATION, F.END_HEADERS, 1, hpackLiteral([["c", "d"]])),
          ]),
        );
        expect((await raw.goaway()).code).toBe(1);
        raw.close();
      });

      test("frames the server must ignore keep the connection usable", async () => {
        const raw = await RawH2.connect(fx.port, secure, {
          settings: Buffer.concat([setting(0xff, 1), setting(8, 1), setting(2, 0), setting(5, (1 << 24) - 1)]),
        });
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        const hdr = Buffer.alloc(9); // PING with a reserved bit set in the stream id
        hdr.writeUIntBE(8, 0, 3);
        hdr[3] = T.PING;
        hdr[4] = 0;
        hdr.writeUInt32BE(0x80000000, 5);
        raw.write(
          Buffer.concat([
            frame(0x16, 0, 0, Buffer.alloc(8)), // unknown type, stream 0
            frame(0x87, 0xc1, 257, Buffer.alloc(5)), // unknown type, odd flags, some stream
            frame(T.PING, 0x16, 0, Buffer.from("flagflag")), // undefined flags on PING
            Buffer.concat([hdr, Buffer.from("reserved")]),
            frame(T.PRIORITY, 0, 7, Buffer.from([0, 0, 0, 0, 200])), // PRIORITY on an idle stream is allowed
            frame(T.PRIORITY, 0, 9, Buffer.from([0x80, 0, 0, 0, 0])), // exclusive, weight 1
            frame(T.PING, F.ACK, 0, Buffer.from("unsolic.")), // unsolicited PING ACK is not echoed
            frame(T.SETTINGS, F.ACK, 0), // unsolicited SETTINGS ACK
            frame(T.PING, 0, 0, Buffer.from("pingpong")),
          ]),
        );
        const pong = await raw.waitFor(f => f.type === T.PING && (f.flags & F.ACK) !== 0);
        expect(pong.payload.toString()).toBe("flagflag");
        await raw.waitFor(f => f.type === T.PING && (f.flags & F.ACK) !== 0 && f.payload.toString() === "pingpong");
        expect(raw.frames.some(f => f.type === T.PING && f.payload.toString() === "unsolic.")).toBe(false);
        // HEADERS on a stream lower than one that only saw PRIORITY is fine.
        raw.headers(7, baseHeaders("/hello"));
        expect((await raw.body(7)).toString()).toBe("hello");
        expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
        raw.close();
      });

      test("PRIORITY that depends on its own stream → RST_STREAM PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.write(frame(T.PRIORITY, 0, 1, Buffer.from([0, 0, 0, 1, 255])));
        expect(await raw.rst(1)).toBe(1);
        raw.write(
          frame(
            T.HEADERS,
            F.END_HEADERS | F.END_STREAM | F.PRIORITY,
            3,
            Buffer.concat([Buffer.from([0, 0, 0, 3, 16]), hpackLiteral(baseHeaders("/hello"))]),
          ),
        );
        expect(await raw.rst(3)).toBe(1);
        raw.headers(5, baseHeaders("/hello"));
        expect((await raw.body(5)).toString()).toBe("hello");
        raw.close();
      });

      // ── stream states (h2spec §5.1, hyper recv.rs, Go TestServer_*HalfCloseRemote*) ──
      test("DATA on a half-closed (remote) stream → RST_STREAM STREAM_CLOSED, connection survives", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/slow?ms=400"));
        raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("x")));
        expect(await raw.rst(1)).toBe(5);
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.body(3)).toString()).toBe("hello");
        raw.close();
      });

      test("HEADERS on a half-closed (remote) stream → RST_STREAM STREAM_CLOSED and the handler is aborted", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        const before = (fx.stderr().match(/ABORTED/g) ?? []).length;
        raw.headers(1, baseHeaders("/abort", "POST"), F.END_HEADERS);
        raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.alloc(0)));
        raw.write(frame(T.PING, 0, 0, Buffer.from("barrier1")));
        await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "barrier1");
        raw.headers(1, [["x-late", "1"]], F.END_HEADERS);
        expect(await raw.rst(1)).toBe(5);
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.body(3)).toString()).toBe("hello");
        while ((fx.stderr().match(/ABORTED/g) ?? []).length <= before) await request(session, { ":path": "/hello" });
        raw.close();
      });

      test("trailers without END_STREAM → RST_STREAM PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
        raw.write(frame(T.DATA, 0, 1, Buffer.from("body")));
        raw.headers(1, [["x-trailer", "t"]], F.END_HEADERS);
        expect(await raw.rst(1)).toBe(1);
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.body(3)).toString()).toBe("hello");
        raw.close();
      });

      test("content-length under-run at END_STREAM and at trailers → RST_STREAM PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, [...baseHeaders("/echo", "POST"), ["content-length", "10"]], F.END_HEADERS);
        raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("abc")));
        expect(await raw.rst(1)).toBe(1);
        raw.headers(3, [...baseHeaders("/echo", "POST"), ["content-length", "10"]], F.END_HEADERS);
        raw.write(frame(T.DATA, 0, 3, Buffer.from("abc")));
        raw.headers(3, [["x-t", "1"]]);
        expect(await raw.rst(3)).toBe(1);
        raw.headers(5, [...baseHeaders("/echo", "POST"), ["content-length", "6"]], F.END_HEADERS);
        raw.write(frame(T.DATA, 0, 5, Buffer.from("test")));
        raw.write(frame(T.DATA, F.END_STREAM, 5, Buffer.from("test")));
        expect(await raw.rst(5)).toBe(1);
        raw.headers(7, baseHeaders("/hello"));
        expect((await raw.body(7)).toString()).toBe("hello");
        raw.close();
      });

      test("POST with a single empty END_STREAM DATA frame has an empty body", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
        raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.alloc(0)));
        const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        expect(decodeStatus(h.payload)).toBe(201);
        await raw.waitFor(f => f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
        expect(
          Buffer.concat(raw.frames.filter(f => f.type === T.DATA && f.streamId === 1).map(f => f.payload)).length,
        ).toBe(0);
        raw.close();
      });

      test("responding before the request body ends: response, then RST_STREAM NO_ERROR; later DATA/trailers on that stream are ignored", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/hello", "POST"), F.END_HEADERS);
        expect((await raw.body(1)).toString()).toBe("hello");
        expect(await raw.rst(1)).toBe(0);
        const endIdx = raw.frames.findIndex(
          f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0,
        );
        const rstIdx = raw.frames.findIndex(f => f.type === T.RST_STREAM && f.streamId === 1);
        expect(rstIdx).toBeGreaterThan(endIdx);
        raw.write(frame(T.DATA, 0, 1, Buffer.alloc(16384)));
        raw.write(frame(T.DATA, 0, 1, Buffer.alloc(16384)));
        raw.headers(1, [["x-t", "1"]]);
        raw.write(frame(T.PING, 0, 0, Buffer.from("afterrst")));
        await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "afterrst");
        expect(raw.frames.filter(f => f.type === T.RST_STREAM && f.streamId === 1).length).toBe(1);
        expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.body(3)).toString()).toBe("hello");
        raw.close();
      });

      test("431 for a request with a body pending also resets the stream", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        const big = Buffer.alloc(4000, "v").toString(); // 5 × 4 KB > the 16 KB list limit, under the 2× hard cap
        raw.headers(
          1,
          [...baseHeaders("/headers", "POST"), ["x-1", big], ["x-2", big], ["x-3", big], ["x-4", big], ["x-5", big]],
          F.END_HEADERS,
        );
        const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        expect(decodeStatus(h.payload)).toBe(431);
        expect([0, 1]).toContain(await raw.rst(1));
        raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("x")));
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.body(3)).toString()).toBe("hello");
        raw.close();
      });

      test("after the client resets a stream, more frames on it are a stream error, not a connection error", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/abort", "POST"), F.END_HEADERS);
        raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
        raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("late")));
        expect(
          await raw.waitFor(f => f.type === T.RST_STREAM && f.streamId === 1).then(f => f.payload.readUInt32BE(0)),
        ).toBe(5);
        raw.headers(1, baseHeaders("/hello"));
        raw.write(frame(T.PING, 0, 0, Buffer.from("afterhd1")));
        await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "afterhd1");
        expect(
          raw.frames.filter(f => f.type === T.RST_STREAM && f.streamId === 1).map(f => f.payload.readUInt32BE(0)),
        ).toEqual([5, 5]);
        expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.body(3)).toString()).toBe("hello");
        raw.close();
      });

      test("DATA on a stream the client itself ended (closed) → GOAWAY STREAM_CLOSED", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/hello"));
        expect((await raw.body(1)).toString()).toBe("hello");
        raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("x")));
        expect((await raw.goaway()).code).toBe(5);
        raw.close();
      });

      test("HEADERS with a stream id lower than the last opened → GOAWAY PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(5, baseHeaders("/hello"));
        expect((await raw.body(5)).toString()).toBe("hello");
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.goaway()).code).toBe(1);
        raw.close();
      });

      test("WINDOW_UPDATE and RST_STREAM on a completed stream are ignored", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/hello"));
        expect((await raw.body(1)).toString()).toBe("hello");
        raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(5)));
        raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
        raw.write(frame(T.PING, 0, 0, Buffer.from("closedok")));
        await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "closedok");
        expect(raw.frames.some(f => f.type === T.GOAWAY || (f.type === T.RST_STREAM && f.streamId === 1))).toBe(false);
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.body(3)).toString()).toBe("hello");
        raw.close();
      });

      test("a stream id burned by a malformed request cannot be reused", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, [
          [":method", "GET"],
          [":scheme", "https"],
        ]);
        expect(await raw.rst(1)).toBe(1);
        raw.headers(1, baseHeaders("/hello"));
        raw.write(frame(T.PING, 0, 0, Buffer.from("burned01")));
        const f = await raw.waitFor(
          f => f.type === T.GOAWAY || (f.type === T.PING && f.payload.toString() === "burned01"),
        );
        // Either ignored (we reset it) or a connection error; never served.
        expect(raw.frames.some(f => f.type === T.HEADERS && f.streamId === 1)).toBe(false);
        if (f.type !== T.GOAWAY) {
          raw.headers(3, baseHeaders("/hello"));
          expect((await raw.body(3)).toString()).toBe("hello");
        }
        raw.close();
      });

      test("MAX_CONCURRENT_STREAMS: the stream past the limit is refused, earlier streams are unaffected, a slot frees up", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        const settings = await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) === 0);
        let max = 0;
        for (let i = 0; i + 6 <= settings.payload.length; i += 6)
          if (settings.payload.readUInt16BE(i) === 3) max = settings.payload.readUInt32BE(i + 2);
        expect(max).toBeGreaterThan(0);
        const block = hpackLiteral(baseHeaders("/abort"));
        const parts: Buffer[] = [];
        for (let i = 0; i < max; i++) parts.push(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1 + 2 * i, block));
        // The refused one is split across HEADERS+CONTINUATION so HPACK state must still be consumed.
        const over = 1 + 2 * max;
        const hb = hpackLiteral(baseHeaders("/hello"));
        parts.push(
          frame(T.HEADERS, F.END_STREAM, over, hb.subarray(0, 3)),
          frame(T.CONTINUATION, F.END_HEADERS, over, hb.subarray(3)),
        );
        raw.write(Buffer.concat(parts));
        expect(await raw.rst(over)).toBe(7);
        raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
        raw.write(frame(T.PING, 0, 0, Buffer.from("slotfree")));
        await raw.waitFor(f => f.type === T.PING && f.payload.toString() === "slotfree");
        raw.headers(over + 2, baseHeaders("/hello"));
        expect((await raw.body(over + 2)).toString()).toBe("hello");
        raw.close();
      }, 20000);

      // ── flow control (hyper flow_control.rs, Go TestServer_Response_LargeWrite*) ──
      const received = (raw: RawH2, id: number) =>
        raw.frames.filter(f => f.type === T.DATA && f.streamId === id).reduce((a, f) => a + f.payload.length, 0);
      const barrier = async (raw: RawH2, tag: string) => {
        raw.write(frame(T.PING, 0, 0, Buffer.from(tag.padEnd(8).slice(0, 8))));
        await raw.waitFor(
          f => f.type === T.PING && (f.flags & F.ACK) !== 0 && f.payload.toString() === tag.padEnd(8).slice(0, 8),
        );
      };

      test("initial window 0: HEADERS arrive, no DATA until WINDOW_UPDATE; exact-quota dribbles", async () => {
        const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0) });
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.headers(1, baseHeaders("/fixed?n=264"));
        await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        await barrier(raw, "w0");
        expect(received(raw, 1)).toBe(0);
        for (const [inc, total] of [
          [123, 123],
          [1, 124],
          [13, 137],
          [127, 264],
        ] as const) {
          raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(inc)));
          while (received(raw, 1) < total)
            await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= total);
          await barrier(raw, "w" + total);
          expect(received(raw, 1)).toBe(total);
        }
        expect(raw.frames.some(f => f.type === T.DATA && f.streamId === 1 && (f.flags & F.END_STREAM) !== 0)).toBe(
          true,
        );
        raw.close();
      });

      test("initial window 0: empty responses are not flow-controlled", async () => {
        const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0) });
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.headers(1, baseHeaders("/status/204"));
        raw.headers(3, baseHeaders("/empty"));
        await raw.waitFor(
          f => f.streamId === 1 && (f.flags & F.END_STREAM) !== 0 && (f.type === T.HEADERS || f.type === T.DATA),
        );
        await raw.waitFor(
          f => f.streamId === 3 && (f.flags & F.END_STREAM) !== 0 && (f.type === T.HEADERS || f.type === T.DATA),
        );
        raw.close();
      });

      test("stream window resumes on small WINDOW_UPDATEs after the connection window opens", async () => {
        const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 1024) });
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.headers(1, baseHeaders("/big"));
        while (received(raw, 1) < 1024)
          await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 1024);
        raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(10)));
        await barrier(raw, "cw");
        raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(4)));
        raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(1)));
        while (received(raw, 1) < 1029)
          await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 1029);
        await barrier(raw, "sw5");
        expect(received(raw, 1)).toBe(1029);
        raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(5)));
        while (received(raw, 1) < 1034)
          await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 1034);
        await barrier(raw, "sw10");
        expect(received(raw, 1)).toBe(1034);
        raw.close();
      });

      test("raising SETTINGS_INITIAL_WINDOW_SIZE mid-stream releases exactly the delta", async () => {
        const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0) });
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.headers(1, baseHeaders("/big"));
        await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        await barrier(raw, "iws0");
        expect(received(raw, 1)).toBe(0);
        raw.write(frame(T.SETTINGS, 0, 0, setting(4, 10)));
        while (received(raw, 1) < 10)
          await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 10);
        await barrier(raw, "iws10");
        expect(received(raw, 1)).toBe(10);
        raw.write(frame(T.SETTINGS, 0, 0, setting(4, 11)));
        while (received(raw, 1) < 11)
          await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 11);
        await barrier(raw, "iws11");
        expect(received(raw, 1)).toBe(11);
        raw.close();
      });

      test("lowering SETTINGS_INITIAL_WINDOW_SIZE mid-stream stops the response (negative window), WINDOW_UPDATE resumes it", async () => {
        const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 3) });
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.headers(1, baseHeaders("/big"));
        while (received(raw, 1) < 3) await raw.waitFor(f => f.type === T.DATA && f.streamId === 1);
        raw.write(frame(T.SETTINGS, 0, 0, setting(4, 2))); // window is now -1
        await barrier(raw, "neg");
        raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(2))); // -1 + 2 = 1
        while (received(raw, 1) < 4)
          await raw.waitFor(f => f.type === T.DATA && f.streamId === 1 && received(raw, 1) >= 4);
        await barrier(raw, "neg2");
        expect(received(raw, 1)).toBe(4);
        // Now open everything and drain the full 5 MB byte-exact.
        raw.write(frame(T.SETTINGS, 0, 0, setting(4, 1 << 30)));
        raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(1 << 30)));
        const body = await raw.body(1);
        expect(body.length).toBe(5 * 1024 * 1024);
        expect(Bun.hash(body)).toBe(Bun.hash(Buffer.alloc(5 * 1024 * 1024, "abcdefghijklmnop")));
        raw.close();
      }, 20000);

      test("SETTINGS_INITIAL_WINDOW_SIZE delta that overflows an open stream's window → GOAWAY FLOW_CONTROL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/slow?ms=2000"));
        raw.write(frame(T.WINDOW_UPDATE, 0, 1, u32(0x7fffffff - 65535)));
        raw.write(frame(T.SETTINGS, 0, 0, setting(4, 65536)));
        expect((await raw.goaway()).code).toBe(3);
        raw.close();
      });

      test("adversarial INITIAL_WINDOW_SIZE sequence with no open streams does not underflow", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.write(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, Buffer.alloc(0)));
        expect(await raw.rst(1)).toBe(1);
        for (const v of [1329018135, 3809661, 1467177332, 3844989]) raw.write(frame(T.SETTINGS, 0, 0, setting(4, v)));
        await barrier(raw, "iwsseq");
        expect(raw.frames.filter(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0).length).toBeGreaterThanOrEqual(
          5,
        );
        expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.body(3)).toString()).toBe("hello");
        raw.close();
      });

      test("padding counts against the receive window", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.headers(1, baseHeaders("/late-read", "POST"), F.END_HEADERS);
        // 4 padded frames of exactly 16384 window-bytes each (1 + 16183 + 200), only 64732 body bytes.
        for (let i = 0; i < 4; i++)
          raw.write(
            frame(T.DATA, F.PADDED, 1, Buffer.concat([Buffer.from([200]), Buffer.alloc(16183, 1), Buffer.alloc(200)])),
          );
        raw.write(frame(T.DATA, 0, 1, Buffer.from("x")));
        expect(await raw.rst(1)).toBe(3);
        raw.headers(3, baseHeaders("/release-late-read"));
        await raw.body(3);
        raw.close();
      });

      test("RST_STREAM on a flow-control-blocked response frees it; a sibling completes byte-exact", async () => {
        const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 1024) });
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.headers(1, baseHeaders("/big"));
        raw.headers(3, baseHeaders("/big"));
        while (received(raw, 1) < 1024 || received(raw, 3) < 1024) await raw.waitFor(f => f.type === T.DATA);
        raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
        await barrier(raw, "rst1");
        const r1 = received(raw, 1);
        raw.write(frame(T.WINDOW_UPDATE, 0, 3, u32(8 << 20)));
        raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(8 << 20)));
        const body = await raw.body(3);
        expect(body.length).toBe(5 * 1024 * 1024);
        expect(received(raw, 1)).toBe(r1);
        raw.close();
      }, 20000);

      test("connection window is credited back for bodies on streams that were reset unread", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        const chunk = Buffer.alloc(16384);
        // 80 streams × 64 KB = 5 MB > the 4 MB replenish threshold; each reset right away.
        for (let i = 0, id = 1; i < 80; i++, id += 2) {
          const parts = [frame(T.HEADERS, F.END_HEADERS, id, hpackLiteral(baseHeaders("/late-read", "POST")))];
          for (let j = 0; j < 4; j++) parts.push(frame(T.DATA, 0, id, chunk));
          parts.push(frame(T.RST_STREAM, 0, id, u32(8)));
          raw.write(Buffer.concat(parts));
          if (i % 10 === 9) await barrier(raw, "cr" + i);
        }
        const credited = raw.frames
          .filter(f => f.type === T.WINDOW_UPDATE && f.streamId === 0)
          .reduce((a, f) => a + f.payload.readUInt32BE(0), 0);
        // The first WINDOW_UPDATE(0) is the initial widening; anything past that is credit for our DATA.
        expect(credited).toBeGreaterThanOrEqual((1 << 24) - 65535 + 4 * 1024 * 1024);
        expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
        raw.headers(161, baseHeaders("/release-late-read"));
        await raw.body(161);
        raw.close();
      }, 20000);

      // ── GOAWAY semantics ──
      test("client GOAWAY (unknown code, debug data) does not stop in-flight responses or PINGs; connection closes once drained", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/slow?ms=200"));
        raw.write(frame(T.GOAWAY, 0, 0, Buffer.concat([u32(0), u32(0xff), Buffer.from("bye")])));
        await barrier(raw, "aftergo");
        expect((await raw.body(1)).toString()).toBe("slow");
        await raw.waitForClose();
        expect(raw.frames.some(f => f.type === T.GOAWAY && f.payload.readUInt32BE(4) !== 0)).toBe(false);
        raw.close();
      });

      test("client GOAWAY then a bogus connection WINDOW_UPDATE still gets GOAWAY FLOW_CONTROL_ERROR and a close", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, [...baseHeaders("/echo", "POST"), ["content-length", "12"]], F.END_HEADERS);
        raw.write(frame(T.DATA, 0, 1, Buffer.from("some ")));
        raw.write(frame(T.GOAWAY, 0, 0, Buffer.concat([u32(1), u32(0)])));
        raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(0x7fffffff)));
        expect((await raw.goaway()).code).toBe(3);
        await raw.waitForClose();
        raw.close();
      });

      // ── response encoding ──
      test("response header block larger than the peer's max frame size is split into CONTINUATION frames", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/many-headers"));
        const first = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        expect(first.flags & F.END_HEADERS).toBe(0);
        expect(first.payload.length).toBeLessThanOrEqual(16384);
        const last = await raw.waitFor(
          f => f.type === T.CONTINUATION && f.streamId === 1 && (f.flags & F.END_HEADERS) !== 0,
        );
        expect(last.payload.length).toBeLessThanOrEqual(16384);
        expect((await raw.body(1)).toString()).toBe("ok");
        raw.close();
        const res = await request(session, { ":path": "/many-headers" });
        expect(res.headers["x-header-0"]).toBe("x-value-0");
        expect(res.headers["x-header-2999"]).toBe("x-value-2999");
      });

      test("hop-by-hop response headers set by the handler are not transmitted", async () => {
        const res = await request(session, { ":path": "/hop-headers" });
        expect(res.headers[":status"]).toBe(200);
        expect(res.body.toString()).toBe("hi");
        expect(res.headers["x-kept"]).toBe("1");
        for (const h of ["transfer-encoding", "connection", "keep-alive", "upgrade", "proxy-connection"])
          expect(res.headers[h]).toBeUndefined();
      });

      test("empty 200 response carries content-length: 0 and no DATA payload", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/empty"));
        const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        await raw.waitFor(f => f.streamId === 1 && (f.flags & F.END_STREAM) !== 0);
        expect(received(raw, 1)).toBe(0);
        raw.close();
        const res = await request(session, { ":path": "/empty" });
        expect(res.headers["content-length"]).toBe("0");
      });

      test("peer SETTINGS_HEADER_TABLE_SIZE=0: encoder emits a size update and stops indexing", async () => {
        const raw = await RawH2.connect(fx.port, secure, { settings: setting(1, 0) });
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.headers(1, baseHeaders("/set-cookies"));
        const h1 = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        expect(h1.payload[0]).toBe(0x20);
        await raw.body(1);
        raw.headers(3, baseHeaders("/set-cookies"));
        await raw.body(3);
        raw.close();
        // And a strict decoder (nghttp2) stays happy across several responses.
        const s0 = http2.connect(`${secure ? "https" : "http"}://127.0.0.1:${fx.port}`, {
          rejectUnauthorized: false,
          settings: { headerTableSize: 0 },
        });
        await new Promise<void>((res, rej) => {
          s0.once("connect", () => res());
          s0.once("error", rej);
        });
        for (let i = 0; i < 3; i++)
          expect((await request(s0, { ":path": "/set-cookies" })).headers["x-multi"]).toBe("1, 2");
        s0.close();
      });

      test("HPACK request encodings: indexed, incremental, never-indexed, huffman, size updates are all accepted", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        const vecs = [
          Buffer.from([0x40, 0x0a, ...Buffer.from("user-agent"), 0x06, ...Buffer.from("h2spec")]), // inc-indexing raw
          Buffer.from([0x40, 0x87, 0xb5, 0x05, 0xb1, 0x61, 0xcc, 0x5a, 0x93, 0x84, 0x9c, 0x48, 0xac, 0xa4]), // inc-indexing huffman name+value
          Buffer.from([0x00, 0x87, 0xb5, 0x05, 0xb1, 0x61, 0xcc, 0x5a, 0x93, 0x84, 0x9c, 0x48, 0xac, 0xa4]), // without indexing huffman
          Buffer.from([0x00, 0x85, 0xf2, 0xb2, 0x4a, 0x84, 0xff, 0x84, 0x9c, 0x48, 0xac, 0xa4]), // without indexing new name huffman (x-test)
          Buffer.from([0x10, 0x0a, ...Buffer.from("user-agent"), 0x06, ...Buffer.from("h2spec")]), // never indexed raw
          Buffer.from([0x10, 0x87, 0xb5, 0x05, 0xb1, 0x61, 0xcc, 0x5a, 0x93, 0x84, 0x9c, 0x48, 0xac, 0xa4]), // never indexed huffman
          Buffer.from([0x10, 0x85, 0xf2, 0xb2, 0x4a, 0x84, 0xff, 0x84, 0x9c, 0x48, 0xac, 0xa4]), // never indexed new name huffman
          Buffer.from([0xbe]), // indexed: dynamic table entry 62 (user-agent: h2spec from the first vector)
        ];
        let id = 1;
        for (const v of vecs) {
          raw.write(
            frame(
              T.HEADERS,
              F.END_HEADERS | F.END_STREAM,
              id,
              Buffer.concat([hpackLiteral(baseHeaders("/headers")), v]),
            ),
          );
          const body = JSON.parse((await raw.body(id)).toString());
          expect(body.headers["user-agent"] ?? body.headers["x-test"]).toMatch(/h2spec|test/);
          id += 2;
        }
        for (const prefix of [[0x3f, 0xe1, 0x1f], [0x3f, 0x61, 0x3f, 0xe1, 0x1f], [0x20]]) {
          raw.write(
            frame(
              T.HEADERS,
              F.END_HEADERS | F.END_STREAM,
              id,
              Buffer.concat([Buffer.from(prefix), hpackLiteral(baseHeaders("/hello"))]),
            ),
          );
          expect((await raw.body(id)).toString()).toBe("hello");
          id += 2;
        }
        raw.close();
      });

      test("whole request written one byte at a time", async () => {
        const raw = await RawH2.connect(fx.port, secure, { sendPreface: false });
        const hb = hpackLiteral([...baseHeaders("/echo", "POST"), ["x-echo", "bytewise"]]);
        const bytes = Buffer.concat([
          PREFACE,
          frame(T.SETTINGS, 0, 0),
          frame(T.HEADERS, 0, 1, hb.subarray(0, 5)),
          frame(T.CONTINUATION, F.END_HEADERS, 1, hb.subarray(5)),
          frame(T.DATA, 0, 1, Buffer.from("ab")),
          frame(T.DATA, F.END_STREAM, 1, Buffer.from("cd")),
        ]);
        for (let i = 0; i < bytes.length; i++) raw.write(bytes.subarray(i, i + 1));
        expect((await raw.body(1)).toString()).toBe("abcd");
        raw.close();
      });

      test("padded HEADERS followed by CONTINUATION: padding applies to the HEADERS frame only", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        const hb = hpackLiteral([...baseHeaders("/headers"), ["x-pad", "ok"]]);
        raw.write(
          frame(
            T.HEADERS,
            F.PADDED | F.END_STREAM,
            1,
            Buffer.concat([Buffer.from([3]), hb.subarray(0, 1), Buffer.alloc(3)]),
          ),
        );
        raw.write(frame(T.CONTINUATION, F.END_HEADERS, 1, hb.subarray(1)));
        expect(JSON.parse((await raw.body(1)).toString()).headers["x-pad"]).toBe("ok");
        raw.close();
      });

      test("expect: 100-continue is matched case-insensitively", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, [...baseHeaders("/echo", "POST"), ["expect", "100-Continue"]], F.END_HEADERS);
        const interim = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        expect(decodeStatus(interim.payload)).toBe(100);
        raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("ok")));
        await raw.body(1);
        raw.close();
      });

      test("host without :authority is accepted and becomes the URL host; a request with an empty regular header value is fine", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, [
          [":method", "GET"],
          [":scheme", "https"],
          [":path", "/headers"],
          ["host", "h.test"],
          ["x-empty", ""],
        ]);
        const body = JSON.parse((await raw.body(1)).toString());
        expect(new URL(body.url).host).toBe("h.test");
        expect(body.headers["x-empty"]).toBe("");
        raw.close();
      });

      test("plain CONNECT (only :method and :authority) reaches the handler, not a protocol error", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(
          1,
          [
            [":method", "CONNECT"],
            [":authority", "example.com:443"],
          ],
          F.END_HEADERS,
        );
        const f = await raw.waitFor(f => f.streamId === 1 && (f.type === T.HEADERS || f.type === T.RST_STREAM));
        expect(f.type).toBe(T.HEADERS);
        raw.close();
        expect(fx.proc.exitCode).toBeNull();
      });

      test("client reset / disconnect while the handler is reading the body rejects the read", async () => {
        for (const how of ["rst", "close"] as const) {
          const before = (fx.stderr().match(/READ-ERR/g) ?? []).length;
          const raw = await RawH2.connect(fx.port, secure);
          raw.headers(1, [...baseHeaders("/read-report", "POST"), ["content-length", "100000"]], F.END_HEADERS);
          raw.write(frame(T.DATA, 0, 1, Buffer.alloc(1000)));
          await barrier(raw, "rd" + how);
          if (how === "rst") raw.write(frame(T.RST_STREAM, 0, 1, u32(8)));
          else raw.socket.destroy();
          while ((fx.stderr().match(/READ-ERR/g) ?? []).length <= before) await request(session, { ":path": "/hello" });
          if (how === "rst") raw.close();
        }
      });

      test("client disconnect while streaming an unbounded response cancels the stream source", async () => {
        const before = (fx.stderr().match(/CANCELLED/g) ?? []).length;
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/infinite"));
        await raw.waitFor(f => f.type === T.DATA && f.streamId === 1);
        raw.socket.destroy();
        while ((fx.stderr().match(/CANCELLED/g) ?? []).length <= before) await request(session, { ":path": "/hello" });
      });

      test("response blocked on flow control is torn down cleanly by RST_STREAM, repeatedly", async () => {
        const s2 = await connectH2(fx.port, secure);
        for (let i = 0; i < 30; i++) {
          await new Promise<void>(resolve => {
            const r = s2.request({ ":path": "/big" });
            r.on("response", () => {
              r.close(http2.constants.NGHTTP2_CANCEL);
              resolve();
            });
            r.on("error", () => {});
            r.resume();
          });
        }
        expect((await request(s2, { ":path": "/hello" })).body.toString()).toBe("hello");
        const big = await request(s2, { ":path": "/big" });
        expect(big.body.length).toBe(5 * 1024 * 1024);
        s2.close();
      }, 20000);

      test(":path * is accepted for OPTIONS", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, [
          [":method", "OPTIONS"],
          [":scheme", "https"],
          [":path", "*"],
          [":authority", "localhost"],
        ]);
        const f = await raw.waitFor(f => f.streamId === 1 && (f.type === T.HEADERS || f.type === T.RST_STREAM));
        expect(f.type).toBe(T.HEADERS);
        raw.close();
      });

      test("SETTINGS with more than 32 entries → GOAWAY ENHANCE_YOUR_CALM", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.write(
          frame(T.SETTINGS, 0, 0, Buffer.concat(Array.from({ length: 33 }, (_, i) => setting(4, 65535 + (i & 1))))),
        );
        expect((await raw.goaway()).code).toBe(11);
        raw.close();
      });

      test("empty CONTINUATION flood → GOAWAY ENHANCE_YOUR_CALM", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.write(
          Buffer.concat([
            frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello"))),
            ...Array.from({ length: 40 }, () => frame(T.CONTINUATION, 0, 1, Buffer.alloc(0))),
          ]),
        );
        expect((await raw.goaway()).code).toBe(11);
        raw.close();
      });

      test("a client that stops reading is not cut off for the server's own queued responses", async () => {
        // 200 streams × 12 KB of response headers ≈ 2.4 MB queued while the client
        // isn't reading; that's backpressure, not abuse.
        const raw = await RawH2.connect(fx.port, secure);
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.socket.pause();
        const parts: Buffer[] = [];
        for (let i = 0, id = 1; i < 200; i++, id += 2)
          parts.push(
            frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, id, hpackLiteral(baseHeaders("/big-headers?kb=12"))),
          );
        raw.write(Buffer.concat(parts));
        await new Promise<void>(r => setTimeout(r, 200));
        raw.socket.resume();
        for (let id = 1; id < 400; id += 2) await raw.body(id);
        expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(false);
        raw.close();
      }, 20000);

      test("streaming response with a huge peer window completes without inbound frames to pump it", async () => {
        // 8 × 1 MiB pulls with `await null` between them; the client opens
        // stream+connection windows to 2^31-1 up front so it never sends
        // WINDOW_UPDATEs mid-body. Each write past the 256 KB high-water mark
        // must schedule its own drain.
        const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0x7fffffff) });
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(0x7fffffff - 65535)));
        raw.headers(1, baseHeaders("/pull-1mb"));
        const body = await raw.body(1);
        expect(body.length).toBe(8 << 20);
        expect(raw.frames.filter(f => f.type === T.WINDOW_UPDATE).length).toBe(1); // just the server's initial one
        raw.close();
      }, 20000);

      test("a small response is not starved behind a large one on the same connection", async () => {
        // Both requests are dispatched while the window is 0, then everything
        // opens at once: /small must complete within a couple of /big slices.
        const raw = await RawH2.connect(fx.port, secure, { settings: setting(4, 0) });
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.headers(1, baseHeaders("/big"));
        raw.headers(3, baseHeaders("/fixed?n=200"));
        await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3);
        raw.write(
          Buffer.concat([
            frame(T.SETTINGS, 0, 0, setting(4, 0x7fffffff)),
            frame(T.WINDOW_UPDATE, 0, 0, u32(0x7fffffff - 65535)),
          ]),
        );
        await raw.waitFor(f => f.streamId === 3 && (f.flags & F.END_STREAM) !== 0 && f.type === T.DATA);
        const idx = raw.frames.findIndex(f => f.streamId === 3 && (f.flags & F.END_STREAM) !== 0);
        const bigBefore = raw.frames
          .slice(0, idx)
          .filter(f => f.type === T.DATA && f.streamId === 1)
          .reduce((a, f) => a + f.payload.length, 0);
        expect(bigBefore).toBeLessThanOrEqual(512 * 1024);
        expect((await raw.body(1)).length).toBe(5 * 1024 * 1024);
        raw.close();
      }, 20000);

      test("hop-by-hop headers are dropped on static and file routes too", async () => {
        for (const path of ["/static-hop", "/file-hop"]) {
          const res = await request(session, { ":path": path, ":method": "HEAD" });
          expect(res.headers["x-kept"]).toBe("1");
          for (const h of ["connection", "keep-alive", "te", "upgrade"]) expect(res.headers[h]).toBeUndefined();
        }
        const res = await request(session, { ":path": "/static-hop" });
        expect(res.body.toString()).toBe("hop");
      });

      test("HEADER_TABLE_SIZE 0 then 4096 before the next block emits both size updates (strict decoder stays in sync)", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.write(frame(T.SETTINGS, 0, 0, setting(1, 0)));
        raw.write(frame(T.SETTINGS, 0, 0, setting(1, 4096)));
        await raw.waitFor(f => raw.frames.filter(g => g.type === T.SETTINGS && (g.flags & F.ACK) !== 0).length >= 3);
        raw.headers(1, baseHeaders("/hello"));
        const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        expect(h.payload[0]).toBe(0x20); // update to 0 (the minimum seen)…
        expect(h.payload.subarray(1, 3)).toEqual(Buffer.from([0x3f, 0xe1])); // …then to 4096 (0x3f 0xe1 0x1f)
        await raw.body(1);
        // In one frame: same result.
        raw.write(frame(T.SETTINGS, 0, 0, Buffer.concat([setting(1, 0), setting(1, 4096)])));
        await raw.waitFor(f => raw.frames.filter(g => g.type === T.SETTINGS && (g.flags & F.ACK) !== 0).length >= 4);
        raw.headers(3, baseHeaders("/hello"));
        const h3 = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 3);
        expect(h3.payload[0]).toBe(0x20);
        raw.headers(5, baseHeaders("/hello"));
        const h5 = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 5);
        expect(h5.payload[0]).not.toBe(0x20);
        await raw.body(5);
        raw.close();
        const s0 = http2.connect(`${secure ? "https" : "http"}://127.0.0.1:${fx.port}`, {
          rejectUnauthorized: false,
          settings: { headerTableSize: 0 },
        });
        await new Promise<void>((res, rej) => {
          s0.once("connect", () => res());
          s0.once("error", rej);
        });
        s0.settings({ headerTableSize: 4096 });
        for (let i = 0; i < 3; i++)
          expect((await request(s0, { ":path": "/set-cookies" })).headers["x-multi"]).toBe("1, 2");
        s0.close();
      });

      test("peer MAX_FRAME_SIZE above 16384 is honoured for DATA", async () => {
        const raw = await RawH2.connect(fx.port, secure, {
          settings: Buffer.concat([setting(5, (1 << 24) - 1), setting(4, 0x7fffffff)]),
        });
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        raw.write(frame(T.WINDOW_UPDATE, 0, 0, u32(0x7fffffff - 65535)));
        raw.headers(1, baseHeaders("/big"));
        const body = await raw.body(1);
        expect(body.length).toBe(5 * 1024 * 1024);
        expect(
          Math.max(...raw.frames.filter(f => f.type === T.DATA && f.streamId === 1).map(f => f.payload.length)),
        ).toBeGreaterThan(16384);
        raw.close();
      });

      test("header list over the limit → 431 on that stream, connection survives", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        const big = Buffer.alloc(4000, "v").toString(); // 5 × 4 KB > the 16 KB list limit, under the 2× hard cap
        raw.headers(1, [
          ...baseHeaders("/headers"),
          ["x-1", big],
          ["x-2", big],
          ["x-3", big],
          ["x-4", big],
          ["x-5", big],
        ]);
        const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        expect(decodeStatus(h.payload)).toBe(431);
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.body(3)).toString()).toBe("hello");
        raw.close();
      });

      test("more than 200 header fields → 431, connection survives", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        const many: [string, string][] = [];
        for (let i = 0; i < 300; i++) many.push(["x-" + i, "1"]);
        raw.headers(1, [...baseHeaders("/headers"), ...many]);
        const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
        expect(decodeStatus(h.payload)).toBe(431);
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.body(3)).toString()).toBe("hello");
        raw.close();
      });

      for (const [name, abort] of [
        ["client RST_STREAM", (id: number) => frame(T.RST_STREAM, 0, id, Buffer.from([0, 0, 0, 8]))],
        ["server-induced reset (WINDOW_UPDATE 0)", (id: number) => frame(T.WINDOW_UPDATE, 0, id, Buffer.alloc(4))],
      ] as const) {
        test(`rapid reset flood via ${name} → GOAWAY ENHANCE_YOUR_CALM`, async () => {
          const raw = await RawH2.connect(fx.port, secure);
          await raw.waitFor(f => f.type === T.SETTINGS);
          const block = hpackLiteral(baseHeaders("/slow?ms=30000"));
          // The bucket holds 1000 resets. Send 50 open+reset pairs per write and
          // round-trip a PING between batches so the GOAWAY isn't lost behind
          // unread input when the server closes.
          let id = 1;
          for (let batch = 0; ; batch++) {
            expect(batch).toBeLessThan(40);
            const parts: Buffer[] = [];
            for (let n = 0; n < 50; n++, id += 2) {
              parts.push(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, id, block), abort(id));
            }
            const opaque = Buffer.alloc(8);
            opaque.writeUInt32BE(batch, 4);
            parts.push(frame(T.PING, 0, 0, opaque));
            raw.write(Buffer.concat(parts));
            const f = await raw.waitFor(
              f => f.type === T.GOAWAY || (f.type === T.PING && f.payload.readUInt32BE(4) === batch),
            );
            if (f.type === T.GOAWAY) {
              expect(f.payload.readUInt32BE(4)).toBe(11);
              break;
            }
          }
          raw.close();
        });
      }

      test("te: trailers is accepted", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, [...baseHeaders("/hello"), ["te", "trailers"]]);
        const d = await raw.waitFor(f => f.type === T.DATA && f.streamId === 1);
        expect(d.payload.toString()).toBe("hello");
        raw.close();
      });

      test("content-length mismatch → RST_STREAM PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, [...baseHeaders("/echo", "POST"), ["content-length", "3"]], F.END_HEADERS);
        raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("toolong")));
        expect(await raw.rst(1)).toBe(1);
        raw.close();
      });

      test("DATA on an idle stream → GOAWAY PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.write(frame(T.DATA, F.END_STREAM, 99, Buffer.from("x")));
        expect((await raw.goaway()).code).toBe(1);
        raw.close();
      });

      test("DATA / WINDOW_UPDATE on an even stream id → GOAWAY PROTOCOL_ERROR", async () => {
        for (const send of [
          (raw: RawH2) => raw.write(frame(T.DATA, F.END_STREAM, 2, Buffer.from("x"))),
          (raw: RawH2) => {
            const inc = Buffer.alloc(4);
            inc.writeUInt32BE(1);
            raw.write(frame(T.WINDOW_UPDATE, 0, 2, inc));
          },
        ]) {
          const raw = await RawH2.connect(fx.port, secure);
          raw.headers(3, baseHeaders("/hello"), F.END_HEADERS | F.END_STREAM);
          send(raw);
          expect((await raw.goaway()).code).toBe(1);
          raw.close();
        }
      });

      test("stream WINDOW_UPDATE of 0 → RST_STREAM PROTOCOL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/slow?ms=200"), F.END_HEADERS | F.END_STREAM);
        raw.write(frame(T.WINDOW_UPDATE, 0, 1, Buffer.alloc(4)));
        expect(await raw.rst(1)).toBe(1);
        raw.close();
      });

      test("host matching :authority is accepted", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, [...baseHeaders("/hello"), ["host", "localhost"]]);
        expect((await raw.body(1)).toString()).toBe("hello");
        raw.close();
      });

      test("DATA beyond the advertised stream window → RST_STREAM FLOW_CONTROL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        // /late-read never touches the body until released, so the window stays at 64 KB.
        raw.headers(1, baseHeaders("/late-read", "POST"), F.END_HEADERS);
        for (let i = 0; i < 4; i++) raw.write(frame(T.DATA, 0, 1, Buffer.alloc(16384)));
        raw.write(frame(T.DATA, 0, 1, Buffer.alloc(1)));
        expect(await raw.rst(1)).toBe(3);
        raw.headers(3, baseHeaders("/release-late-read"));
        await raw.body(3);
        raw.close();
      });

      test("zero-length field name is rejected (HPACK) → GOAWAY", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, [...baseHeaders("/hello"), ["", "x"]]);
        const g = await raw.goaway();
        expect([1, 9]).toContain(g.code);
        raw.close();
      });

      test("stream WINDOW_UPDATE overflow → RST_STREAM FLOW_CONTROL_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/slow?ms=200"), F.END_HEADERS | F.END_STREAM);
        const inc = Buffer.alloc(4);
        inc.writeUInt32BE(0x7fffffff, 0);
        raw.write(frame(T.WINDOW_UPDATE, 0, 1, inc));
        expect(await raw.rst(1)).toBe(3);
        raw.close();
      });

      test("SETTINGS_INITIAL_WINDOW_SIZE above 2^31-1 → GOAWAY FLOW_CONTROL_ERROR", async () => {
        const settings = Buffer.alloc(6);
        settings.writeUInt16BE(4, 0);
        settings.writeUInt32BE(0x80000000, 2);
        const raw = await RawH2.connect(fx.port, secure, { settings });
        expect((await raw.goaway()).code).toBe(3);
        raw.close();
      });

      test("PRIORITY frame with bad length → GOAWAY FRAME_SIZE_ERROR", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.write(frame(T.PRIORITY, 0, 1, Buffer.alloc(4)));
        expect((await raw.goaway()).code).toBe(6);
        raw.close();
      });

      for (const [name, type, flags] of [
        ["DATA", T.DATA, F.PADDED],
        ["HEADERS", T.HEADERS, F.PADDED | F.END_HEADERS],
      ] as const) {
        test(`${name} with pad length ≥ payload → GOAWAY PROTOCOL_ERROR`, async () => {
          const raw = await RawH2.connect(fx.port, secure);
          if (type === T.DATA) raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
          // Pad Length = 10 but only 3 bytes follow.
          raw.write(frame(type, flags, 1, Buffer.from([10, 1, 2, 3])));
          expect((await raw.goaway()).code).toBe(1);
          raw.close();
        });
      }

      test("HEADERS reusing a closed stream id → GOAWAY STREAM_CLOSED", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.body(3)).toString()).toBe("hello");
        raw.headers(3, baseHeaders("/hello"));
        expect((await raw.goaway()).code).toBe(5);
        raw.close();
      });

      test("CONTINUATION flood past the header-block cap → GOAWAY ENHANCE_YOUR_CALM", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        // Cap is 2 × SETTINGS_MAX_HEADER_LIST_SIZE (16 KB default) = 32 KB of
        // header block; send just past it in one write so nothing is still in
        // flight when the server closes.
        const junk = hpackLiteral([["x-junk", Buffer.alloc(4000, "j").toString()]]);
        const parts = [frame(T.HEADERS, 0, 1, hpackLiteral(baseHeaders("/hello")))];
        for (let total = 0; total <= 36 * 1024; total += junk.length) parts.push(frame(T.CONTINUATION, 0, 1, junk));
        raw.write(Buffer.concat(parts));
        expect((await raw.goaway()).code).toBe(11);
        raw.close();
      });

      test("HPACK bomb: tiny block expanding via dynamic-table refs is cut off", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
        // Literal with incremental indexing (0x40): name "x", value 3 KB → dynamic index 62.
        const name = Buffer.from("x");
        const value = Buffer.alloc(3000, "v");
        const lit = Buffer.concat([
          Buffer.from([0x40, name.length]),
          name,
          Buffer.from([0x7f, ...encodeInt(value.length - 127)]),
          value,
        ]);
        function encodeInt(n: number) {
          const out: number[] = [];
          while (n >= 128) {
            out.push((n & 0x7f) | 0x80);
            n >>= 7;
          }
          out.push(n);
          return out;
        }
        // Then ~12k one-byte references to it (0x80 | 62) = ~36 MB decoded from a 16 KB frame.
        const refs = Buffer.alloc(16384 - lit.length - hpackLiteral(baseHeaders("/hello")).length, 0x80 | 62);
        const block = Buffer.concat([hpackLiteral(baseHeaders("/hello")), lit, refs]);
        const t0 = performance.now();
        raw.write(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, block));
        const g = await raw.goaway();
        expect(g.code).toBe(11);
        // Bounded work: the server stops decoding at the hard cap instead of expanding all refs.
        expect(performance.now() - t0).toBeLessThan(5000);
        raw.close();
      });

      test.skipIf(secure)("SETTINGS flood from a client that never reads gets the connection closed", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        await raw.waitFor(f => f.type === T.SETTINGS);
        raw.socket.pause();
        const batch = Buffer.concat(Array.from({ length: 4096 }, () => frame(T.SETTINGS, 0, 0)));
        await new Promise<void>(resolve => {
          const pump = () => {
            if (raw.closed || raw.socket.destroyed) return resolve();
            raw.socket.write(batch, err => (err ? resolve() : setImmediate(pump)));
          };
          raw.socket.on("close", () => resolve());
          raw.socket.on("error", () => resolve());
          pump();
        });
        raw.close();
        expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
      });

      test("empty DATA frame flood on an open stream is tolerated and bounded by flow control", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/echo", "POST"), F.END_HEADERS);
        raw.write(Buffer.concat(Array.from({ length: 2000 }, () => frame(T.DATA, 0, 1, Buffer.alloc(0)))));
        raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.from("done")));
        expect((await raw.body(1)).toString()).toBe("done");
        raw.close();
      });

      test("client GOAWAY then close mid-request does not crash", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/slow?ms=100"));
        raw.write(frame(T.GOAWAY, 0, 0, Buffer.alloc(8)));
        raw.close();
        expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
      });

      // Cleartext only: needs a client socket that genuinely stops reading,
      // which a paused TLSSocket here does not (it keeps draining records).
      test.skipIf(secure)("PING flood from a client that never reads gets the connection closed", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        await raw.waitFor(f => f.type === T.SETTINGS);
        raw.socket.pause();
        const ping = frame(T.PING, 0, 0, Buffer.alloc(8));
        const batch = Buffer.concat(Array.from({ length: 4096 }, () => ping));
        // Keep writing until the server hangs up; it must not buffer replies forever.
        await new Promise<void>(resolve => {
          const pump = () => {
            if (raw.closed || raw.socket.destroyed) return resolve();
            raw.socket.write(batch, err => (err ? resolve() : setImmediate(pump)));
          };
          raw.socket.on("close", () => resolve());
          raw.socket.on("error", () => resolve());
          pump();
        });
        raw.close();
        expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
      });

      test("garbage after a valid request closes only that connection", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        raw.headers(1, baseHeaders("/slow?ms=50"));
        raw.write(Buffer.from("this is not a frame header at all, definitely"));
        await raw.waitForClose();
        expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
      });
    });

    test("HTTP/1.1 still works on the same port", async () => {
      const res = await fetch(`${secure ? "https" : "http"}://127.0.0.1:${fx.port}/hello`, {
        tls: { rejectUnauthorized: false },
      } as RequestInit);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello");
      // No HTTP/3 listener → no Alt-Svc.
      expect(res.headers.get("alt-svc")).toBeNull();
    });

    if (secure) {
      test("fetch(protocol: 'http2') talks h2 to Bun.serve", async () => {
        const res = await fetch(`https://127.0.0.1:${fx.port}/echo`, {
          method: "POST",
          body: "via-fetch",
          protocol: "http2",
          tls: { rejectUnauthorized: false },
        } as RequestInit);
        expect(res.status).toBe(201);
        expect(await res.text()).toBe("via-fetch");
      });

      test("ALPN http/1.1-only client is served HTTP/1.1", async () => {
        const body = await new Promise<string>((resolve, reject) => {
          const s = tls.connect(
            { port: fx.port, host: "127.0.0.1", ALPNProtocols: ["http/1.1"], rejectUnauthorized: false },
            () => {
              expect(s.alpnProtocol).toBe("http/1.1");
              s.write("GET /hello HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
            },
          );
          let out = "";
          s.on("data", d => (out += d));
          s.on("end", () => resolve(out));
          s.on("error", reject);
        });
        expect(body).toStartWith("HTTP/1.1 200 OK\r\n");
        expect(body).toEndWith("hello");
      });
    }

    test("websocket upgrade over HTTP/1.1 still works alongside h2", async () => {
      const ws = new WebSocket(`${secure ? "wss" : "ws"}://127.0.0.1:${fx.port}/ws`, {
        tls: { rejectUnauthorized: false },
      } as any);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = e => reject(e);
      });
      ws.close();
    });
  });
}

const fetchH3 = (port: number, path: string, init: RequestInit = {}) =>
  fetch(`https://127.0.0.1:${port}${path}`, {
    ...init,
    protocol: "http3",
    tls: { rejectUnauthorized: false },
  } as RequestInit);

describe("Bun.serve http2 + http3 on one port", () => {
  test("fetch, static and file routes over both; alt-svc advertised on h2; reload; stop with a stream open on each", async () => {
    await using fx = await startFixture({ tls: true, http3: true });
    const session = await connectH2(fx.port, true);
    const h2hello = await request(session, { ":path": "/hello" });
    expect(h2hello.body.toString()).toBe("hello");
    expect(String(h2hello.headers["alt-svc"] ?? "")).toContain("h3=");
    expect(await (await fetchH3(fx.port, "/hello")).text()).toBe("hello");
    expect((await request(session, { ":path": "/static" })).body.toString()).toBe("from-static-route");
    expect(await (await fetchH3(fx.port, "/static")).text()).toBe("from-static-route");
    const size = 3 * 1024 * 1024 + 17;
    expect((await request(session, { ":path": "/file-route" })).body.length).toBe(size);
    expect((await (await fetchH3(fx.port, "/file-route")).arrayBuffer()).byteLength).toBe(size);
    expect((await request(session, { ":path": "/api/7" })).body.toString()).toBe("id=7");
    expect(await (await fetchH3(fx.port, "/api/7")).text()).toBe("id=7");
    // reload swaps routes on both mux apps
    expect((await request(session, { ":path": "/reload" })).body.toString()).toBe("reloaded");
    expect((await request(session, { ":path": "/reloaded-route" })).body.toString()).toBe("after-reload");
    expect(await (await fetchH3(fx.port, "/reloaded-route")).text()).toBe("after-reload");
    // graceful stop with one slow stream in flight on each transport
    const slow2 = request(session, { ":path": "/slow?ms=300" });
    const slow3 = fetchH3(fx.port, "/slow?ms=300").then(r => r.text());
    expect((await request(session, { ":path": "/stop" })).body.toString()).toBe("stopping");
    expect((await slow2).body.toString()).toBe("slow");
    expect(await slow3).toBe("slow");
    await new Promise<void>(r => session.once("close", () => r()));
  }, 30000);

  test("http1: false with both h2 and h3", async () => {
    await using fx = await startFixture({ tls: true, http3: true, http1: false });
    const session = await connectH2(fx.port, true);
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
    expect(await (await fetchH3(fx.port, "/hello")).text()).toBe("hello");
    const h1 = await fetch(`https://127.0.0.1:${fx.port}/hello`, { tls: { rejectUnauthorized: false } }).then(
      r => "status:" + r.status,
      e => "error",
    );
    expect(h1).toBe("error");
    session.close();
  });
});

describe("Bun.serve http2 lifecycle", () => {
  test("graceful stop: GOAWAY, in-flight stream completes, process exits", async () => {
    await using fx = await startFixture({ tls: true });
    const session = await connectH2(fx.port, true);
    const goaway = new Promise<number>(resolve => session.on("goaway", code => resolve(code)));
    const slow = request(session, { ":path": "/slow?ms=200" });
    await request(session, { ":path": "/hello" });
    const stopped = await request(session, { ":path": "/stop" });
    expect(stopped.body.toString()).toBe("stopping");
    expect(await goaway).toBe(0);
    expect((await slow).body.toString()).toBe("slow");
    // No new streams are accepted after GOAWAY; the server closes the drained connection.
    await new Promise<void>(r => (session.closed ? r() : session.once("close", () => r())));
  });

  test("idleTimeout closes a silent connection; server.timeout(req, 0) exempts it", async () => {
    // usockets ticks timeouts in 4 s steps, so this test needs real seconds.
    await using fx = await startFixture({ tls: false, idleTimeout: 2 });
    const idle = await connectH2(fx.port, false);
    const idleClosed = new Promise<void>(r => idle.once("close", () => r()));
    const busy = await connectH2(fx.port, false);
    const kept = request(busy, { ":path": "/keepalive?ms=9000" });
    await idleClosed;
    expect((await kept).body.toString()).toBe("kept");
    expect(fx.stderr()).not.toContain("KEEPALIVE-ABORTED");
    busy.close();
  }, 30000);

  test("graceful stop closes a connection whose last stream ends outside a socket event", async () => {
    await using fx = await startFixture({ tls: false });
    const session = await connectH2(fx.port, false);
    const closed = new Promise<void>(r => session.once("close", () => r()));
    const slow = request(session, { ":path": "/slow?ms=300" });
    expect((await request(session, { ":path": "/stop" })).body.toString()).toBe("stopping");
    expect((await slow).body.toString()).toBe("slow");
    // The timer-resolved response retired the last stream from a JS callback;
    // the server must still notice the drained GOAWAY'd connection and close it.
    await closed;
  });

  test("graceful stop: GOAWAY carries the last processed stream id; later streams get nothing and their DATA is tolerated", async () => {
    await using fx = await startFixture({ tls: false });
    const raw = await RawH2.connect(fx.port, false);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/slow?ms=300"));
    raw.headers(3, baseHeaders("/stop"));
    const g = await raw.goaway();
    expect(g.code).toBe(0);
    expect(g.lastStreamId).toBe(3);
    raw.headers(5, baseHeaders("/echo", "POST"), F.END_HEADERS);
    raw.write(frame(T.DATA, 0, 5, Buffer.alloc(16384)));
    raw.write(frame(T.DATA, F.END_STREAM, 5, Buffer.alloc(16384)));
    expect((await raw.body(3)).toString()).toBe("stopping");
    expect((await raw.body(1)).toString()).toBe("slow");
    await raw.waitForClose();
    expect(raw.frames.some(f => f.streamId === 5)).toBe(false);
    expect(raw.frames.filter(f => f.type === T.GOAWAY).every(f => f.payload.readUInt32BE(4) === 0)).toBe(true);
    raw.close();
  });

  test("a paused (slowly read) request body does not idle out the connection", async () => {
    // usockets ticks timeouts in 4 s steps, so this needs real seconds.
    await using fx = await startFixture({
      tls: false,
      idleTimeout: 2,
      extra: `routes: { "/slow-read": async req => { let n = 0; for await (const c of req.body) { n += c.length; await Bun.sleep(700); } return new Response(String(n)); } },`,
    });
    const session = await connectH2(fx.port, false);
    const res = await new Promise<H2Result>((resolve, reject) => {
      const r = session.request({ ":path": "/slow-read", ":method": "POST" }, { endStream: false });
      const chunks: Buffer[] = [];
      let headers: http2.IncomingHttpHeaders = {};
      r.on("response", h => (headers = h));
      r.on("data", c => chunks.push(c));
      r.on("end", () => resolve({ status: Number(headers[":status"]), headers, body: Buffer.concat(chunks) }));
      r.on("error", reject);
      // 12 × 512 KB; at 700 ms per delivered chunk the stream sits paused
      // (window closed) for well over idleTimeout in total.
      let i = 0;
      const next = () => (i++ < 12 ? r.write(Buffer.alloc(512 * 1024), next) : r.end());
      next();
    });
    expect(res.body.toString()).toBe(String(12 * 512 * 1024));
    session.close();
  }, 40000);

  test("PINGs do not keep a connection alive whose streams are all stalled at a zero window", async () => {
    await using fx = await startFixture({ tls: false, idleTimeout: 2 });
    const raw = await RawH2.connect(fx.port, false, { settings: Buffer.from([0, 4, 0, 0, 0, 0]) }); // INITIAL_WINDOW_SIZE = 0
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    for (let i = 0, id = 1; i < 8; i++, id += 2) raw.headers(id, baseHeaders("/big"));
    await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 15);
    const pinger = setInterval(() => !raw.closed && raw.write(frame(T.PING, 0, 0, Buffer.from("keepaliv"))), 500);
    try {
      await raw.waitForClose();
    } finally {
      clearInterval(pinger);
    }
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(true);
    raw.close();
  }, 30000);

  test("--max-http-header-size applies to h2 like HTTP/1.1", async () => {
    await using fx = await startFixture({ tls: false, execArgv: ["--max-http-header-size=4096"] });
    const big = Buffer.alloc(8192, "c").toString();
    const h1 = await fetch(`http://127.0.0.1:${fx.port}/hello`, { headers: { "x-big": big } });
    expect(h1.status).toBe(431);
    const raw = await RawH2.connect(fx.port, false);
    raw.headers(1, [...baseHeaders("/hello"), ["x-big", big]]);
    const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(decodeStatus(h.payload)).toBe(431);
    raw.headers(3, baseHeaders("/hello"));
    expect((await raw.body(3)).toString()).toBe("hello");
    raw.close();
  });

  test("stop(true) sends GOAWAY before closing", async () => {
    const fx = await startFixture({ tls: false });
    const raw = await RawH2.connect(fx.port, false);
    await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
    raw.headers(1, baseHeaders("/abort"));
    await new Promise<void>(r => setImmediate(r));
    fx.proc.stdin.end();
    await raw.waitForClose();
    expect(raw.frames.some(f => f.type === T.GOAWAY)).toBe(true);
    await fx.proc.exited;
    raw.close();
  });

  test("idle timer is re-armed after a request that was exempted from it", async () => {
    await using fx = await startFixture({ tls: false, idleTimeout: 2 });
    const session = await connectH2(fx.port, false);
    const closed = new Promise<number>(r => session.once("close", () => r(Date.now())));
    // /keepalive sets server.timeout(req, 0) for its duration; once it's done the
    // connection's idle timeout must apply again.
    expect((await request(session, { ":path": "/keepalive?ms=5000" })).body.toString()).toBe("kept");
    const tDone = Date.now();
    expect((await closed) - tDone).toBeLessThan(15000);
  }, 40000);

  test("h2 is not negotiated below TLS 1.2; a TLS 1.2 client offering only ECDHE-RSA-AES128-GCM-SHA256 works", async () => {
    await using fx = await startFixture({ tls: true });
    const old = await new Promise<string>(resolve => {
      const s = tls.connect(
        {
          port: fx.port,
          host: "127.0.0.1",
          maxVersion: "TLSv1.1",
          minVersion: "TLSv1",
          ALPNProtocols: ["h2"],
          rejectUnauthorized: false,
        },
        () => resolve("connected:" + s.alpnProtocol),
      );
      s.on("error", e => resolve("error"));
    });
    expect(old).toBe("error");
    const sock = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const s = tls.connect(
        {
          port: fx.port,
          host: "127.0.0.1",
          maxVersion: "TLSv1.2",
          ciphers: "ECDHE-RSA-AES128-GCM-SHA256",
          ALPNProtocols: ["h2"],
          rejectUnauthorized: false,
        },
        () => resolve(s),
      );
      s.on("error", reject);
    });
    expect(sock.alpnProtocol).toBe("h2");
    sock.destroy();
  });

  test("stop(true) with open streams aborts them and closes connections", async () => {
    await using fx = await startFixture({ tls: false });
    const session = await connectH2(fx.port, false);
    const pending = request(session, { ":path": "/abort" }).catch(e => e);
    await request(session, { ":path": "/hello" });
    const closed = new Promise<void>(r => session.on("close", () => r()));
    fx.proc.stdin.end();
    await closed;
    // The stream never got a response: node surfaces the abrupt close either
    // as a stream error or as an end with no HEADERS; both have no :status.
    const result = await pending;
    expect(result instanceof Error ? NaN : result.status).toBeNaN();
    await fx.proc.exited;
    expect(fx.stderr()).toContain("ABORTED");
    expect(fx.proc.exitCode).toBe(0);
  });

  test("client disconnect with many open streams", async () => {
    await using fx = await startFixture({ tls: true });
    for (let round = 0; round < 3; round++) {
      const session = await connectH2(fx.port, true);
      for (let i = 0; i < 20; i++) {
        const r = session.request({ ":path": "/abort" });
        r.on("error", () => {});
      }
      await request(session, { ":path": "/hello" });
      session.destroy();
    }
    const session = await connectH2(fx.port, true);
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
    while ((fx.stderr().match(/ABORTED/g) ?? []).length < 60) {
      await request(session, { ":path": "/hello" });
    }
    session.close();
  });

  test("maxRequestBodySize applies without content-length", async () => {
    using dir = tempDir("serve-http2-maxbody", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const server = Bun.serve({
          port: 0, http2: true, maxRequestBodySize: 1000,
          async fetch(req) { try { return new Response(String((await req.arrayBuffer()).byteLength)); } catch (e) { return new Response("too large", { status: 413 }); } },
        });
        console.log(server.port);
        process.stdin.on("end", () => process.exit(0)); process.stdin.resume();`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    let line = "";
    while (!line.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("server exited before printing its port");
      line += new TextDecoder().decode(value);
    }
    const port = Number(line.trim());
    const raw = await RawH2.connect(port, false);
    await raw.waitFor(f => f.type === T.SETTINGS);
    raw.headers(1, baseHeaders("/", "POST"), F.END_HEADERS);
    raw.write(frame(T.DATA, 0, 1, Buffer.alloc(800)));
    raw.write(frame(T.DATA, F.END_STREAM, 1, Buffer.alloc(800)));
    const h = await raw.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(decodeStatus(h.payload)).toBe(413);
    raw.close();
    // Fresh connection so `:status: 413` isn't served from the HPACK dynamic table.
    const raw2 = await RawH2.connect(port, false);
    await raw2.waitFor(f => f.type === T.SETTINGS);
    raw2.headers(1, [...baseHeaders("/", "POST"), ["content-length", "5000"]], F.END_HEADERS);
    const h2 = await raw2.waitFor(f => f.type === T.HEADERS && f.streamId === 1);
    expect(decodeStatus(h2.payload)).toBe(413);
    raw2.close();
    proc.stdin.end();
    await proc.exited;
  });
});

describe("Bun.serve http2 with http1: false", () => {
  test("TLS: h2 works, http/1.1-only ALPN is refused, no-ALPN client gets 505", async () => {
    await using fx = await startFixture({ tls: true, http1: false });
    const session = await connectH2(fx.port, true);
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
    session.close();

    const alpnError = await new Promise<Error | string>(resolve => {
      const s = tls.connect(
        { port: fx.port, host: "127.0.0.1", ALPNProtocols: ["http/1.1"], rejectUnauthorized: false },
        () => resolve("connected:" + s.alpnProtocol),
      );
      s.on("error", e => resolve(e));
    });
    expect(alpnError).toBeInstanceOf(Error);

    const noAlpn = await new Promise<string>((resolve, reject) => {
      const s = tls.connect({ port: fx.port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
        s.write("GET /hello HTTP/1.1\r\nHost: x\r\n\r\n");
      });
      let out = "";
      s.on("data", d => (out += d));
      s.on("close", () => resolve(out));
      s.on("error", reject);
    });
    expect(noAlpn).toStartWith("HTTP/1.1 505 ");
  });

  test("cleartext: preface trickled in 1-3 byte reads is still HTTP/2; a short HTTP/1 first read is replayed", async () => {
    await using fx = await startFixture({ tls: false });
    // h2: "PR", "I", " * H", rest — the first two reads are too short to decide.
    const sock = net.connect(fx.port, "127.0.0.1");
    await new Promise<void>(r => sock.once("connect", () => r()));
    const writeAndFlush = (b: Buffer | string) =>
      new Promise<void>((res, rej) => sock.write(b, e => (e ? rej(e) : setTimeout(res, 20))));
    await writeAndFlush(PREFACE.subarray(0, 2));
    await writeAndFlush(PREFACE.subarray(2, 3));
    await writeAndFlush(PREFACE.subarray(3, 7));
    sock.write(Buffer.concat([PREFACE.subarray(7), frame(T.SETTINGS, 0, 0)]));
    sock.write(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, 1, hpackLiteral(baseHeaders("/hello"))));
    const got = await new Promise<string>(resolve => {
      let buf = Buffer.alloc(0);
      sock.on("data", d => {
        buf = Buffer.concat([buf, d]);
        for (let off = 0; off + 9 <= buf.length; ) {
          const len = buf.readUIntBE(off, 3);
          if (off + 9 + len > buf.length) break;
          if (buf[off + 3] === T.DATA && (buf.readUInt32BE(off + 5) & 0x7fffffff) === 1)
            return resolve(buf.subarray(off + 9, off + 9 + len).toString());
          off += 9 + len;
        }
      });
    });
    expect(got).toBe("hello");
    sock.destroy();

    // HTTP/1: "PR" alone matches the preface prefix and is held; the next read
    // decides against HTTP/2 and both pieces reach the HTTP/1 parser.
    const h1 = net.connect(fx.port, "127.0.0.1");
    await new Promise<void>(r => h1.once("connect", () => r()));
    await new Promise<void>((res, rej) => h1.write("PR", e => (e ? rej(e) : setTimeout(res, 20))));
    h1.write("OPFIND /hello HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    const response = await new Promise<string>(resolve => {
      let out = "";
      h1.on("data", d => (out += d));
      h1.on("close", () => resolve(out));
    });
    expect(response).toStartWith("HTTP/1.1 200 OK\r\n");
    expect(response).toEndWith("hello");
  });

  test("cleartext: prior-knowledge works, HTTP/1.1 gets 505", async () => {
    await using fx = await startFixture({ tls: false, http1: false });
    const session = await connectH2(fx.port, false);
    expect((await request(session, { ":path": "/hello" })).body.toString()).toBe("hello");
    session.close();
    const res = await fetch(`http://127.0.0.1:${fx.port}/hello`);
    expect(res.status).toBe(505);
  });

  test("development server with HTML imports: http2 is ignored, and http1: false is rejected", async () => {
    using dir = tempDir("serve-http2-dev", {
      "index.html": "<!doctype html><script src='./a.js'></script>",
      "a.js": "console.log(1)",
      "serve.ts": `
        import index from "./index.html";
        try {
          Bun.serve({ port: 0, http2: true, http1: process.argv[2] !== "no-h1", development: true, routes: { "/": index }, fetch: () => new Response("x") }).stop();
          console.log("ok");
        } catch (e) { console.log("threw: " + e.message); }
      `,
    });
    for (const [arg, expected] of [
      ["", "ok"],
      [
        "no-h1",
        "threw: http1: false with http2: true is not supported while the development server (HTML imports with HMR) is active",
      ],
    ]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "serve.ts", arg],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe(expected);
      if (arg === "") expect(stderr).toContain("http2: true is ignored");
    }
  });

  test("validation: http1: false alone throws", () => {
    expect(() => Bun.serve({ port: 0, http1: false, fetch: () => new Response("x") })).toThrow(
      "Cannot disable http1 without enabling http2 or http3",
    );
  });
});

describe("Bun.serve http2 over a unix socket", () => {
  test("prior-knowledge h2c", async () => {
    using dir = tempDir("serve-http2-unix", {});
    const sock = join(String(dir), "h2.sock");
    await using server = Bun.serve({
      unix: sock,
      http2: true,
      fetch: req => new Response("unix:" + new URL(req.url).pathname),
    });
    const session = http2.connect("http://localhost", {
      createConnection: () => net.connect(sock) as any,
    });
    await new Promise<void>((resolve, reject) => {
      session.once("connect", () => resolve());
      session.once("error", reject);
    });
    const res = await request(session, { ":path": "/u" });
    expect(res.body.toString()).toBe("unix:/u");
    await new Promise<void>(r => session.close(() => r()));
  });
});

describe("Bun.serve http2 in-process", () => {
  test("routes + fetch, reload, stop", async () => {
    await using server = Bun.serve({
      port: 0,
      http2: true,
      routes: { "/r": new Response("route-v1") },
      fetch: () => new Response("fetch-v1"),
    });
    const session = await connectH2(server.port, false);
    expect((await request(session, { ":path": "/r" })).body.toString()).toBe("route-v1");
    expect((await request(session, { ":path": "/x" })).body.toString()).toBe("fetch-v1");
    server.reload({ routes: { "/r": new Response("route-v2") }, fetch: () => new Response("fetch-v2") });
    expect((await request(session, { ":path": "/r" })).body.toString()).toBe("route-v2");
    expect((await request(session, { ":path": "/x" })).body.toString()).toBe("fetch-v2");
    const closed = new Promise<void>(r => session.once("close", () => r()));
    await server.stop();
    // Graceful stop sent GOAWAY; the idle session is closed by the server.
    await closed;
  });

  test("handler throwing produces 500 over h2", async () => {
    await using server = Bun.serve({
      port: 0,
      http2: true,
      development: false,
      fetch() {
        throw new Error("boom");
      },
      error() {
        return new Response("handled", { status: 555 });
      },
    });
    const session = await connectH2(server.port, false);
    const res = await request(session, { ":path": "/" });
    expect(res.status).toBe(555);
    expect(res.body.toString()).toBe("handled");
    await new Promise<void>(r => session.close(() => r()));
  });

  test("async handler that responds after the client reset the stream", async () => {
    const { promise: gotRequest, resolve: markRequest } = Promise.withResolvers<void>();
    const { promise: release, resolve: doRelease } = Promise.withResolvers<void>();
    let aborted = 0;
    await using server = Bun.serve({
      port: 0,
      http2: true,
      async fetch(req) {
        req.signal.addEventListener("abort", () => aborted++);
        markRequest();
        await release;
        return new Response("late");
      },
    });
    const session = await connectH2(server.port, false);
    const req = session.request({ ":path": "/" });
    req.on("error", () => {});
    await gotRequest;
    req.close(http2.constants.NGHTTP2_CANCEL);
    // Round-trip a PING so the RST_STREAM has been processed.
    while (aborted === 0) {
      await new Promise<void>((resolve, reject) => session.ping((err: any) => (err ? reject(err) : resolve())));
    }
    doRelease();
    // The late Response lands on a dead stream; the connection must survive it.
    await new Promise<void>((resolve, reject) => session.ping((err: any) => (err ? reject(err) : resolve())));
    expect(aborted).toBe(1);
    await new Promise<void>(r => session.close(() => r()));
  });
});
