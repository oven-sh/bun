// HTTP/2 protocol conformance suite (RFC 9113 + extensions).
//
// These tests drive a raw byte-level HTTP/2 client against a Bun `node:http2` h2c server and
// assert spec-mandated behavior at the wire level — the cases Node's own suite under-covers.
// Item numbers reference docs/http2-rewrite/03-spec-conformance-checklist.md.
//
// Connection-level cases only here (no HPACK required): preface, SETTINGS handshake/ack, PING,
// WINDOW_UPDATE, frame-size and stream-id rules. HPACK/HEADERS cases live in a sibling file.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, gcTick, normalizeBunSnapshot } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");

const FrameType = {
  DATA: 0x0,
  HEADERS: 0x1,
  PRIORITY: 0x2,
  RST_STREAM: 0x3,
  SETTINGS: 0x4,
  PUSH_PROMISE: 0x5,
  PING: 0x6,
  GOAWAY: 0x7,
  WINDOW_UPDATE: 0x8,
  CONTINUATION: 0x9,
} as const;

const ErrorCode = {
  NO_ERROR: 0x0,
  PROTOCOL_ERROR: 0x1,
  INTERNAL_ERROR: 0x2,
  FLOW_CONTROL_ERROR: 0x3,
  SETTINGS_TIMEOUT: 0x4,
  STREAM_CLOSED: 0x5,
  FRAME_SIZE_ERROR: 0x6,
  REFUSED_STREAM: 0x7,
  CANCEL: 0x8,
  COMPRESSION_ERROR: 0x9,
} as const;

type Frame = { length: number; type: number; flags: number; streamId: number; payload: Buffer };

function encodeFrame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3); // 24-bit length
  header.writeUInt8(type, 3);
  header.writeUInt8(flags, 4);
  header.writeUInt32BE(streamId & 0x7fffffff, 5); // reserved bit clear
  return Buffer.concat([header, payload]);
}

/** A minimal raw HTTP/2 client: send arbitrary frames, collect parsed inbound frames. */
class RawH2 {
  socket: net.Socket;
  private buf: Buffer = Buffer.alloc(0);
  frames: Frame[] = [];
  closed = false;
  private waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];

  constructor(port: number) {
    this.socket = net.connect(port, "127.0.0.1");
    this.socket.on("data", d => this.onData(d));
    this.socket.on("close", () => (this.closed = true));
    this.socket.on("error", () => {});
  }

  static async connect(port: number): Promise<RawH2> {
    const c = new RawH2(port);
    await once(c.socket, "connect");
    return c;
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 9) {
      const length = this.buf.readUIntBE(0, 3);
      if (this.buf.length < 9 + length) break;
      const frame: Frame = {
        length,
        type: this.buf.readUInt8(3),
        flags: this.buf.readUInt8(4),
        streamId: this.buf.readUInt32BE(5) & 0x7fffffff,
        payload: this.buf.subarray(9, 9 + length),
      };
      this.buf = this.buf.subarray(9 + length);
      this.frames.push(frame);
      const idx = this.waiters.findIndex(w => w.pred(frame));
      if (idx !== -1) this.waiters.splice(idx, 1)[0].resolve(frame);
    }
  }

  send(buf: Buffer) {
    this.socket.write(buf);
  }
  sendPreface() {
    this.send(PREFACE);
  }
  sendFrame(type: number, flags: number, streamId: number, payload?: Buffer) {
    this.send(encodeFrame(type, flags, streamId, payload));
  }
  sendEmptySettings() {
    this.sendFrame(FrameType.SETTINGS, 0, 0);
  }
  sendSettingsAck() {
    this.sendFrame(FrameType.SETTINGS, 0x1, 0);
  }

  /** Wait for the first inbound frame matching `pred` (also checks already-received frames). */
  waitFor(pred: (f: Frame) => boolean, timeoutMs = 2000): Promise<Frame> {
    const existing = this.frames.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      const t = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(new Error("timed out waiting for frame"));
      }, timeoutMs);
      const orig = w.resolve;
      w.resolve = f => {
        clearTimeout(t);
        orig(f);
      };
    });
  }

  waitForGoaway(timeoutMs = 2000) {
    return this.waitFor(f => f.type === FrameType.GOAWAY, timeoutMs);
  }
  /** Wait until the connection is closed by the peer. */
  waitClosed(timeoutMs = 2000): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("connection did not close")), timeoutMs);
      this.socket.once("close", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  destroy() {
    this.socket.destroy();
  }
}

function goawayErrorCode(f: Frame): number {
  // GOAWAY payload: 4-byte last-stream-id + 4-byte error code + debug data.
  return f.payload.readUInt32BE(4);
}

let server: http2.Http2Server;
let port: number;

