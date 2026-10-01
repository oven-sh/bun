import { createHash } from "crypto";
import { bunEnv, bunExe, tempDir } from "harness";
import http2 from "node:http2";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

// ─── fixture ────────────────────────────────────────────────────────────────
// One long-lived server per describe block, driven over real sockets. The
// server lives in serve-http2-fixture.ts; it reports its port on stdout and
// stops on stdin EOF.

export type Fixture = {
  port: number;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  stderr: () => string;
  [Symbol.asyncDispose](): Promise<void>;
};

export type FixtureOptions = {
  tls: boolean;
  http1?: boolean;
  http3?: boolean;
  idleTimeout?: number;
  execArgv?: string[];
};

// Not bunRun: that helper ignores stdin and awaits exit, and this server must
// stay up for the whole describe block.
export async function startFixture(opts: FixtureOptions): Promise<Fixture> {
  // The file behind the Bun.file routes. Per fixture, so that no module-level
  // hook has to outlive the test file that first imported this module.
  const dir = tempDir("serve-http2", { "big.bin": Buffer.alloc(3 * 1024 * 1024 + 17, "0123456789") });
  try {
    return await spawnFixture(opts, dir);
  } catch (err) {
    dir[Symbol.dispose]();
    throw err;
  }
}

async function spawnFixture(opts: FixtureOptions, dir: ReturnType<typeof tempDir>): Promise<Fixture> {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      ...(opts.execArgv ?? []),
      join(import.meta.dir, "serve-http2-fixture.ts"),
      "--big-file",
      join(String(dir), "big.bin"),
      "--idle-timeout",
      String(opts.idleTimeout ?? 30),
      ...(opts.tls ? ["--tls"] : []),
      ...(opts.http1 === false ? ["--no-http1"] : []),
      ...(opts.http3 ? ["--http3"] : []),
    ],
    env: bunEnv,
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
      dir[Symbol.dispose]();
    },
  };
}

// ─── node:http2 client helpers ──────────────────────────────────────────────

export function connectH2(
  port: number,
  secure: boolean,
  options: http2.SecureClientSessionOptions = {},
): Promise<http2.ClientHttp2Session> {
  return new Promise((resolve, reject) => {
    const session = http2.connect(`${secure ? "https" : "http"}://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
      ...options,
    });
    session.once("connect", () => resolve(session));
    session.once("error", reject);
  });
}

/** One node:http2 session shared by the tests of a describe block. The server
 * closes a session that sits idle for the fixture's idleTimeout (30 s), and the
 * raw-frame tests between two uses of it can take longer than that on a slow
 * machine, so `get()` reconnects once the previous session is gone. Concurrent
 * callers share one pending connect. */
export class SharedSession {
  #session: http2.ClientHttp2Session | undefined;
  #connecting: Promise<http2.ClientHttp2Session> | undefined;

  constructor(
    private readonly port: number,
    private readonly secure: boolean,
  ) {}

  get(): Promise<http2.ClientHttp2Session> {
    if (this.#connecting) return this.#connecting;
    const current = this.#session;
    if (current && !current.destroyed && !current.closed) return Promise.resolve(current);
    this.#connecting = connectH2(this.port, this.secure).then(
      session => {
        this.#session = session;
        this.#connecting = undefined;
        return session;
      },
      err => {
        this.#connecting = undefined;
        throw err;
      },
    );
    return this.#connecting;
  }

  close() {
    this.#session?.close();
  }
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

export type HpackField = {
  /** Static or dynamic table index when the whole field, or only its name, is indexed. */
  index?: number;
  /** Literal name and value as sent, with their Huffman flags. Absent on a fully indexed field. */
  name?: { huffman: boolean; bytes: Buffer };
  value?: { huffman: boolean; bytes: Buffer };
};

/** Split a header block into its fields (RFC 7541 §6) without decoding them:
 * indexed fields keep their index, literals keep their raw bytes and Huffman
 * flag. Enough to check what bytes the server put on the wire for one header. */
export function hpackFields(block: Buffer): HpackField[] {
  let pos = 0;
  const int = (prefixBits: number) => {
    const max = (1 << prefixBits) - 1;
    let value = block[pos++] & max;
    if (value < max) return value;
    for (let shift = 0; ; shift += 7) {
      const byte = block[pos++];
      value += (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
    }
  };
  const str = () => {
    const huffman = (block[pos] & 0x80) !== 0;
    const length = int(7);
    const bytes = block.subarray(pos, pos + length);
    pos += length;
    return { huffman, bytes };
  };
  const fields: HpackField[] = [];
  while (pos < block.length) {
    const first = block[pos];
    if (first & 0x80) {
      fields.push({ index: int(7) });
      continue;
    }
    if ((first & 0xe0) === 0x20) {
      int(5); // dynamic table size update
      continue;
    }
    const index = int(first & 0x40 ? 6 : 4);
    const field: HpackField = index ? { index } : { name: str() };
    field.value = str();
    fields.push(field);
  }
  return fields;
}

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
