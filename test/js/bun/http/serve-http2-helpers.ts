import { createHash, randomBytes } from "crypto";
import { bunEnv, bunExe, tempDir, tls as tlsCert } from "harness";
import http2 from "node:http2";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

// ─── fixture ────────────────────────────────────────────────────────────────
// One long-lived server per describe block, driven over real sockets. The
// fixture reports its port on stdout and stops on stdin EOF.

export const fixtureSource = (opts: { tls: boolean; http1?: boolean; http3?: boolean; extra?: string }) => `
import { serve } from "bun";
export const big = Buffer.alloc(5 * 1024 * 1024, "abcdefghijklmnop");
export let lateRead;
export const makeRoutes = () => ({
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
export const routes = makeRoutes();
export const server = serve({
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
export async function handler(req, server) {
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

export type Fixture = {
  port: number;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  stderr: () => string;
  [Symbol.asyncDispose](): Promise<void>;
};

export let bigFileDir: ReturnType<typeof tempDir> | undefined;
afterAll(() => bigFileDir?.[Symbol.dispose]());
export function bigFilePath() {
  if (!bigFileDir) {
    bigFileDir = tempDir("serve-http2", { "big.bin": Buffer.alloc(3 * 1024 * 1024 + 17, "0123456789") });
  }
  return join(String(bigFileDir), "big.bin");
}

export async function startFixture(opts: {
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

export function connectH2(port: number, secure: boolean): Promise<http2.ClientHttp2Session> {
  return new Promise((resolve, reject) => {
    const session = http2.connect(`${secure ? "https" : "http"}://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    });
    session.once("connect", () => resolve(session));
    session.once("error", reject);
  });
}

export type H2Result = { status: number; headers: http2.IncomingHttpHeaders; body: Buffer };
export function request(
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

export const sha256 = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

// ─── raw frame client ───────────────────────────────────────────────────────
// For protocol-level assertions node:http2 can't express (malformed frames,
// exact GOAWAY/RST codes, flow-control accounting).

export const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
export const T = {
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
export const F = { END_STREAM: 1, ACK: 1, END_HEADERS: 4, PADDED: 8, PRIORITY: 0x20 };

export function frame(type: number, flags: number, streamId: number, payload: Buffer | Uint8Array = Buffer.alloc(0)) {
  const buf = Buffer.alloc(9 + payload.length);
  buf.writeUIntBE(payload.length, 0, 3);
  buf[3] = type;
  buf[4] = flags;
  buf.writeUInt32BE(streamId & 0x7fffffff, 5);
  Buffer.from(payload).copy(buf, 9);
  return buf;
}

/** HPACK without compression: every field as "literal without indexing, new name". */
export function hpackLiteral(headers: [string, string][]) {
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

export type RawFrame = { type: number; flags: number; streamId: number; payload: Buffer };

export class RawH2 {
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

export const baseHeaders = (path: string, method = "GET"): [string, string][] => [
  [":method", method],
  [":scheme", "https"],
  [":path", path],
  [":authority", "localhost"],
];

/** Just enough HPACK to read the `:status` the server always encodes first:
 * either an indexed static-table entry (200/204/206/304/400/404/500) or a
 * literal with indexed name whose 3-digit value may be Huffman-coded. */
export function decodeStatus(block: Buffer): number {
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
