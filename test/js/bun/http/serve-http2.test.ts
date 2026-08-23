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

const fixtureSource = (opts: { tls: boolean; http1?: boolean; extra?: string }) => `
import { serve } from "bun";
const big = Buffer.alloc(5 * 1024 * 1024, "abcdefghijklmnop");
const server = serve({
  port: 0,
  ${opts.tls ? `tls: ${JSON.stringify(tlsCert)},` : ""}
  http2: true,
  http1: ${opts.http1 ?? true},
  idleTimeout: Number(process.env.IDLE_TIMEOUT ?? 30),
  routes: {
    "/api/:id": req => new Response("id=" + req.params.id, { headers: { "x-route": "api" } }),
    "/route-only": { POST: () => new Response("posted") },
    "/static": new Response("from-static-route", { headers: { "content-type": "text/plain", etag: '"v1"' } }),
    "/file-route": Bun.file(process.env.BIG_FILE),
    "/cookies": req => {
      req.cookies.set("seen", (req.cookies.get("seen") ?? "") + "x");
      return new Response("ok");
    },
  },
  async fetch(req, server) {
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
      case "/ip":
        return Response.json(server.requestIP(req));
      case "/upgrade":
        return new Response(String(server.upgrade(req)), { status: 200 });
      case "/ws":
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400 });
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
  },
  websocket: { message() {} },
  ${opts.extra ?? ""}
});
console.log(JSON.stringify({ port: server.port }));
process.stdin.on("end", () => { server.stop(true); process.stderr.write("", () => process.exit(0)); });
process.stdin.resume();
`;

type Fixture = {
  port: number;
  proc: Bun.Subprocess<"pipe", "pipe", "inherit">;
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
  extra?: string;
  idleTimeout?: number;
}): Promise<Fixture> {
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixtureSource(opts)],
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
      const block = hpackLiteral([...baseHeaders("/headers"), ["x-big", Buffer.alloc(30000, "B").toString()]]);
      raw.write(frame(T.HEADERS, 0, 1, block.subarray(0, 10000)));
      raw.write(frame(T.CONTINUATION, 0, 1, block.subarray(10000, 20000)));
      raw.write(frame(T.CONTINUATION, F.END_HEADERS, 1, block.subarray(20000)));
      // No END_STREAM on HEADERS; finish the (empty) body.
      raw.write(frame(T.DATA, F.END_STREAM, 1));
      expect(JSON.parse((await raw.body(1)).toString()).headers["x-big"]).toHaveLength(30000);
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
      await raw.waitFor(f => f.type === T.SETTINGS && (f.flags & F.ACK) !== 0);
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

      test("header list over the limit → 431 on that stream, connection survives", async () => {
        const raw = await RawH2.connect(fx.port, secure);
        const big = Buffer.alloc(15000, "v").toString();
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