beforeAll(async () => {
  server = http2.createServer();
  server.on("stream", (stream: any) => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  server.listen(0);
  await once(server, "listening");
  port = (server.address() as net.AddressInfo).port;
});

afterAll(() => {
  server?.close();
});

describe("connection preface & SETTINGS handshake (checklist §1)", () => {
  test("server sends a SETTINGS frame first (§1.4)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    const settings = await c.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0);
    expect(settings.streamId).toBe(0);
    expect(settings.length % 6).toBe(0);
    c.destroy();
  });

  test("server ACKs the client's SETTINGS frame (§3.5)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    const ack = await c.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 1);
    expect(ack.length).toBe(0);
    expect(ack.streamId).toBe(0);
    c.destroy();
  });

  test("a SETTINGS frame with a non-zero stream id is a PROTOCOL_ERROR (§3.5)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.SETTINGS, 0, 1); // illegal: SETTINGS on stream 1
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.PROTOCOL_ERROR);
    c.destroy();
  });

  test("a SETTINGS frame whose length is not a multiple of 6 is a FRAME_SIZE_ERROR (§3.5)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.SETTINGS, 0, 0, Buffer.alloc(5)); // 5 is not a multiple of 6
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.FRAME_SIZE_ERROR);
    c.destroy();
  });

  test("a SETTINGS ACK that carries a payload is a FRAME_SIZE_ERROR (§3.5)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.SETTINGS, 0x1, 0, Buffer.alloc(6)); // ACK must be empty
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.FRAME_SIZE_ERROR);
    c.destroy();
  });
});

describe("PING (checklist §3.7)", () => {
  test("server replies to PING with a PING ACK echoing the payload", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    const opaque = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    c.sendFrame(FrameType.PING, 0, 0, opaque);
    const ack = await c.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) === 1);
    expect(ack.length).toBe(8);
    expect(Buffer.compare(ack.payload, opaque)).toBe(0);
    c.destroy();
  });

  test("a PING with length != 8 is a FRAME_SIZE_ERROR", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(6));
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.FRAME_SIZE_ERROR);
    c.destroy();
  });

  test("a PING on a non-zero stream id is a PROTOCOL_ERROR", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.PING, 0, 3, Buffer.alloc(8));
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.PROTOCOL_ERROR);
    c.destroy();
  });
});

describe("WINDOW_UPDATE (checklist §6)", () => {
  test("a connection-level WINDOW_UPDATE with a 0 increment is a PROTOCOL_ERROR", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    const inc = Buffer.alloc(4); // 0
    c.sendFrame(FrameType.WINDOW_UPDATE, 0, 0, inc);
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.PROTOCOL_ERROR);
    c.destroy();
  });

  test("a WINDOW_UPDATE with length != 4 is a FRAME_SIZE_ERROR", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.WINDOW_UPDATE, 0, 0, Buffer.alloc(3));
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.FRAME_SIZE_ERROR);
    c.destroy();
  });
});

describe("frame structure (checklist §2,§3)", () => {
  test("an unknown frame type is ignored, not an error (§2.4)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    // Send an unknown frame type (0xEF) then a valid PING; expect the PING ACK to arrive,
    // proving the unknown frame was discarded rather than killing the connection.
    c.sendFrame(0xef, 0, 0, Buffer.from([9, 9, 9]));
    const opaque = Buffer.from([8, 7, 6, 5, 4, 3, 2, 1]);
    c.sendFrame(FrameType.PING, 0, 0, opaque);
    const ack = await c.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) === 1);
    expect(Buffer.compare(ack.payload, opaque)).toBe(0);
    c.destroy();
  });

  test("RST_STREAM on an idle stream is a PROTOCOL_ERROR (§4)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    const code = Buffer.alloc(4);
    code.writeUInt32BE(ErrorCode.CANCEL, 0);
    c.sendFrame(FrameType.RST_STREAM, 0, 1, code); // stream 1 was never opened
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.PROTOCOL_ERROR);
    c.destroy();
  });
});

describe("stream-id rules (checklist §3)", () => {
  test("HEADERS on stream 0 is a PROTOCOL_ERROR (§6.2)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 0, Buffer.from([0x82]));
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.PROTOCOL_ERROR);
    c.destroy();
  });

  test("DATA on stream 0 is a PROTOCOL_ERROR (§6.1)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.DATA, 0, 0, Buffer.from("x"));
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.PROTOCOL_ERROR);
    c.destroy();
  });
});

describe("fixed-length frames (checklist §3)", () => {
  test("PRIORITY with length != 5 is a FRAME_SIZE_ERROR (§6.3)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.PRIORITY, 0, 1, Buffer.alloc(4)); // must be 5
    // RFC 9113 §6.3 would allow a per-stream RST_STREAM here, but nghttp2 (and therefore
    // node) treats a wrong-length PRIORITY as a connection error - verified against node
    // v26.3.0 - and we match that: the connection answers with GOAWAY(FRAME_SIZE_ERROR).
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.FRAME_SIZE_ERROR);
    c.destroy();
  });

  test("RST_STREAM with length != 4 is a FRAME_SIZE_ERROR (§6.4)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.RST_STREAM, 0, 1, Buffer.alloc(3));
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.FRAME_SIZE_ERROR);
    c.destroy();
  });
});

describe("CONTINUATION (checklist §3,§7)", () => {
  test("CONTINUATION without a preceding HEADERS is a PROTOCOL_ERROR (§6.10)", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.CONTINUATION, 0x4, 1, Buffer.from([0x82]));
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.PROTOCOL_ERROR);
    c.destroy();
  });
});

