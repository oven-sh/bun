// HTTP/2 protocol conformance suite (RFC 9113 + extensions).
//
// These tests drive a raw byte-level HTTP/2 client against a Bun `node:http2` h2c server and
// assert spec-mandated behavior at the wire level — the cases Node's own suite under-covers.
// Item numbers reference docs/http2-rewrite/03-spec-conformance-checklist.md.
//
// Mostly connection-level cases (preface, SETTINGS handshake/ack, PING, WINDOW_UPDATE,
// frame-size and stream-id rules), plus the malformed-header-block suite at the bottom,
// which runs the server in a child process to assert that a bad peer cannot kill it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { bunEnv, bunExe, tempDir } from "harness";
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

// ── Malformed header blocks (RFC 9113 §4.3/§6.10, RFC 7541 §6) ──
//
// A header block that fails to decode is a connection error. The stream it arrived on was never
// delivered to user code (its 'stream' event never fired), so its teardown has nowhere to put a
// stream 'error' and must not emit one: an 'error' with no listener aborts the process. These
// run the server in a child so the property under test is literally "the server process
// survives a malformed peer", which an in-process server cannot express.

const MALFORMED_PEER_SERVER = `
  const http2 = require("node:http2");
  // A realistic server: it observes session errors, but has no process-level
  // "uncaughtException" handler. Surviving a bad peer must not require one.
  const server = http2.createServer();
  server.on("sessionError", err => process.send({ sessionError: err.code }));
  server.on("stream", (stream, headers) => {
    process.send({ stream: headers[":path"] });
    stream.respond({ ":status": 200 });
    stream.end("served");
  });
  server.listen(0, "127.0.0.1", () => process.send({ port: server.address().port }));
`;

type ServerMessage = { port?: number; sessionError?: string; stream?: string };

/** Spawn MALFORMED_PEER_SERVER in a child process, exposing its IPC messages. */
function spawnH2Server(cwd: string) {
  const received: ServerMessage[] = [];
  const waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  const proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    ipc(message: ServerMessage) {
      received.push(message);
      const idx = waiters.findIndex(w => w.pred(message));
      if (idx !== -1) waiters.splice(idx, 1)[0].resolve(message);
    },
  });
  /** The first IPC message matching `pred`; rejects if the server process exits instead. */
  function message(pred: (m: ServerMessage) => boolean): Promise<ServerMessage> {
    const existing = received.find(pred);
    if (existing) return Promise.resolve(existing);
    return Promise.race([
      new Promise<ServerMessage>(resolve => waiters.push({ pred, resolve })),
      proc.exited.then(code => Promise.reject(new Error(`the server process exited with code ${code}`))),
    ]);
  }
  return { proc, received, message };
}

/** A fresh, well-formed session against the same process, proving it is still serving. */
async function probe(port: number, proc: Bun.Subprocess): Promise<{ status: number; body: string }> {
  const client = http2.connect(`http://127.0.0.1:${port}`);
  try {
    return await Promise.race([
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        client.on("error", reject);
        const req = client.request({ ":path": "/probe" });
        req.on("error", reject);
        let status = 0;
        req.on("response", headers => (status = headers[":status"] as number));
        const chunks: Buffer[] = [];
        req.on("data", (d: Buffer) => chunks.push(d));
        req.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString() }));
        req.end();
      }),
      proc.exited.then(code => Promise.reject(new Error(`the server process exited with code ${code}`))),
    ]);
  } finally {
    client.destroy();
  }
}

describe("malformed header blocks error the session, never the process (§4.3)", () => {
  const headers = (flags: number, block: number[]) => encodeFrame(FrameType.HEADERS, flags, 1, Buffer.from(block));
  const END_STREAM = 0x1;
  const END_HEADERS = 0x4;

  // Each case opens stream 1 and then makes the connection fail while that stream's header
  // block has not (and never will be) delivered to user code.
  const cases: Array<[name: string, frames: Buffer[], goawayCode: number]> = [
    [
      "an indexed header field with index 0 (RFC 7541 §6.1)",
      [headers(END_HEADERS | END_STREAM, [0x80])],
      ErrorCode.COMPRESSION_ERROR,
    ],
    [
      "a literal whose declared name length exceeds the block (RFC 7541 §5.2)",
      [headers(END_HEADERS | END_STREAM, [0x00, 0x05, 0x61])],
      ErrorCode.COMPRESSION_ERROR,
    ],
    [
      "a dynamic table size update above the advertised table size (RFC 7541 §6.3)",
      [headers(END_HEADERS | END_STREAM, [0x3f, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f])],
      ErrorCode.COMPRESSION_ERROR,
    ],
    [
      "a PING interleaved into an unfinished header block (RFC 9113 §6.10)",
      [headers(END_STREAM, [0x82, 0x84]), encodeFrame(FrameType.PING, 0, 0, Buffer.alloc(8))],
      ErrorCode.PROTOCOL_ERROR,
    ],
  ];

  test.each(cases)("%s", async (_name, frames, goawayCode) => {
    using dir = tempDir("h2-malformed-peer", { "server.js": MALFORMED_PEER_SERVER });
    const server = spawnH2Server(String(dir));
    await using proc = server.proc;
    const { port } = await server.message(m => "port" in m);

    const c = await RawH2.connect(port!);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      for (const frame of frames) c.send(frame);
      const goaway = await c.waitForGoaway();
      expect(goawayErrorCode(goaway)).toBe(goawayCode);
    } finally {
      c.destroy();
    }

    // The session error is still observable on the server object.
    const { sessionError } = await server.message(m => "sessionError" in m);
    expect(sessionError).toBe("ERR_HTTP2_SESSION_ERROR");

    // The process is alive and a new, well-formed session gets served by it.
    expect(await probe(port!, proc)).toEqual({ status: 200, body: "served" });
    // The stream whose header block never decoded was never surfaced to user code.
    expect(server.received.filter(m => "stream" in m)).toEqual([{ stream: "/probe" }]);
  });
});