describe("SETTINGS value ranges (checklist §6.5.2)", () => {
  function settingsPayload(id: number, value: number): Buffer {
    const b = Buffer.alloc(6);
    b.writeUInt16BE(id, 0);
    b.writeUInt32BE(value >>> 0, 2);
    return b;
  }

  test("ENABLE_PUSH with a value other than 0/1 is a PROTOCOL_ERROR", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.SETTINGS, 0, 0, settingsPayload(0x2, 2)); // ENABLE_PUSH = 2
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.PROTOCOL_ERROR);
    c.destroy();
  });

  test("MAX_FRAME_SIZE below 2^14 is a PROTOCOL_ERROR", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.SETTINGS, 0, 0, settingsPayload(0x5, 1000)); // < 16384
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.PROTOCOL_ERROR);
    c.destroy();
  });

  test("INITIAL_WINDOW_SIZE above 2^31-1 is a FLOW_CONTROL_ERROR", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.SETTINGS, 0, 0, settingsPayload(0x4, 0x80000000)); // 2^31
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.FLOW_CONTROL_ERROR);
    c.destroy();
  });
});

describe("frame size limit (checklist §4.2)", () => {
  test("a frame exceeding SETTINGS_MAX_FRAME_SIZE is a FRAME_SIZE_ERROR", async () => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    // Claim a HEADERS frame larger than the default 16384 max frame size.
    const oversized = Buffer.alloc(16385, 0);
    c.sendFrame(FrameType.HEADERS, 0x4, 1, oversized);
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.FRAME_SIZE_ERROR);
    c.destroy();
  });
});

// RFC 9113 §10.5.1: a request whose header list exceeds SETTINGS_MAX_HEADER_LIST_SIZE is a
// per-stream error, not a connection error, and must not kill the server process. Spawned as a
// subprocess because the bug was an uncatchable 'error' on a stream user code never received.
describe.concurrent("header list size limit (RFC 9113 §10.5.1)", () => {
  for (const [label, headerCount, expectProbe, expectRst1, expectSessionError] of [
    // ~72 KiB of well-formed headers: over the default 65535 limit, under the hard DoS cap.
    // Stream 1 is RST_STREAM(ENHANCE_YOUR_CALM); the connection survives and serves stream 3.
    ["RST_STREAMs an oversized header list and keeps the connection alive", 24, true, true, false],
    // ~150 KiB: past the hard DoS cap. Connection is torn down (GOAWAY ENHANCE_YOUR_CALM) with a
    // catchable session error; the process must still survive.
    ["GOAWAYs a header block past the hard cap without crashing", 50, false, false, true],
  ] as const) {
    test(`server ${label}`, async () => {
      const fixture = `
        const http2 = require("node:http2");
        const net = require("node:net");
        const srv = http2.createServer();
        const events = [];
        srv.on("error", e => events.push("server-error:" + e.code));
        srv.on("sessionError", e => events.push("sessionError:" + e.code));
        srv.on("session", s => s.on("error", e => events.push("session-error:" + e.code)));
        srv.on("stream", (st, h) => {
          st.on("error", e => events.push("stream-error:" + e.code));
          events.push("REQ:" + h[":path"]);
          st.respond({ ":status": 200 });
          st.end("k");
        });
        const fr = (t, f, sid, pl) => { const b = Buffer.alloc(9 + pl.length); b.writeUIntBE(pl.length, 0, 3); b[3] = t; b[4] = f; b.writeUInt32BE(sid, 5); pl.copy(b, 9); return b; };
        const hint = (head, p, v) => { const m = (1 << p) - 1; if (v < m) return Buffer.from([head | v]); const o = [head | m]; v -= m; while (v >= 128) { o.push((v & 0x7f) | 0x80); v >>= 7; } o.push(v); return Buffer.from(o); };
        const hstr = s => { const b = Buffer.from(s); return Buffer.concat([hint(0, 7, b.length), b]); };
        const lit = (n, v) => Buffer.concat([Buffer.from([0x00]), hstr(n), hstr(v)]);
        const block = (path, extra) => Buffer.concat([Buffer.from([0x82, 0x86]), lit(":path", path), lit(":authority", "h"), ...extra.map(([k, v]) => lit(k, v))]);
        srv.listen(0, "127.0.0.1", () => {
          const port = srv.address().port;
          const big = block("/big", Array.from({ length: ${headerCount} }, (_, i) => ["x-" + i, Buffer.alloc(3000, "Q").toString()]));
          const frames = [];
          for (let o = 0; o < big.length; o += 16000) {
            const last = o + 16000 >= big.length;
            frames.push(fr(o === 0 ? 1 : 9, (last ? 4 : 0) | (o === 0 ? 1 : 0), 1, big.subarray(o, o + 16000)));
          }
          const sock = net.connect(port, "127.0.0.1", () => {
            sock.write(Buffer.concat([Buffer.from("PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n", "binary"), fr(4, 0, 0, Buffer.alloc(0)), ...frames]));
          });
          sock.on("error", () => {});
          let raw = Buffer.alloc(0);
          let probed = false;
          let done = false;
          const scan = () => {
            let p = 0, probeOk = false, goaway = -1, rst1 = -1, verdict = false;
            while (p + 9 <= raw.length) {
              const l = raw.readUIntBE(p, 3), t = raw[p + 3], sid = raw.readUInt32BE(p + 5) & 0x7fffffff;
              if (p + 9 + l > raw.length) break;
              if (t === 1 && sid === 3) probeOk = true;
              if (t === 7) { goaway = raw.readUInt32BE(p + 13); verdict = true; }
              if (t === 3 && sid === 1) { rst1 = raw.readUInt32BE(p + 9); verdict = true; }
              p += 9 + l;
            }
            return { probeOk, goaway, rst1, verdict };
          };
          const finish = () => {
            if (done) return;
            done = true;
            const { probeOk, goaway, rst1 } = scan();
            console.log(JSON.stringify({ events, probeOk, goaway, rst1 }));
            process.exit(0);
          };
          sock.on("data", d => {
            raw = Buffer.concat([raw, d]);
            const s = scan();
            // Send the probe only after the server's verdict on stream 1.
            if (!probed && s.verdict) {
              probed = true;
              try { sock.write(fr(1, 5, 3, block("/probe", []))); } catch {}
            }
            // Done once the probe is answered, or once a GOAWAY arrived (connection is over).
            if (probed && (s.probeOk || s.goaway !== -1)) finish();
          });
          sock.on("close", finish);
        });
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("ERR_HTTP2_STREAM_ERROR");
      const out = JSON.parse(stdout.trim());
      if (expectRst1) {
        expect(out.rst1).toBe(http2.constants.NGHTTP2_ENHANCE_YOUR_CALM);
      }
      if (expectProbe) {
        expect(out.events).toContain("REQ:/probe");
      } else {
        expect(out.events).not.toContain("REQ:/big");
      }
      if (expectSessionError) {
        expect(out.goaway).toBe(http2.constants.NGHTTP2_ENHANCE_YOUR_CALM);
        expect(out.events).toContain("sessionError:ERR_HTTP2_SESSION_ERROR");
      } else {
        expect(out.goaway).toBe(-1);
        expect(out.events).not.toContain("sessionError:ERR_HTTP2_SESSION_ERROR");
      }
      expect(exitCode).toBe(0);
    });
  }
});

// ── Client-side conformance: a raw byte-level HTTP/2 *server* drives a Bun `node:http2`
// client and asserts the client's wire behavior (push stream states, SETTINGS ack ordering).

/** A minimal raw HTTP/2 server: accept one connection, collect parsed inbound frames. */
class RawH2Server {
  server: net.Server;
  socket: net.Socket | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private sawPreface = false;
  frames: Frame[] = [];
  private waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];

  private constructor(server: net.Server) {
    this.server = server;
  }

  static async listen(): Promise<RawH2Server> {
    const server = net.createServer();
    const s = new RawH2Server(server);
    server.on("connection", socket => {
      s.socket = socket;
      socket.on("data", d => s.onData(d));
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return s;
  }

  get port(): number {
    return (this.server.address() as net.AddressInfo).port;
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    if (!this.sawPreface) {
      if (this.buf.length < PREFACE.length) return;
      this.buf = this.buf.subarray(PREFACE.length);
      this.sawPreface = true;
    }
    while (this.buf.length >= 9) {
      const length = this.buf.readUIntBE(0, 3);
      if (this.buf.length < 9 + length) break;
      const frame: Frame = {
        length,
        type: this.buf.readUInt8(3),
        flags: this.buf.readUInt8(4),
        streamId: this.buf.readUInt32BE(5) & 0x7fffffff,
        payload: this.buf.subarray(9, 9 + length),
      };
      this.buf = this.buf.subarray(9 + length);
      this.frames.push(frame);
      const idx = this.waiters.findIndex(w => w.pred(frame));
      if (idx !== -1) this.waiters.splice(idx, 1)[0].resolve(frame);
    }
  }

  sendFrame(type: number, flags: number, streamId: number, payload?: Buffer) {
    this.socket!.write(encodeFrame(type, flags, streamId, payload));
  }

  waitFor(pred: (f: Frame) => boolean, timeoutMs = 2000): Promise<Frame> {
    const existing = this.frames.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      const t = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(new Error("timed out waiting for frame"));
      }, timeoutMs);
      const orig = w.resolve;
      w.resolve = f => {
        clearTimeout(t);
        orig(f);
      };
    });
  }

  close() {
    this.socket?.destroy();
    this.server.close();
  }
}

/** HPACK string literal: 7-bit length prefix, no Huffman coding. */
function hpackLiteral(str: string): Buffer {
  const bytes = Buffer.from(str, "latin1");
  return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}

describe("push stream states (checklist §5.1, RFC 9113 §6.4/§8.4)", () => {
  test("DATA on a promised stream before its response HEADERS is refused, not delivered", async () => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    const pushedData: Buffer[] = [];
    client.on("stream", pushed => {
      pushed.on("error", () => {});
      pushed.on("data", (d: Buffer) => pushedData.push(d));
    });
    try {
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      raw.sendFrame(FrameType.SETTINGS, 0, 0); // server SETTINGS
      raw.sendFrame(FrameType.SETTINGS, 0x1, 0); // ACK the client's
      // PUSH_PROMISE on stream 1 reserving stream 2: [:method GET, :scheme http, :path /,
      // :authority localhost] - static-table indexed fields plus one literal, no dynamic table.
      const promised = Buffer.alloc(4);
      promised.writeUInt32BE(2, 0);
      const block = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01]), hpackLiteral("localhost")]);
      raw.sendFrame(FrameType.PUSH_PROMISE, 0x4 /* END_HEADERS */, 1, Buffer.concat([promised, block]));
      // DATA on the promised stream while it is still reserved (remote) - §5.1 forbids this
      // before the pushed response HEADERS.
      raw.sendFrame(FrameType.DATA, 0, 2, Buffer.from("x"));
      const rst = await raw.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 2);
      expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.STREAM_CLOSED);
      // The payload never reaches the pushed stream, and the connection survives.
      raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
      await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0);
      expect(Buffer.concat(pushedData).length).toBe(0);
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

describe("SETTINGS ack ordering (RFC 9113 §6.5.3)", () => {
  test("an ACK applies to the oldest outstanding SETTINGS, not the latest submission", async () => {
    const raw = await RawH2Server.listen();
    // SETTINGS #1 advertises a 100-byte initial window; SETTINGS #2 shrinks it to 50 before
    // #1 is ACKed. After the server ACKs #1 it may legitimately send up to 100 bytes - the
    // client must not enforce #2's 50 until the second ACK arrives.
    const client = http2.connect(`http://127.0.0.1:${raw.port}`, { settings: { initialWindowSize: 100 } });
    client.on("error", () => {});
    try {
      client.settings({ initialWindowSize: 50 });
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      const chunks: Buffer[] = [];
      req.on("data", (d: Buffer) => chunks.push(d));
      const ended = new Promise<void>(resolve => req.on("end", resolve));

      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      // Both client SETTINGS frames precede the request HEADERS on the wire.
      const settingsFrames = raw.frames.filter(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0);
      expect(settingsFrames.length).toBe(2);
      raw.sendFrame(FrameType.SETTINGS, 0, 0); // server SETTINGS
      raw.sendFrame(FrameType.SETTINGS, 0x1, 0); // ACK SETTINGS #1 (window 100)
      // Response HEADERS (:status 200, static index 8) + 80 bytes of DATA: legal against the
      // ACKed 100-byte window, illegal against #2's still-unACKed 50.
      raw.sendFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 1, Buffer.from([0x88]));
      raw.sendFrame(FrameType.DATA, 0x1 /* END_STREAM */, 1, Buffer.alloc(80, 0x61));
      await ended;
      expect(Buffer.concat(chunks).length).toBe(80);
      // No flow-control reset went out for stream 1.
      const rst = raw.frames.find(f => f.type === FrameType.RST_STREAM && f.streamId === 1);
      expect(rst).toBeUndefined();
      raw.sendFrame(FrameType.SETTINGS, 0x1, 0); // ACK SETTINGS #2 (window 50)
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

function requestHeaderBlock(method: "GET" | "POST", extra: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([
    Buffer.from([method === "POST" ? 0x83 : 0x82, 0x86, 0x84, 0x01]),
    hpackLiteral("localhost"),
    extra,
  ]);
}

const CONTENT_LENGTH_5 = Buffer.concat([Buffer.from([0x0f, 0x0d]), hpackLiteral("5")]);

describe("request header and body framing (RFC 9113 §8.1)", () => {
  let deferredServer: http2.Http2Server;
  let deferredPort: number;

  beforeAll(async () => {
    deferredServer = http2.createServer();
    deferredServer.on("stream", (stream: any) => {
      stream.on("error", () => {});
      stream.on("end", () => {
        stream.respond({ ":status": 200 });
        stream.end("ok");
      });
      stream.resume();
    });
    deferredServer.listen(0);
    await once(deferredServer, "listening");
    deferredPort = (deferredServer.address() as net.AddressInfo).port;
  });

  afterAll(() => {
    deferredServer?.close();
  });

  async function expectStreamRejected(send: (c: RawH2) => void) {
    const c = await RawH2.connect(deferredPort);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      send(c);
      const rst = await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 1);
      expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.PROTOCOL_ERROR);
      expect(c.frames.find(f => f.type === FrameType.HEADERS && f.streamId === 1)).toBeUndefined();
    } finally {
      c.destroy();
    }
  }

  test("a trailing header block carrying a pseudo-header is a stream PROTOCOL_ERROR", async () => {
    await expectStreamRejected(c => {
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
      c.sendFrame(FrameType.HEADERS, 0x5, 1, Buffer.concat([Buffer.from([0x01]), hpackLiteral("other.example")]));
    });
  });

  test("a trailing header block without END_STREAM is a stream PROTOCOL_ERROR", async () => {
    await expectStreamRejected(c => {
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
      c.sendFrame(
        FrameType.HEADERS,
        0x4,
        1,
        Buffer.concat([Buffer.from([0x00]), hpackLiteral("x-after"), hpackLiteral("1")]),
      );
    });
  });

  test("a request declaring a content-length with an empty body is a stream PROTOCOL_ERROR", async () => {
    await expectStreamRejected(c => {
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("POST", CONTENT_LENGTH_5));
    });
  });

  test("a request body shorter than its declared content-length is a stream PROTOCOL_ERROR", async () => {
    await expectStreamRejected(c => {
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST", CONTENT_LENGTH_5));
      c.sendFrame(FrameType.DATA, 0x1, 1, Buffer.from("ab"));
    });
  });

  test("a request body longer than its declared content-length is a stream PROTOCOL_ERROR", async () => {
    await expectStreamRejected(c => {
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST", CONTENT_LENGTH_5));
      c.sendFrame(FrameType.DATA, 0x1, 1, Buffer.from("abcdefg"));
    });
  });

  test("a duplicate content-length field is a stream PROTOCOL_ERROR", async () => {
    await expectStreamRejected(c => {
      c.sendFrame(
        FrameType.HEADERS,
        0x5,
        1,
        requestHeaderBlock("POST", Buffer.concat([CONTENT_LENGTH_5, CONTENT_LENGTH_5])),
      );
    });
  });

  test("a request body matching its declared content-length is delivered while a longer one is reset", async () => {
    const c = await RawH2.connect(deferredPort);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST", CONTENT_LENGTH_5));
      c.sendFrame(FrameType.DATA, 0x1, 1, Buffer.from("abcde"));
      c.sendFrame(FrameType.HEADERS, 0x4, 3, requestHeaderBlock("POST", CONTENT_LENGTH_5));
      c.sendFrame(FrameType.DATA, 0x1, 3, Buffer.from("abcdefg"));
      const headers = await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      expect(headers.streamId).toBe(1);
      const rst = await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 3);
      expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.PROTOCOL_ERROR);
      expect(c.frames.find(f => f.type === FrameType.RST_STREAM && f.streamId === 1)).toBeUndefined();
      expect(c.frames.find(f => f.type === FrameType.HEADERS && f.streamId === 3)).toBeUndefined();
    } finally {
      c.destroy();
    }
  });
});

describe("inbound stream lifecycle", () => {
  test("releases server stream objects once the peer resets their streams", async () => {
    const total = 32;
    const refs: WeakRef<object>[] = [];
    let closedCount = 0;
    const allOpen = Promise.withResolvers<void>();
    const allClosed = Promise.withResolvers<void>();
    const server = http2.createServer();
    server.on("stream", (stream: any) => {
      refs.push(new WeakRef(stream));
      stream.on("error", () => {});
      stream.on("close", () => {
        if (++closedCount === total) allClosed.resolve();
      });
      stream.resume();
      if (refs.length === total) allOpen.resolve();
    });
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      for (let i = 0; i < total; i++) {
        c.sendFrame(FrameType.HEADERS, 0x4, 1 + 2 * i, requestHeaderBlock("POST"));
      }
      await allOpen.promise;
      const cancel = Buffer.alloc(4);
      cancel.writeUInt32BE(ErrorCode.CANCEL, 0);
      for (let i = 0; i < total; i++) {
        c.sendFrame(FrameType.RST_STREAM, 0, 1 + 2 * i, cancel);
      }
      await allClosed.promise;
      for (let i = 0; i < 20 && refs.some(ref => ref.deref() !== undefined); i++) {
        await gcTick(true);
      }
      expect(refs.filter(ref => ref.deref() !== undefined).length).toBe(0);
    } finally {
      c.destroy();
      server.close();
    }
  });

  // A header-value `toString` runs user JS while sendTrailers holds the native `&mut Stream`;
  // feeding the stream's own RST_STREAM (then another read) back into the parser from that
  // callback must not free the Stream out from under the caller (use-after-free under ASAN).
  test("re-entrant read() from a trailer-value toString does not free the in-use stream", async () => {
    const fixture = String.raw`
      const http2 = require("node:http2");
      const { Duplex } = require("node:stream");
      function encodeFrame(type, flags, streamId, payload = Buffer.alloc(0)) {
        const header = Buffer.alloc(9);
        header.writeUIntBE(payload.length, 0, 3);
        header.writeUInt8(type, 3);
        header.writeUInt8(flags, 4);
        header.writeUInt32BE(streamId & 0x7fffffff, 5);
        return Buffer.concat([header, payload]);
      }
      // JS-fed duplex: bytes push()ed here reach the parser's read() synchronously.
      class FakeSocket extends Duplex {
        _read() {}
        _write(chunk, _enc, cb) {
          cb();
        }
      }
      const socket = new FakeSocket();
      const client = http2.connect("http://localhost:80", { createConnection: () => socket });
      client.on("error", e => console.log("session error", e.code));
      // peer SETTINGS + ACK of ours
      socket.push(encodeFrame(0x4, 0, 0));
      socket.push(encodeFrame(0x4, 0x1, 0));
      client.on("connect", () => {
        const req = client.request({ ":method": "POST", ":path": "/" }, { waitForTrailers: true });
        req.on("error", e => console.log("req error", e.code));
        req.on("close", () => console.log("req close"));
        req.on("wantTrailers", () => {
          console.log("wantTrailers id=" + req.id);
          req.sendTrailers({
            "x-a": {
              toString() {
                console.log("toString:start");
                // RST_STREAM(NO_ERROR) for the stream sendTrailers is operating on: its
                // legacy slot is queued for release inside this nested read().
                socket.push(encodeFrame(0x3, 0, req.id, Buffer.from([0, 0, 0, 0])));
                // A second read() (PING) runs the deferred-release drain while
                // sendTrailers still holds the stream.
                socket.push(encodeFrame(0x6, 0, 0, Buffer.alloc(8)));
                console.log("toString:end");
                return "v";
              },
            },
          });
          console.log("sendTrailers:returned");
          client.destroy();
        });
        req.end();
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "wantTrailers id=1
      toString:start
      toString:end
      sendTrailers:returned
      req error ERR_HTTP2_STREAM_CANCEL
      req close"
    `);
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  }, 30_000);

  // emitErrorToAllStreams must reject a non-numeric error code up front (the native
  // conversion requires a number) instead of reading it once per live stream. goaway()
  // is stubbed because its own number check sits in front of this path in destroy().
  test("session teardown rejects a non-numeric error code instead of reading it per stream", async () => {
    const fixture = String.raw`
      const http2 = require("node:http2");
      const { Duplex } = require("node:stream");
      function encodeFrame(type, flags, streamId, payload = Buffer.alloc(0)) {
        const header = Buffer.alloc(9);
        header.writeUIntBE(payload.length, 0, 3);
        header.writeUInt8(type, 3);
        header.writeUInt8(flags, 4);
        header.writeUInt32BE(streamId & 0x7fffffff, 5);
        return Buffer.concat([header, payload]);
      }
      class FakeSocket extends Duplex {
        _read() {}
        _write(chunk, _enc, cb) {
          cb();
        }
      }
      const socket = new FakeSocket();
      const client = http2.connect("http://localhost:80", { createConnection: () => socket });
      client.on("error", e => console.log("session error", e.message));
      // peer SETTINGS + ACK of ours
      socket.push(encodeFrame(0x4, 0, 0));
      socket.push(encodeFrame(0x4, 0x1, 0));
      client.on("connect", () => {
        const req = client.request({ ":method": "POST", ":path": "/" });
        req.on("error", e => console.log("req error", e.message));
        req.on("close", () => console.log("req close rst=" + req.rstCode));
        client.goaway = () => {};
        let calls = 0;
        try {
          client.destroy(new Error("boom"), {
            valueOf() {
              console.log("valueOf:" + ++calls);
              return 8;
            },
          });
          console.log("destroy:returned calls=" + calls);
        } catch (e) {
          console.log("destroy threw: " + e.message);
        }
        // A numeric code must still tear every open stream down.
        client.destroy(undefined, 8);
        console.log("destroy:done");
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "destroy threw: Expected errorCode to be a number
      destroy:done
      req error boom
      req close rst=8"
    `);
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  }, 30_000);

  // node only marks trailers as sent after header validation succeeds, so a corrected
  // retry after a validation error must reach the wire.
  test("a sendTrailers validation error does not mark the trailers as sent", async () => {
    const trailerError = Promise.withResolvers<any>();
    const trailers = Promise.withResolvers<any>();
    const server = http2.createServer();
    server.on("stream", (stream: any) => {
      stream.on("error", (e: any) => trailers.reject(e));
      stream.respond({ ":status": 200 }, { waitForTrailers: true });
      stream.on("wantTrailers", () => {
        try {
          stream.sendTrailers({ ":status": "200" });
        } catch (e: any) {
          trailerError.resolve(e);
          stream.sendTrailers({ "x-ok": "1" });
        }
      });
      stream.end("body");
    });
    server.listen(0);
    await once(server, "listening");
    const client = http2.connect(`http://localhost:${(server.address() as net.AddressInfo).port}`);
    client.on("error", e => trailers.reject(e));
    try {
      const req = client.request({ ":path": "/" });
      req.on("error", e => trailers.reject(e));
      req.on("trailers", headers => trailers.resolve(headers));
      req.resume();
      req.end();
      expect((await trailerError.promise).code).toBe("ERR_HTTP2_INVALID_PSEUDOHEADER");
      expect((await trailers.promise)["x-ok"]).toBe("1");
    } finally {
      client.close();
      server.close();
    }
  });

  test("refuses a new request stream once queued response data exhausts maxSessionMemory", async () => {
    const server = http2.createServer({ maxSessionMemory: 1 });
    server.on("stream", (stream: any) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.write(Buffer.alloc(1 << 22, "a"));
    });
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 1);
      c.sendFrame(FrameType.HEADERS, 0x5, 3, requestHeaderBlock("GET"));
      const rst = await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 3);
      expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.REFUSED_STREAM);
      expect(c.frames.find(f => f.type === FrameType.HEADERS && f.streamId === 3)).toBeUndefined();
    } finally {
      c.destroy();
      server.close();
    }
  });

  /** A maxSessionMemory:1 server whose first stream queues enough response data that the
   *  next inbound HEADERS is refused. Streams that do reach JS are recorded in `seen`. */
  async function exhaustedSession() {
    const seen: { path: string; sync?: string }[] = [];
    let first = true;
    const server = http2.createServer({ maxSessionMemory: 1 });
    server.on("stream", (stream: any, headers: any) => {
      seen.push({ path: headers[":path"], sync: headers["x-bun-sync"] });
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      if (first) {
        first = false;
        stream.end(Buffer.alloc(1 << 22, "a"));
      } else {
        stream.end("ok");
      }
    });
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    c.sendPreface();
    c.sendEmptySettings();
    c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
    await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 1);
    return { server, c, seen };
  }

  /** Open the connection and stream-1 windows so the queued response drains, bringing the
   *  session back under its memory limit; resolves once stream 1's END_STREAM arrives. */
  async function drainFirstStream(c: RawH2) {
    const increment = Buffer.alloc(4);
    increment.writeUInt32BE(1 << 24, 0);
    c.sendFrame(FrameType.WINDOW_UPDATE, 0, 0, increment);
    c.sendFrame(FrameType.WINDOW_UPDATE, 0, 1, increment);
    // A GOAWAY here means a frame on the refused stream was escalated to a connection
    // error - surface that immediately instead of timing out.
    const frame = await c.waitFor(
      f => f.type === FrameType.GOAWAY || (f.type === FrameType.DATA && f.streamId === 1 && (f.flags & 0x1) === 1),
      10_000,
    );
    expect(frame.type).toBe(FrameType.DATA);
  }

  // §5.1: a refused stream id has still existed, so frames a client pipelined behind the
  // refused HEADERS (RST_STREAM especially) target a closed stream, never an idle one —
  // none of them may escalate to a connection error.
  test("tolerates DATA/WINDOW_UPDATE/PRIORITY/RST_STREAM pipelined behind a refused HEADERS", async () => {
    const { server, c, seen } = await exhaustedSession();
    try {
      const cancel = Buffer.alloc(4);
      cancel.writeUInt32BE(ErrorCode.CANCEL, 0);
      const priority = Buffer.alloc(5);
      priority.writeUInt8(16, 4);
      const windowUpdate = Buffer.alloc(4);
      windowUpdate.writeUInt32BE(1000, 0);
      // One write: the HEADERS that will be refused plus everything a client that has not
      // yet seen the refusal would legitimately keep sending on that stream.
      c.send(
        Buffer.concat([
          encodeFrame(FrameType.HEADERS, 0x4, 3, requestHeaderBlock("POST")),
          encodeFrame(FrameType.DATA, 0, 3, Buffer.from("hello")),
          encodeFrame(FrameType.WINDOW_UPDATE, 0, 3, windowUpdate),
          encodeFrame(FrameType.PRIORITY, 0, 3, priority),
          encodeFrame(FrameType.RST_STREAM, 0, 3, cancel),
        ]),
      );
      const rst = await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 3);
      expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.REFUSED_STREAM);

      await drainFirstStream(c);
      c.sendFrame(FrameType.HEADERS, 0x5, 5, requestHeaderBlock("GET"));
      const resp = await c.waitFor(
        f => (f.type === FrameType.HEADERS && f.streamId === 5) || f.type === FrameType.GOAWAY,
      );
      expect(resp.type).toBe(FrameType.HEADERS);
      expect(c.frames.find(f => f.type === FrameType.GOAWAY)).toBeUndefined();
      expect(seen).toEqual([{ path: "/" }, { path: "/" }]);
    } finally {
      c.destroy();
      server.close();
    }
  });

  // §4.3: a refused stream's header block must still be decoded — including the part carried
  // by CONTINUATION — or the connection-scoped HPACK dynamic table desyncs.
  test("keeps HPACK state in sync when a refused header block spans HEADERS and CONTINUATION", async () => {
    const { server, c, seen } = await exhaustedSession();
    try {
      // The refused request's block inserts `x-bun-sync: 1` into the dynamic table
      // (literal with incremental indexing) from its CONTINUATION half.
      const insert = Buffer.concat([Buffer.from([0x40]), hpackLiteral("x-bun-sync"), hpackLiteral("1")]);
      c.send(
        Buffer.concat([
          encodeFrame(FrameType.HEADERS, 0x1 /* END_STREAM, no END_HEADERS */, 3, requestHeaderBlock("GET")),
          encodeFrame(FrameType.CONTINUATION, 0x4 /* END_HEADERS */, 3, insert),
        ]),
      );
      const rst = await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 3);
      expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.REFUSED_STREAM);

      await drainFirstStream(c);
      // 0xbe: indexed field 62 = the entry the refused block inserted. If that block had
      // not been decoded this is a COMPRESSION_ERROR and stream 5 never reaches JS.
      c.sendFrame(FrameType.HEADERS, 0x5, 5, Buffer.concat([requestHeaderBlock("GET"), Buffer.from([0xbe])]));
      const resp = await c.waitFor(
        f => (f.type === FrameType.HEADERS && f.streamId === 5) || f.type === FrameType.GOAWAY,
      );
      expect(resp.type).toBe(FrameType.HEADERS);
      expect(c.frames.find(f => f.type === FrameType.GOAWAY)).toBeUndefined();
      expect(seen).toEqual([{ path: "/" }, { path: "/", sync: "1" }]);
    } finally {
      c.destroy();
      server.close();
    }
  });
});
