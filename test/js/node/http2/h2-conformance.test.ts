// HTTP/2 protocol conformance suite (RFC 9113 + extensions).
//
// These tests drive a raw byte-level HTTP/2 client against a Bun `node:http2` h2c server and
// assert spec-mandated behavior at the wire level — the cases Node's own suite under-covers.
// Item numbers reference docs/http2-rewrite/03-spec-conformance-checklist.md.
//
// Connection-level cases only here (no HPACK required): preface, SETTINGS handshake/ack, PING,
// WINDOW_UPDATE, frame-size and stream-id rules. HPACK/HEADERS cases live in a sibling file.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, gcTick, isASAN, isDebug, normalizeBunSnapshot, tls as tlsCert } from "harness";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import { Duplex, duplexPair, Readable, Writable } from "node:stream";
import tls from "node:tls";

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
  ENHANCE_YOUR_CALM: 0xb,
} as const;

type Frame = { length: number; type: number; flags: number; streamId: number; payload: Buffer };

function encodeFrame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([frameHeader(type, flags, streamId, payload.length), payload]);
}

/** A bare 9-byte frame header. `length` is the declared payload length. */
function frameHeader(type: number, flags: number, streamId: number, length: number): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(length, 0, 3); // 24-bit length
  header.writeUInt8(type, 3);
  header.writeUInt8(flags, 4);
  header.writeUInt32BE(streamId & 0x7fffffff, 5); // reserved bit clear
  return header;
}

/** A minimal raw HTTP/2 client: send arbitrary frames, collect parsed inbound frames. */
class RawH2 {
  socket: Duplex;
  private buf: Buffer = Buffer.alloc(0);
  frames: Frame[] = [];
  closed = false;
  private waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];

  /** `target` is a port on 127.0.0.1, or a transport that's already connected. */
  constructor(target: number | Duplex, secure = false) {
    this.socket =
      typeof target !== "number"
        ? target
        : secure
          ? tls.connect({ port: target, host: "127.0.0.1", ca: tlsCert.cert, ALPNProtocols: ["h2"] })
          : net.connect(target, "127.0.0.1");
    this.socket.on("data", (d: Buffer) => this.onData(d));
    this.socket.on("close", () => (this.closed = true));
    this.socket.on("error", () => {});
  }

  static async connect(port: number, secure = false): Promise<RawH2> {
    const c = new RawH2(port, secure);
    await once(c.socket, secure ? "secureConnect" : "connect");
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

  test("a header block spanning HEADERS and two CONTINUATION frames is reassembled (§6.10)", async () => {
    const seen: Record<string, unknown>[] = [];
    const server = http2.createServer();
    server.on("stream", (stream: any, headers: any) => {
      seen.push({ path: headers[":path"], a: headers["x-a"], b: headers["x-b"] });
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      // Two literal fields (new name, not indexed), split mid-instruction between the CONTINUATIONs
      // so the block only decodes if all three fragments are concatenated in order.
      const tail = Buffer.concat([
        Buffer.from([0x00]),
        hpackLiteral("x-a"),
        hpackLiteral("1"),
        Buffer.from([0x00]),
        hpackLiteral("x-b"),
        hpackLiteral("2"),
      ]);
      c.sendFrame(FrameType.HEADERS, 0x1 /* END_STREAM, no END_HEADERS */, 1, requestHeaderBlock("GET"));
      c.sendFrame(FrameType.CONTINUATION, 0, 1, tail.subarray(0, 3));
      c.sendFrame(FrameType.CONTINUATION, 0x4 /* END_HEADERS */, 1, tail.subarray(3));
      const resp = await c.waitFor(
        f => (f.type === FrameType.HEADERS && f.streamId === 1) || f.type === FrameType.GOAWAY,
      );
      expect(resp.type).toBe(FrameType.HEADERS);
      expect(c.frames.find(f => f.type === FrameType.GOAWAY)).toBeUndefined();
      expect(seen).toEqual([{ path: "/", a: "1", b: "2" }]);
    } finally {
      c.destroy();
      server.close();
    }
  });

  // nghttp2's NGHTTP2_DEFAULT_MAX_CONTINUATIONS.
  const MAX_CONTINUATIONS = 8;

  /** `opener` has no END_HEADERS. The last of `count` empty CONTINUATION frames carries it. */
  function withEmptyContinuations(opener: Buffer, streamId: number, count: number): Buffer {
    const frames = [opener];
    for (let i = 1; i < count; i++) frames.push(encodeFrame(FrameType.CONTINUATION, 0, streamId));
    frames.push(encodeFrame(FrameType.CONTINUATION, 0x4 /* END_HEADERS */, streamId));
    return Buffer.concat(frames);
  }

  test("server allows 8 CONTINUATION frames per header block", async () => {
    const c = await RawH2.connect(port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      for (const id of [1, 3]) {
        const opener = encodeFrame(FrameType.HEADERS, 0x1 /* END_STREAM */, id, requestHeaderBlock("GET"));
        c.send(withEmptyContinuations(opener, id, MAX_CONTINUATIONS));
        const reply = await c.waitFor(
          f => (f.type === FrameType.HEADERS && f.streamId === id) || f.type === FrameType.GOAWAY,
        );
        expect(reply.type).toBe(FrameType.HEADERS);
      }
    } finally {
      c.destroy();
    }
  });

  test("server rejects a 9th CONTINUATION frame", async () => {
    const srv = http2.createServer();
    let dispatched = false;
    srv.on("stream", () => (dispatched = true));
    srv.listen(0, "127.0.0.1");
    await once(srv, "listening");
    const c = await RawH2.connect((srv.address() as net.AddressInfo).port);
    try {
      const sessionError = once(srv, "sessionError");
      c.sendPreface();
      c.sendEmptySettings();
      const opener = encodeFrame(FrameType.HEADERS, 0x1 /* END_STREAM */, 1, requestHeaderBlock("GET"));
      c.send(withEmptyContinuations(opener, 1, MAX_CONTINUATIONS + 1));
      expect(goawayErrorCode(await c.waitForGoaway())).toBe(ErrorCode.INTERNAL_ERROR);
      const [err] = await sessionError;
      expect(err).toMatchObject({
        code: "ERR_HTTP2_ERROR",
        errno: -905,
        message: "Too many CONTINUATION frames following a HEADER frame",
      });
      expect(dispatched).toBe(false);
    } finally {
      c.destroy();
      srv.close();
    }
  });

  test("client rejects a 9th CONTINUATION frame", async () => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    try {
      const { promise, resolve } = Promise.withResolvers<unknown>();
      client.on("error", resolve);
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      req.on("response", headers => resolve({ response: headers }));
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      const opener = encodeFrame(FrameType.HEADERS, 0, 1, Buffer.from([0x88])); // :status 200
      raw.socket!.write(withEmptyContinuations(opener, 1, MAX_CONTINUATIONS + 1));
      expect(await promise).toMatchObject({ code: "ERR_HTTP2_ERROR", errno: -905 });
    } finally {
      client.destroy();
      raw.close();
    }
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

  // §4.2 applies to every frame type. The server must answer from the 9-byte header, without
  // buffering the ~16 MiB payload it declares.
  test.each([
    // Use a multiple of 6 for SETTINGS so the §6.5 length rule cannot mask the §4.2 check.
    ["SETTINGS", FrameType.SETTINGS, 0, 0xfffffc],
    ["GOAWAY", FrameType.GOAWAY, 0, 0xffffff],
    ["PUSH_PROMISE", FrameType.PUSH_PROMISE, 1, 0xffffff],
    ["ALTSVC", 0x0a, 0, 0xffffff],
    ["ORIGIN", 0x0c, 0, 0xffffff],
    ["unknown (0xff)", 0xff, 0, 0xffffff],
  ])("rejects an oversized %s frame from its header alone", async (_name, type, streamId, length) => {
    const c = await RawH2.connect(port);
    c.sendPreface();
    c.sendEmptySettings();
    c.send(frameHeader(type, 0, streamId, length));
    c.send(Buffer.alloc(16, 0));
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.FRAME_SIZE_ERROR);
    c.destroy();
  });
});

describe("frame size limit with a non-default SETTINGS_MAX_FRAME_SIZE (checklist §4.2)", () => {
  // §4.2/§6.5.2: the limit is the SETTINGS_MAX_FRAME_SIZE the endpoint advertised, not the default of 16384.
  const MAX_FRAME_SIZE = 32768;
  let bigServer: http2.Http2Server;
  let bigPort: number;

  beforeAll(async () => {
    bigServer = http2.createServer({ settings: { maxFrameSize: MAX_FRAME_SIZE } });
    bigServer.on("stream", (stream: any) => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    bigServer.listen(0);
    await once(bigServer, "listening");
    bigPort = (bigServer.address() as net.AddressInfo).port;
  });

  afterAll(() => {
    bigServer?.close();
  });

  /** Decode the first occurrence of `id` in a SETTINGS payload. */
  function settingValue(f: Frame, id: number): number | undefined {
    for (let off = 0; off + 6 <= f.payload.length; off += 6) {
      if (f.payload.readUInt16BE(off) === id) return f.payload.readUInt32BE(off + 2);
    }
    return undefined;
  }

  test("the server advertises the configured SETTINGS_MAX_FRAME_SIZE", async () => {
    const c = await RawH2.connect(bigPort);
    c.sendPreface();
    c.sendEmptySettings();
    const settings = await c.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0);
    expect(settingValue(settings, 0x5)).toBe(MAX_FRAME_SIZE);
    c.destroy();
  });

  test("a frame over the default but within the advertised limit is accepted", async () => {
    const c = await RawH2.connect(bigPort);
    c.sendPreface();
    c.sendEmptySettings();
    // Unknown frame types are ignored (§4.1, §5.5), so the connection must stay usable.
    c.sendFrame(0xff, 0, 0, Buffer.alloc(20000, 0));
    const ping = Buffer.from("pingpong", "latin1");
    c.sendFrame(FrameType.PING, 0, 0, ping);
    const ack = await c.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) === 1);
    expect(ack.payload).toEqual(ping);
    expect(c.frames.filter(f => f.type === FrameType.GOAWAY)).toEqual([]);
    c.destroy();
  });

  test("a frame one byte over the advertised limit is a FRAME_SIZE_ERROR", async () => {
    const c = await RawH2.connect(bigPort);
    c.sendPreface();
    c.sendEmptySettings();
    c.send(frameHeader(0xff, 0, 0, MAX_FRAME_SIZE + 1));
    c.send(Buffer.alloc(16, 0));
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.FRAME_SIZE_ERROR);
    c.destroy();
  });
});

describe.concurrent("header block decoding errors (RFC 9113 §4.3)", () => {
  // The stream is rejected before the 'stream' event ever fires, so no user code can have
  // attached an 'error' listener to it. The error must stay at the connection level
  // (GOAWAY COMPRESSION_ERROR) instead of being raised as an uncaught exception that kills
  // the process. Run in a child so a regression shows up as the child dying, not this runner.
  test("an undecodable HEADERS block does not kill the server process", async () => {
    const fixture = String.raw`
      const http2 = require("node:http2");
      const net = require("node:net");
      const server = http2.createServer((req, res) => res.end("ok"));
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        // Raw prior-knowledge h2c client: preface, empty SETTINGS, then a HEADERS frame
        // (END_HEADERS | END_STREAM, stream 1) whose payload is not a valid HPACK block.
        const raw = net.connect(port, "127.0.0.1", () => {
          const preface = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
          const settings = Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]);
          const block = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]);
          const headers = Buffer.alloc(9);
          headers.writeUIntBE(block.length, 0, 3);
          headers[3] = 0x01;
          headers[4] = 0x05;
          headers.writeUInt32BE(1, 5);
          raw.write(Buffer.concat([preface, settings, headers, block]));
        });
        let received = Buffer.alloc(0);
        raw.on("data", d => (received = Buffer.concat([received, d])));
        raw.on("error", () => {});
        // The server answers with GOAWAY and closes the connection; only then prove the
        // process is still alive and still serving by completing a real request.
        raw.on("close", () => {
          let goawayCode = -1;
          for (let i = 0; i + 9 <= received.length; i += 9 + received.readUIntBE(i, 3)) {
            if (received[i + 3] === 0x07) {
              goawayCode = received.readUInt32BE(i + 9 + 4);
              break;
            }
          }
          console.log("goaway", goawayCode);
          const client = http2.connect("http://127.0.0.1:" + port);
          client.on("error", err => {
            console.error(err);
            process.exit(3);
          });
          const req = client.request({ ":path": "/" });
          req.setEncoding("utf8");
          let body = "";
          req.on("data", c => (body += c));
          req.on("error", err => {
            console.error(err);
            process.exit(4);
          });
          req.on("end", () => {
            console.log("second request", body);
            client.close();
            server.close();
          });
          req.end();
        });
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // COMPRESSION_ERROR (0x9) on the wire, and the process survived to serve the second request.
    // stderr is in the diff for debugging but only asserted not to carry the uncaught stream
    // error (debug/ASAN builds write benign warnings to it).
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "goaway 9\nsecond request ok\n",
      stderr: expect.not.stringContaining("ERR_HTTP2"),
      exitCode: 0,
    });
  }, 30_000);

  // Same sink, reached by PROTOCOL_ERROR instead of COMPRESSION_ERROR: a HEADERS frame without
  // END_HEADERS followed by anything other than a CONTINUATION on the same stream is a connection
  // error (RFC 9113 §6.10). The stream was created for the HEADERS frame but never announced.
  test("a non-CONTINUATION frame during header assembly does not kill the server process", async () => {
    const fixture = String.raw`
      const http2 = require("node:http2");
      const net = require("node:net");
      const server = http2.createServer((req, res) => res.end("ok"));
      server.on("sessionError", () => {});
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        const raw = net.connect(port, "127.0.0.1", () => {
          const preface = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
          const settings = Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]);
          // HEADERS (stream 1, END_STREAM, NOT END_HEADERS) with a valid one-byte HPACK fragment,
          // then a DATA frame on stream 3 where CONTINUATION(stream 1) was required.
          const block = Buffer.from([0x82]);
          const headers = Buffer.alloc(9);
          headers.writeUIntBE(block.length, 0, 3);
          headers[3] = 0x01;
          headers[4] = 0x01;
          headers.writeUInt32BE(1, 5);
          const data = Buffer.alloc(9 + 1);
          data.writeUIntBE(1, 0, 3);
          data[3] = 0x00;
          data[4] = 0x01;
          data.writeUInt32BE(3, 5);
          data[9] = 0x78;
          raw.write(Buffer.concat([preface, settings, headers, block, data]));
        });
        let received = Buffer.alloc(0);
        raw.on("data", d => (received = Buffer.concat([received, d])));
        raw.on("error", () => {});
        raw.on("close", () => {
          let goawayCode = -1;
          for (let i = 0; i + 9 <= received.length; i += 9 + received.readUIntBE(i, 3)) {
            if (received[i + 3] === 0x07) {
              goawayCode = received.readUInt32BE(i + 9 + 4);
              break;
            }
          }
          console.log("goaway", goawayCode);
          const client = http2.connect("http://127.0.0.1:" + port);
          client.on("error", err => {
            console.error(err);
            process.exit(3);
          });
          const req = client.request({ ":path": "/" });
          req.setEncoding("utf8");
          let body = "";
          req.on("data", c => (body += c));
          req.on("error", err => {
            console.error(err);
            process.exit(4);
          });
          req.on("end", () => {
            console.log("second request", body);
            client.close();
            server.close();
          });
          req.end();
        });
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // PROTOCOL_ERROR (0x1) on the wire, and the process survived to serve the second request.
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "goaway 1\nsecond request ok\n",
      stderr: expect.not.stringContaining("ERR_HTTP2"),
      exitCode: 0,
    });
  }, 30_000);

  // Same guard, second hand-off point: a pushStream() whose PUSH_PROMISE headers fail native
  // validation destroys the not-yet-delivered pushed stream with the validation error. Only the
  // pushStream callback reports it; emitting 'error' on that stream was an uncaught exception.
  test("a pushStream() validation error is reported through the callback, not as an uncaught 'error'", async () => {
    const fixture = String.raw`
      const http2 = require("node:http2");
      const server = http2.createServer();
      server.on("stream", stream => {
        stream.pushStream({ ":path": "/p", "bad header": "x" }, err => {
          console.log("pushStream callback", err ? err.code : null);
          stream.respond({ ":status": 200 });
          stream.end("main");
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const client = http2.connect("http://127.0.0.1:" + server.address().port);
        client.on("error", err => {
          console.error(err);
          process.exit(3);
        });
        client.on("stream", pushed => pushed.on("error", () => {}));
        const req = client.request({ ":path": "/" });
        req.setEncoding("utf8");
        let body = "";
        req.on("data", c => (body += c));
        req.on("error", err => {
          console.error(err);
          process.exit(4);
        });
        req.on("end", () => {
          console.log("response", body);
          client.close();
          server.close();
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
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "pushStream callback ERR_INVALID_HTTP_TOKEN\nresponse main\n",
      stderr: expect.not.stringContaining("ERR_INVALID_HTTP_TOKEN"),
      exitCode: 0,
    });
  }, 30_000);
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
      socket.on("data", (d: Buffer) => s.onData(d));
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

/** RFC 7541 §5.1 prefixed integer. `pattern` holds the opcode bits above the `prefixBits`-bit prefix. */
function hpackInt(value: number, prefixBits: number, pattern: number): Buffer {
  const max = (1 << prefixBits) - 1;
  if (value < max) return Buffer.from([pattern | value]);
  const bytes = [pattern | max];
  let rest = value - max;
  while (rest >= 128) {
    bytes.push((rest % 128) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

/** HPACK string literal: 7-bit prefixed length, no Huffman coding. */
function hpackLiteral(str: string): Buffer {
  const bytes = Buffer.from(str, "latin1");
  return Buffer.concat([hpackInt(bytes.length, 7, 0x00), bytes]);
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

  const STATUS_200 = Buffer.from([0x88]);

  /** PUSH_PROMISE on stream 1 with END_HEADERS. */
  function pushPromise(promisedId: number): Buffer {
    const id = Buffer.alloc(4);
    id.writeUInt32BE(promisedId);
    return encodeFrame(FrameType.PUSH_PROMISE, 0x4, 1, Buffer.concat([id, requestHeaderBlock("GET")]));
  }

  /** A client with request stream 1 open on a raw server, after the SETTINGS exchange. */
  async function openRequest() {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    const req = client.request({ ":path": "/" });
    req.resume();
    await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
    raw.sendFrame(FrameType.SETTINGS, 0, 0);
    raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
    await raw.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) !== 0);
    return {
      raw,
      client,
      req,
      [Symbol.dispose]() {
        client.destroy();
        raw.close();
      },
    };
  }
  type OpenRequest = Awaited<ReturnType<typeof openRequest>>;

  test.each<[string, (pushed: http2.ClientHttp2Stream) => void, number, string | undefined]>([
    ["close(NGHTTP2_REFUSED_STREAM)", pushed => pushed.close(ErrorCode.REFUSED_STREAM), 7, "ERR_HTTP2_STREAM_ERROR"],
    ["close(NGHTTP2_CANCEL)", pushed => pushed.close(ErrorCode.CANCEL), 8, undefined],
    ["close()", pushed => pushed.close(), 0, undefined],
    ["destroy()", pushed => pushed.destroy(), 0, undefined],
  ])("%s resets a pushed stream and session.close() completes", async (_name, reset, code, errorCode) => {
    using ctx = await openRequest();
    const { raw, client, req } = ctx;
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    client.on("stream", pushed => {
      pushed.on("aborted", () => events.push("aborted"));
      pushed.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code}`));
      pushed.on("close", () => {
        events.push(`close ${pushed.rstCode}`);
        closed.resolve();
      });
      reset(pushed);
    });
    raw.socket!.write(pushPromise(2));
    const rst = await raw.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 2);
    expect(rst.payload.readUInt32BE(0)).toBe(code);
    await closed.promise;
    expect(events).toEqual(errorCode ? [`error ${errorCode}`, `close ${code}`] : [`close ${code}`]);
    raw.sendFrame(FrameType.HEADERS, 0x5, 1, STATUS_200);
    await once(req, "close");
    client.close();
    await once(client, "close");
  });

  test.each<[string, (ctx: OpenRequest) => void]>([
    ["session.destroy()", ({ client }) => client.destroy()],
    ["session.destroy(err)", ({ client }) => client.destroy(new Error("boom"))],
    [
      "a GOAWAY with an error code",
      ({ raw }) => raw.sendFrame(FrameType.GOAWAY, 0, 0, Buffer.from([0, 0, 0, 1, 0, 0, 0, 11])),
    ],
    ["the peer closing the connection", ({ raw }) => raw.socket!.end()],
  ])("%s destroys an open pushed stream", async (_name, teardown) => {
    using ctx = await openRequest();
    const { raw, client, req } = ctx;
    client.on("error", () => {});
    req.on("error", () => {});
    raw.socket!.write(pushPromise(2));
    const [pushed] = await once(client, "stream");
    pushed.on("error", () => {});
    let pushedClosed = false;
    pushed.on("close", () => (pushedClosed = true));
    // Not once(), which rejects on the session's 'error'.
    const sessionClosed = Promise.withResolvers<void>();
    client.on("close", sessionClosed.resolve);
    teardown(ctx);
    await sessionClosed.promise;
    expect({ destroyed: pushed.destroyed, pushedClosed }).toEqual({ destroyed: true, pushedClosed: true });
  });

  // Node emits 'error' on the pushed stream here, which is uncaught.
  test("a GOAWAY with an error code closes a pushed stream that has no 'error' listener, without 'end'", async () => {
    using ctx = await openRequest();
    const { raw, client, req } = ctx;
    client.on("error", () => {});
    req.on("error", () => {});
    raw.socket!.write(
      Buffer.concat([
        pushPromise(2),
        encodeFrame(FrameType.HEADERS, 0x4, 2, STATUS_200),
        encodeFrame(FrameType.DATA, 0, 2, Buffer.from("part")),
      ]),
    );
    const [pushed] = await once(client, "stream");
    const events: string[] = [];
    // Not once(), which adds an 'error' listener.
    const gotData = Promise.withResolvers<void>();
    const pushedClosed = Promise.withResolvers<void>();
    pushed.on("data", (chunk: Buffer) => {
      events.push(`data ${chunk}`);
      gotData.resolve();
    });
    pushed.on("end", () => events.push("end"));
    pushed.on("close", () => {
      events.push("close");
      pushedClosed.resolve();
    });
    await gotData.promise;
    raw.sendFrame(FrameType.GOAWAY, 0, 0, Buffer.from([0, 0, 0, 1, 0, 0, 0, 11]));
    await pushedClosed.promise;
    expect({ events, errored: pushed.errored?.code, rstCode: pushed.rstCode }).toEqual({
      events: ["data part", "close"],
      errored: "ERR_HTTP2_SESSION_ERROR",
      rstCode: ErrorCode.ENHANCE_YOUR_CALM,
    });
  });

  /** Sends DATA on pushed stream 2 for as long as the client grants window, up to `limit` bytes. Returns the bytes sent. */
  async function sendWhileWindowOpens(raw: RawH2Server, limit: number): Promise<number> {
    const credit = { 0: 65535, 2: 65535 };
    let sent = 0;
    let seen = raw.frames.length;
    for (let round = 1; sent < limit && Math.min(credit[0], credit[2]) > 0; round++) {
      for (let n; (n = Math.min(credit[0], credit[2], 16384, limit - sent)) > 0; sent += n) {
        raw.sendFrame(FrameType.DATA, 0, 2, Buffer.alloc(n));
        credit[0] -= n;
        credit[2] -= n;
      }
      // The ACK follows every WINDOW_UPDATE the DATA above earned.
      raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8, round));
      await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0 && f.payload[0] === round);
      for (const f of raw.frames.slice(seen)) {
        if (f.type === FrameType.WINDOW_UPDATE) credit[f.streamId as 0 | 2] += f.payload.readUInt32BE(0);
      }
      seen = raw.frames.length;
    }
    return sent;
  }

  test("a pushed stream that isn't read stops getting receive window", async () => {
    using ctx = await openRequest();
    const { raw, client } = ctx;
    raw.socket!.write(Buffer.concat([pushPromise(2), encodeFrame(FrameType.HEADERS, 0x4, 2, STATUS_200)]));
    await once(client, "stream");
    expect(await sendWhileWindowOpens(raw, 8 * 65535)).toBeLessThan(8 * 65535);
  });

  test("a client without a 'stream' listener cancels a push", async () => {
    using ctx = await openRequest();
    const { raw, client } = ctx;
    raw.socket!.write(pushPromise(2));
    const rst = await raw.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 2);
    expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.CANCEL);
    raw.sendFrame(FrameType.HEADERS, 0x5, 1, STATUS_200);
    client.close();
    await once(client, "close");
  });

  test("the client's GOAWAY carries the last promised stream id, so the server finishes the push", async () => {
    using ctx = await openRequest();
    const { raw, client } = ctx;
    raw.socket!.write(pushPromise(2));
    await once(client, "stream");
    client.close();
    expect((await raw.waitFor(f => f.type === FrameType.GOAWAY)).payload.readUInt32BE(0)).toBe(2);
  });

  test("a graceful GOAWAY doesn't reject a pushed stream above its last-stream-id", async () => {
    using ctx = await openRequest();
    const { raw, client } = ctx;
    raw.socket!.write(pushPromise(2));
    const [pushed] = await once(client, "stream");
    raw.sendFrame(FrameType.GOAWAY, 0, 0, Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]));
    await once(client, "goaway");
    raw.sendFrame(FrameType.HEADERS, 0x4, 2, STATUS_200);
    raw.sendFrame(FrameType.DATA, 0x1, 2, Buffer.from("pushed"));
    raw.sendFrame(FrameType.HEADERS, 0x5, 1, STATUS_200);
    expect(await pushed.setEncoding("utf8").toArray()).toEqual(["pushed"]);
    await once(client, "close");
  });

  test("a pushed stream closes when its END_STREAM HEADERS and CONTINUATION arrive in separate reads", async () => {
    using ctx = await openRequest();
    const { raw, client, req } = ctx;
    raw.socket!.write(pushPromise(2));
    const [pushed] = await once(client, "stream");
    pushed.resume();
    raw.sendFrame(FrameType.HEADERS, 0x5, 1, STATUS_200);
    raw.sendFrame(FrameType.HEADERS, 0x1 /* END_STREAM, no END_HEADERS */, 2, STATUS_200);
    // The client has read the HEADERS frame once the request in front of it closed.
    await once(req, "close");
    raw.sendFrame(FrameType.CONTINUATION, 0x4, 2);
    await once(pushed, "close");
    expect(pushed.rstCode).toBe(0);
    client.close();
    await once(client, "close");
  });

  test("a PUSH_PROMISE that arrives after goaway() opens no stream, and its response is dropped", async () => {
    using ctx = await openRequest();
    const { raw, client, req } = ctx;
    let streams = 0;
    client.on("stream", () => streams++);
    client.goaway();
    await raw.waitFor(f => f.type === FrameType.GOAWAY);
    raw.socket!.write(
      Buffer.concat([
        pushPromise(2),
        encodeFrame(FrameType.HEADERS, 0x4, 2, STATUS_200),
        encodeFrame(FrameType.DATA, 0x1, 2, Buffer.from("pushed")),
        encodeFrame(FrameType.HEADERS, 0x5, 1, STATUS_200),
        encodeFrame(FrameType.PING, 0, 0, Buffer.alloc(8)),
      ]),
    );
    await Promise.all([once(req, "close"), raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0)]);
    expect(streams).toBe(0);
    expect(raw.frames.filter(f => f.type === FrameType.RST_STREAM || f.type === FrameType.GOAWAY).length).toBe(1);
  });

  test("session.close() completes when a PUSH_PROMISE arrives after it and no response follows", async () => {
    using ctx = await openRequest();
    const { raw, client } = ctx;
    client.close();
    await raw.waitFor(f => f.type === FrameType.GOAWAY);
    raw.socket!.write(Buffer.concat([pushPromise(2), encodeFrame(FrameType.HEADERS, 0x5, 1, STATUS_200)]));
    await once(client, "close");
  });

  test.each<[string, (ctx: OpenRequest) => Promise<void>]>([
    [
      "below an earlier one",
      async ({ raw }) => void raw.socket!.write(Buffer.concat([pushPromise(4), pushPromise(2)])),
    ],
    [
      "of a pushed stream that already closed",
      async ({ raw, client }) => {
        raw.socket!.write(Buffer.concat([pushPromise(2), encodeFrame(FrameType.HEADERS, 0x5, 2, STATUS_200)]));
        const [pushed] = await once(client, "stream");
        await once(pushed.resume(), "close");
        raw.socket!.write(pushPromise(2));
      },
    ],
  ])("a PUSH_PROMISE with a promised id %s is a connection error", async (_name, promise) => {
    using ctx = await openRequest();
    const { raw, client, req } = ctx;
    req.on("error", () => {});
    client.on("stream", pushed => pushed.on("error", () => {}));
    const error = once(client, "error");
    await promise(ctx);
    expect((await error)[0].code).toBe("ERR_HTTP2_ERROR");
    expect(goawayErrorCode(await raw.waitFor(f => f.type === FrameType.GOAWAY))).toBe(ErrorCode.PROTOCOL_ERROR);
  });

  /** A server that runs `onStream`, and a raw client that sent a GET on stream 1 after the SETTINGS exchange. */
  async function rawRequest(onStream: (stream: http2.ServerHttp2Stream) => void) {
    const pushServer = http2.createServer();
    pushServer.on("stream", onStream);
    pushServer.listen(0, "127.0.0.1");
    await once(pushServer, "listening");
    const c = await RawH2.connect((pushServer.address() as net.AddressInfo).port);
    c.sendPreface();
    c.sendEmptySettings();
    await c.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0);
    c.sendSettingsAck();
    c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
    return {
      c,
      [Symbol.dispose]() {
        c.destroy();
        pushServer.close();
      },
    };
  }

  test("DATA from the client on a pushed stream resets it", async () => {
    const closed = Promise.withResolvers<{ code?: string; rstCode: number; received: number }>();
    using ctx = await rawRequest(stream => {
      stream.pushStream({ ":path": "/pushed" }, (err, pushed) => {
        if (err) return closed.reject(err);
        let code: string | undefined;
        let received = 0;
        pushed.on("error", (e: NodeJS.ErrnoException) => (code = e.code));
        pushed.on("data", (d: Buffer) => (received += d.length));
        pushed.on("close", () => closed.resolve({ code, rstCode: pushed.rstCode, received }));
        pushed.respond({ ":status": 200 });
        pushed.write("p");
      });
      stream.respond({ ":status": 200 });
      stream.end("main");
    });
    const { c } = ctx;
    await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 2);
    c.sendFrame(FrameType.DATA, 0, 2, Buffer.from("x"));
    const rst = await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 2);
    expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.STREAM_CLOSED);
    expect(await closed.promise).toEqual({ code: "ERR_HTTP2_STREAM_ERROR", rstCode: 5, received: 0 });
  });

  test("session.close() waits for an open stream after RST_STREAM on a push that was never sent", async () => {
    const pushFailed = Promise.withResolvers<string | undefined>();
    let main!: http2.ServerHttp2Stream;
    using ctx = await rawRequest(stream => {
      main = stream;
      // A bad value is only found once the promised id is reserved.
      stream.pushStream({ ":path": "/pushed", "x-bad": "a\nb" }, err => {
        stream.respond({ ":status": 200 });
        stream.write("m");
        pushFailed.resolve((err as NodeJS.ErrnoException | null)?.code);
      });
    });
    const { c } = ctx;
    expect(await pushFailed.promise).toBe("ERR_HTTP2_INVALID_HEADER_VALUE");
    c.sendFrame(FrameType.RST_STREAM, 0, 2, Buffer.from([0, 0, 0, ErrorCode.CANCEL]));
    c.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
    await c.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0);
    const session = main.session!;
    session.close();
    await c.waitFor(f => f.type === FrameType.GOAWAY);
    expect({ stream: main.destroyed, session: session.destroyed }).toEqual({ stream: false, session: false });
    main.end("done");
    const last = await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 1 && (f.flags & 0x1) !== 0);
    expect(last.payload.toString()).toBe("done");
    await c.waitClosed();
  });

  test.each<[string, { endStream: boolean } | undefined, (pushed: http2.ServerHttp2Stream) => void]>([
    ["pushStream({ endStream: true })", { endStream: true }, pushed => pushed.respond({ ":status": 200 })],
    ["end() before respond()", undefined, pushed => (pushed.end(), pushed.respond({ ":status": 200 }))],
  ])("%s puts END_STREAM on the pushed response's HEADERS", async (_name, options, respond) => {
    const closed = Promise.withResolvers<number>();
    using ctx = await rawRequest(stream => {
      stream.pushStream({ ":path": "/pushed" }, options, (err, pushed) => {
        if (err) return closed.reject(err);
        pushed.on("close", () => closed.resolve(pushed.rstCode));
        respond(pushed);
      });
      stream.respond({ ":status": 200 });
      stream.end();
    });
    const headers = await ctx.c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 2);
    expect(headers.flags & 0x1).toBe(0x1);
    expect(await closed.promise).toBe(0);
  });

  test("pushStream() defaults :authority to the request's host, and adds none to a push with its own host", async () => {
    const pushServer = http2.createServer();
    pushServer.on("stream", stream => {
      for (const headers of [{ ":path": "/a" }, { ":path": "/b", host: "other.test" }]) {
        stream.pushStream(headers, (err, pushed) => {
          if (err) return stream.destroy(err);
          pushed.respond({ ":status": 200 });
          pushed.end();
        });
      }
      stream.respond({ ":status": 200 });
      stream.end();
    });
    pushServer.listen(0, "127.0.0.1");
    await once(pushServer, "listening");
    const client = http2.connect(`http://127.0.0.1:${(pushServer.address() as net.AddressInfo).port}`);
    try {
      const promised: unknown[] = [];
      client.on("stream", (pushed, headers) => {
        promised.push([headers[":path"], headers[":authority"], headers.host]);
        pushed.resume();
      });
      const req = client.request({ ":path": "/", host: "example.test" });
      await once(req.resume(), "close");
      expect(promised).toEqual([
        ["/a", "example.test", undefined],
        ["/b", undefined, "other.test"],
      ]);
    } finally {
      client.close();
      pushServer.close();
    }
  });

  test("pushStream() throws after session.close()", async () => {
    const result = Promise.withResolvers<unknown>();
    using ctx = await rawRequest(stream => {
      stream.session!.close();
      const pushAllowed = stream.pushAllowed;
      try {
        stream.pushStream({ ":path": "/pushed" }, () => {});
        result.resolve({ pushAllowed });
      } catch (err) {
        result.resolve({ pushAllowed, code: (err as NodeJS.ErrnoException).code });
      }
      stream.respond({ ":status": 200 });
      stream.end();
    });
    expect(await result.promise).toEqual({ pushAllowed: false, code: "ERR_HTTP2_PUSH_DISABLED" });
    await ctx.c.waitClosed();
    expect(ctx.c.frames.filter(f => f.type === FrameType.PUSH_PROMISE)).toEqual([]);
  });
});

describe("endStream with waitForTrailers", () => {
  test.each([
    ["GET", { waitForTrailers: true }],
    ["POST", { endStream: true, waitForTrailers: true }],
  ])("a %s request ends on its HEADERS frame and never asks for trailers", async (method, options) => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    try {
      const req = client.request({ ":method": method, ":path": "/" }, options);
      req.on("error", () => {});
      let wantTrailers = 0;
      req.on("wantTrailers", () => wantTrailers++);
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      // Everything the client wrote for the request is ahead of the PING ACK.
      raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
      await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0);
      expect(raw.frames.filter(f => f.streamId === 1).map(f => [f.type, f.flags])).toEqual([[FrameType.HEADERS, 0x5]]);
      expect(wantTrailers).toBe(0);
      expect(() => req.sendTrailers({ "x-late": "1" })).toThrow(
        expect.objectContaining({ code: "ERR_HTTP2_TRAILERS_NOT_READY" }),
      );
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

describe("empty DATA frames (RFC 9113 §6.1)", () => {
  const HEADERS = [FrameType.HEADERS, 0x4];
  const TRAILERS = [FrameType.HEADERS, 0x5];
  /** `[type, flags, length?]` of every frame on `streamId`, in wire order. HEADERS frames omit the length. */
  const streamFrames = (raw: RawH2Server, streamId: number) =>
    raw.frames
      .filter(f => f.streamId === streamId)
      .map(f => (f.type === FrameType.HEADERS ? [f.type, f.flags] : [f.type, f.flags, f.length]));
  const endOfStream = (streamId: number) => (f: Frame) => f.streamId === streamId && (f.flags & 0x1) !== 0;

  /** Connect a client to a raw server and finish the SETTINGS handshake. */
  async function connectClient() {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    await raw.waitFor(f => f.type === FrameType.SETTINGS);
    raw.sendFrame(FrameType.SETTINGS, 0, 0);
    raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
    await once(client, "remoteSettings");
    return { raw, client };
  }

  test("end() with trailers pending sends only the trailers", async () => {
    const { raw, client } = await connectClient();
    try {
      const req = client.request({ ":method": "POST", ":path": "/" }, { waitForTrailers: true });
      req.on("error", () => {});
      req.on("wantTrailers", () => req.sendTrailers({ "x-trailer": "1" }));
      req.end();
      await raw.waitFor(endOfStream(1));
      expect(streamFrames(raw, 1)).toEqual([HEADERS, TRAILERS]);
    } finally {
      client.destroy();
      raw.close();
    }
  });

  test("empty writes send nothing", async () => {
    const { raw, client } = await connectClient();
    try {
      const req = client.request({ ":method": "POST", ":path": "/" });
      req.on("error", () => {});
      for (const chunk of ["", Buffer.alloc(0), "payload", ""]) {
        await new Promise<void>(resolve => req.write(chunk, () => resolve()));
      }
      req.end();
      await raw.waitFor(endOfStream(1));
      expect(streamFrames(raw, 1)).toEqual([HEADERS, [FrameType.DATA, 0, 7], [FrameType.DATA, 0x1, 0]]);
    } finally {
      client.destroy();
      raw.close();
    }
  });

  test("end() with trailers pending sends only the trailers when it was queued behind blocked DATA", async () => {
    const { raw, client } = await connectClient();
    try {
      // One byte more than both send windows, so every later frame goes through the outbound queue.
      const blocked = client.request({ ":method": "POST", ":path": "/blocked" });
      blocked.on("error", () => {});
      blocked.write(Buffer.alloc(65535 + 1, "a"));
      const blockedBytes = () => raw.frames.reduce((n, f) => (f.streamId === 1 && f.type === 0 ? n + f.length : n), 0);
      await raw.waitFor(() => blockedBytes() >= 65535);

      const req = client.request({ ":method": "POST", ":path": "/" }, { waitForTrailers: true });
      req.on("error", () => {});
      req.on("wantTrailers", () => req.sendTrailers({ "x-trailer": "1" }));
      req.end();
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 3);
      const increment = Buffer.alloc(4);
      increment.writeUInt32BE(65535);
      raw.sendFrame(FrameType.WINDOW_UPDATE, 0, 0, increment);
      await raw.waitFor(endOfStream(3));
      expect(streamFrames(raw, 3)).toEqual([HEADERS, TRAILERS]);
    } finally {
      client.destroy();
      raw.close();
    }
  });

  test("'frameError' reports the stream id", async () => {
    const { raw, client } = await connectClient();
    try {
      client.request({ ":path": "/other" }).on("error", () => {});
      const req = client.request({ ":method": "POST", ":path": "/" }, { waitForTrailers: true });
      req.on("error", () => {});
      req.on("wantTrailers", () => req.sendTrailers({ "x-big": Buffer.alloc(64 * 1024 + 1, "x").toString() }));
      req.end();
      expect(await once(req, "frameError")).toEqual([FrameType.HEADERS, ErrorCode.FRAME_SIZE_ERROR, 3]);
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

describe("inbound flow control after local end-stream (RFC 9113 §6.9)", () => {
  // Regression coverage for the test-http2-pipe failure mode: the server responds and ends its
  // side before the request body arrives, the request body is piped into a backpressured
  // writable, and the upload is larger than the 64 KiB initial windows. The server must keep
  // sending WINDOW_UPDATE as the consumer drains so the upload completes.
  test("WINDOW_UPDATE keeps flowing for a request body received after the response ended, with a backpressured reader", async () => {
    const total = 256 * 1024;
    let received = 0;
    const finished = Promise.withResolvers<void>();
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      // Slow consumer: tiny highWaterMark + async completion forces repeated pause/resume of the
      // request readable while the body is still arriving.
      const slow = new Writable({
        highWaterMark: 1024,
        write(chunk: Buffer, _enc, cb) {
          received += chunk.length;
          setImmediate(cb);
        },
      });
      slow.on("finish", () => finished.resolve());
      stream.on("error", (err: Error) => finished.reject(err));
      stream.pipe(slow);
      stream.respond({ ":status": 200 });
      stream.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      await c.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0);
      c.sendSettingsAck();
      // POST / without END_STREAM: static-table indexed [:method POST, :scheme http, :path /]
      // plus a literal :authority.
      const block = Buffer.concat([Buffer.from([0x83, 0x86, 0x84, 0x01]), hpackLiteral("localhost")]);
      c.sendFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 1, block);
      // Wait until the response has fully ended (HEADERS then END_STREAM) before sending any of
      // the request body — that ordering is what previously stalled the inbound windows.
      await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      await c.waitFor(f => f.streamId === 1 && (f.flags & 0x1) !== 0);

      // Send the body respecting flow control: track WINDOW_UPDATE frames the server sends and
      // never exceed the connection/stream windows (initially 65535 each).
      let connWindow = 65535;
      let streamWindow = 65535;
      let harvested = 0;
      const harvestWindowUpdates = () => {
        for (; harvested < c.frames.length; harvested++) {
          const f = c.frames[harvested];
          if (f.type !== FrameType.WINDOW_UPDATE) continue;
          const inc = f.payload.readUInt32BE(0) & 0x7fffffff;
          if (f.streamId === 0) connWindow += inc;
          else if (f.streamId === 1) streamWindow += inc;
        }
      };
      const windowUpdateCount = () => c.frames.filter(f => f.type === FrameType.WINDOW_UPDATE).length;
      let sent = 0;
      while (sent < total) {
        harvestWindowUpdates();
        const budget = Math.min(connWindow, streamWindow, 16384, total - sent);
        if (budget <= 0) {
          // Stalled on flow control: wait for the server to grant more window. If it never does,
          // this rejects and the test fails with the stall position.
          const before = windowUpdateCount();
          await c
            .waitFor(() => windowUpdateCount() > before, 3000)
            .catch(() => {
              throw new Error(
                `flow control stalled: sent=${sent} connWindow=${connWindow} streamWindow=${streamWindow}`,
              );
            });
          continue;
        }
        const last = sent + budget >= total;
        c.sendFrame(FrameType.DATA, last ? 0x1 /* END_STREAM */ : 0, 1, Buffer.alloc(budget, 0x61));
        sent += budget;
        connWindow -= budget;
        streamWindow -= budget;
      }
      await finished.promise;
      expect(received).toBe(total);
    } finally {
      c.destroy();
      server.close();
    }
  });
});

// duplexPair() delivers a write to the peer, and the peer's answer back, before write() returns.
describe("a transport that delivers the peer's answer inside write()", () => {
  test("two responses larger than the window complete over duplexPair()", async () => {
    // Windows defaults to 16 KiB, where every window-sized write reports backpressure and 'drain' hides the stall.
    const [clientSide, serverSide] = duplexPair({ highWaterMark: 64 * 1024 });
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.resume();
      stream.on("end", () => {
        stream.respond({ ":status": 200 });
        stream.end(Buffer.alloc(200_000, 0x72));
      });
    });
    server.emit("connection", serverSide);
    const client = http2.connect("http://localhost", { createConnection: () => clientSide });
    try {
      // clientSide is still busy with the first request's body, so only the second WINDOW_UPDATE arrives inside a write.
      const received: number[] = [];
      for (let i = 0; i < 2; i++) {
        const req = client.request({ ":method": "POST", ":path": "/" });
        let bytes = 0;
        req.on("data", (chunk: Buffer) => (bytes += chunk.length));
        const closed = once(req, "close");
        req.end("hi");
        await closed;
        received.push(bytes);
      }
      expect(received).toEqual([200_000, 200_000]);
    } finally {
      client.destroy();
      serverSide.destroy();
    }
  });

  const u32 = (value: number) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value);
    return buffer;
  };
  const DEFAULT_WINDOW = 65535;
  const BODY_LENGTH = 200_000;

  // One send window keeps its default size and the other is 1 MiB. The raw server answers from
  // inside _write() as soon as the request body has used up the default one.
  test.each([
    ["connection", "WINDOW_UPDATE"],
    ["stream", "WINDOW_UPDATE"],
    ["connection", "RST_STREAM and WINDOW_UPDATE"],
  ])("a request body that uses up the %s window is answered with %s", async (limit, answer) => {
    const reset = answer !== "WINDOW_UPDATE";
    let unparsed = Buffer.alloc(0);
    let prefaceSeen = false;
    let answered = false;
    const body = { beforeAnswer: 0, afterAnswer: 0, endStream: false };
    const headersSent = Promise.withResolvers<void>();
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        unparsed = Buffer.concat([unparsed, chunk]);
        if (!prefaceSeen && unparsed.length >= PREFACE.length) {
          unparsed = unparsed.subarray(PREFACE.length);
          prefaceSeen = true;
        }
        while (prefaceSeen && unparsed.length >= 9) {
          const length = unparsed.readUIntBE(0, 3);
          if (unparsed.length < 9 + length) break;
          const type = unparsed[3];
          const flags = unparsed[4];
          const streamId = unparsed.readUInt32BE(5) & 0x7fffffff;
          unparsed = unparsed.subarray(9 + length);
          if (streamId !== 1) continue;
          if (type === FrameType.HEADERS) headersSent.resolve();
          if (type !== FrameType.DATA) continue;
          body[answered ? "afterAnswer" : "beforeAnswer"] += length;
          if (flags & 0x1 /* END_STREAM */) {
            body.endStream = true;
            socket.push(encodeFrame(FrameType.HEADERS, 0x5 /* END_STREAM | END_HEADERS */, 1, Buffer.from([0x88])));
          }
        }
        if (!answered && body.beforeAnswer === DEFAULT_WINDOW) {
          answered = true;
          const windowUpdate = encodeFrame(FrameType.WINDOW_UPDATE, 0, limit === "stream" ? 1 : 0, u32(1 << 20));
          const rstStream = encodeFrame(FrameType.RST_STREAM, 0, 1, u32(ErrorCode.CANCEL));
          socket.push(reset ? Buffer.concat([rstStream, windowUpdate]) : windowUpdate);
        }
        callback();
      },
    });

    const client = http2.connect("http://localhost", { createConnection: () => socket });
    try {
      client.on("connect", () => {
        const settings =
          limit === "connection"
            ? encodeFrame(FrameType.SETTINGS, 0, 0, Buffer.concat([Buffer.from([0, 0x4]), u32(1 << 20)]))
            : Buffer.concat([
                encodeFrame(FrameType.SETTINGS, 0, 0),
                encodeFrame(FrameType.WINDOW_UPDATE, 0, 0, u32(1 << 20)),
              ]);
        socket.push(Buffer.concat([settings, encodeFrame(FrameType.SETTINGS, 0x1, 0)]));
      });
      await once(client, "remoteSettings");

      const req = client.request({ ":method": "POST", ":path": "/" });
      req.on("error", () => {});
      req.resume();
      // With the HEADERS frame out nothing is corked, so no deferred flush is pending that would send a queued rest.
      await headersSent.promise;
      const closed = once(req, "close");
      const ended = Promise.withResolvers<void>();
      req.end(Buffer.alloc(BODY_LENGTH, 0x61), () => ended.resolve());
      await Promise.all([closed, ended.promise]);

      expect({ ...body, rstCode: req.rstCode, outboundQueueSize: client.state.outboundQueueSize }).toEqual({
        beforeAnswer: DEFAULT_WINDOW,
        afterAnswer: reset ? 0 : BODY_LENGTH - DEFAULT_WINDOW,
        endStream: !reset,
        rstCode: reset ? ErrorCode.CANCEL : 0,
        outboundQueueSize: 0,
      });
    } finally {
      client.destroy();
    }
  });
});

describe("setLocalWindowSize() (RFC 9113 §6.9.1)", () => {
  test.each(["server", "client"])(
    "a %s session with a 4 MiB connection window receives a body larger than the stream window",
    async side => {
      const total = 200_000;
      const { promise, resolve, reject } = Promise.withResolvers<{ uploaded: number; downloaded: number }>();
      const server = http2.createServer();
      server.on("session", session => {
        if (side === "server") session.setLocalWindowSize(4 << 20);
      });
      server.on("stream", stream => {
        let uploaded = 0;
        stream.on("error", reject);
        stream.on("data", (chunk: Buffer) => (uploaded += chunk.length));
        stream.on("end", () => {
          stream.respond({ ":status": 200, "x-uploaded": uploaded });
          stream.end(Buffer.alloc(total, 0x62));
        });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
      try {
        client.on("error", reject);
        await once(client, "connect");
        if (side === "client") client.setLocalWindowSize(4 << 20);
        const req = client.request({ ":method": "POST", ":path": "/" });
        let uploaded = -1;
        let downloaded = 0;
        req.on("error", reject);
        req.on("response", headers => (uploaded = Number(headers["x-uploaded"])));
        req.on("data", (chunk: Buffer) => (downloaded += chunk.length));
        req.on("end", () => resolve({ uploaded, downloaded }));
        req.end(Buffer.alloc(total, 0x61));
        expect(await promise).toEqual({ uploaded: total, downloaded: total });
      } finally {
        client.destroy();
        server.close();
      }
    },
  );

  test("a raise after a smaller size only grants the credit the peer doesn't have yet", async () => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    try {
      await once(client, "connect");
      client.setLocalWindowSize(20);
      const shrunk = client.state;
      client.setLocalWindowSize(1 << 20);
      const raised = client.state;
      const update = await raw.waitFor(f => f.type === FrameType.WINDOW_UPDATE && f.streamId === 0);
      expect({
        increment: update.payload.readUInt32BE(0),
        shrunk: [shrunk.effectiveLocalWindowSize, shrunk.localWindowSize],
        raised: [raised.effectiveLocalWindowSize, raised.localWindowSize],
      }).toEqual({
        increment: (1 << 20) - 65535,
        shrunk: [20, 65535],
        raised: [1 << 20, 1 << 20],
      });
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

describe("SETTINGS_INITIAL_WINDOW_SIZE changes on open streams (RFC 9113 §6.9.2)", () => {
  const initialWindowSettings = (value: number) => {
    const payload = Buffer.alloc(6);
    payload.writeUInt16BE(0x4, 0);
    payload.writeUInt32BE(value, 2);
    return encodeFrame(FrameType.SETTINGS, 0, 0, payload);
  };
  const windowUpdate = (streamId: number, increment: number) => {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(increment);
    return encodeFrame(FrameType.WINDOW_UPDATE, 0, streamId, payload);
  };
  const lowersWindowTo1024 = (f: Frame) =>
    f.type === FrameType.SETTINGS &&
    (f.flags & 0x1) === 0 &&
    f.payload.includes(initialWindowSettings(1024).subarray(9));

  /** Finish the SETTINGS handshake, then open a POST on stream 1 without END_STREAM. */
  async function openPostStream(c: RawH2) {
    c.sendPreface();
    c.sendEmptySettings();
    await c.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0);
    c.sendSettingsAck();
    c.sendFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 1, requestHeaderBlock("POST"));
  }

  test("a server that lowers the window mid-upload replenishes against the new size", async () => {
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.on("error", () => {});
      stream.resume();
      stream.session!.settings({ initialWindowSize: 1024 });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      await openPostStream(c);
      await c.waitFor(lowersWindowTo1024);
      c.sendSettingsAck();
      // 65535 + (1024 - 65535) leaves 1024 bytes of stream window. Use all of it.
      c.sendFrame(FrameType.DATA, 0, 1, Buffer.alloc(1024, 0x61));
      const update = await c.waitFor(f => f.type === FrameType.WINDOW_UPDATE && f.streamId === 1);
      expect(update.payload.readUInt32BE(0)).toBe(1024);
    } finally {
      c.destroy();
      server.close();
    }
  });

  test("a SETTINGS ACK read while a 'stream' listener runs still resizes open streams", async () => {
    const [clientSide, serverSide] = duplexPair();
    const server = http2.createServer();
    let session: http2.ServerHttp2Session | undefined;
    server.on("session", s => (session = s));
    server.on("stream", stream => {
      stream.on("error", () => {});
      stream.resume();
      stream.session!.settings({ initialWindowSize: 1024 });
      serverSide.emit("data", encodeFrame(FrameType.SETTINGS, 0x1, 0));
    });
    const c = new RawH2(clientSide);
    server.emit("connection", serverSide);
    try {
      await openPostStream(c);
      await c.waitFor(lowersWindowTo1024);
      c.sendFrame(FrameType.DATA, 0, 1, Buffer.alloc(1024, 0x61));
      const update = await c.waitFor(f => f.type === FrameType.WINDOW_UPDATE && f.streamId === 1);
      expect(update.payload.readUInt32BE(0)).toBe(1024);
    } finally {
      c.destroy();
      session?.destroy();
    }
  });

  const dataBytes = (raw: RawH2Server) =>
    raw.frames.reduce((n, f) => (f.type === FrameType.DATA && f.streamId === 1 ? n + f.length : n), 0);
  /** The PING ACK follows every DATA frame the client could send, so `dataBytes` is final after this. */
  async function flushClient(raw: RawH2Server) {
    raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
    await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0);
  }
  // A 16 MiB connection window makes the stream window the only limit.
  const handshake = (settings: Buffer) =>
    Buffer.concat([settings, encodeFrame(FrameType.SETTINGS, 0x1, 0), windowUpdate(0, 16 << 20)]);

  test.each([
    ["first", true],
    ["second", false],
  ])("a client stays inside the window after the server's %s SETTINGS frame lowers it", async (_, inFirstSettings) => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    try {
      const req = client.request({ ":method": "POST", ":path": "/" });
      req.on("error", () => {});
      req.end(Buffer.alloc(80 * 1024, 0x61));
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      if (!inFirstSettings) raw.socket!.write(handshake(encodeFrame(FrameType.SETTINGS, 0, 0)));
      await raw.waitFor(() => dataBytes(raw) >= 65535);
      // 0 + (1024 - 65535) + 65535 leaves 1024 bytes of stream window.
      const lower = inFirstSettings ? handshake(initialWindowSettings(1024)) : initialWindowSettings(1024);
      raw.socket!.write(Buffer.concat([lower, windowUpdate(1, 65535)]));
      await flushClient(raw);
      expect(dataBytes(raw)).toBe(65535 + 1024);
    } finally {
      client.destroy();
      raw.close();
    }
  });

  test("a client adds a larger window to the WINDOW_UPDATE credit the stream already has", async () => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    try {
      const req = client.request({ ":method": "POST", ":path": "/" });
      req.on("error", () => {});
      req.end(Buffer.alloc(256 * 1024, 0x61));
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      raw.socket!.write(Buffer.concat([handshake(encodeFrame(FrameType.SETTINGS, 0, 0)), windowUpdate(1, 10000)]));
      await raw.waitFor(() => dataBytes(raw) >= 75535);
      raw.socket!.write(initialWindowSettings(100000));
      await flushClient(raw);
      expect(dataBytes(raw)).toBe(75535 + (100000 - 65535));
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

  test("a smaller maxFrameSize binds the peer's frames from its ACK on", async () => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`, { settings: { maxFrameSize: 65536 } });
    const sessionError = Promise.withResolvers<NodeJS.ErrnoException>();
    client.on("error", sessionError.resolve);
    try {
      const isSettings = (f: Frame) => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0;
      await raw.waitFor(isSettings);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      raw.sendFrame(FrameType.SETTINGS, 0x1, 0); // ACK 65536
      await once(client, "localSettings");

      client.settings({ maxFrameSize: 16384 });
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      let received = 0;
      req.on("data", (d: Buffer) => (received += d.length));
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      expect(raw.frames.filter(isSettings).length).toBe(2);

      raw.sendFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 1, Buffer.from([0x88]));
      raw.sendFrame(FrameType.DATA, 0, 1, Buffer.alloc(32768, 0x61));
      raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
      await raw.waitFor(f => f.type === FrameType.GOAWAY || (f.type === FrameType.PING && (f.flags & 0x1) !== 0));
      expect(raw.frames.filter(f => f.type === FrameType.GOAWAY)).toEqual([]);

      raw.sendFrame(FrameType.SETTINGS, 0x1, 0); // ACK 16384
      raw.sendFrame(FrameType.DATA, 0x1 /* END_STREAM */, 1, Buffer.alloc(16385, 0x61));
      expect(goawayErrorCode(await raw.waitFor(f => f.type === FrameType.GOAWAY))).toBe(ErrorCode.FRAME_SIZE_ERROR);
      expect((await sessionError.promise).code).toBe("ERR_HTTP2_ERROR");
      expect(received).toBe(32768);
    } finally {
      client.destroy();
      raw.close();
    }
  });

  // nghttp2 calls this "SETTINGS: unexpected ACK". Node reports ERR_HTTP2_ERROR "Protocol error".
  describe("a SETTINGS ACK with no SETTINGS outstanding", () => {
    const isPingAck = (f: Frame) => f.type === FrameType.PING && (f.flags & 0x1) !== 0;
    const isGoaway = (f: Frame) => f.type === FrameType.GOAWAY;
    const PROTOCOL_ERROR_SESSION = { code: "ERR_HTTP2_ERROR", message: "Protocol error" };

    test("ends a server session", async () => {
      const sessionError = Promise.withResolvers<NodeJS.ErrnoException>();
      const server = http2.createServer();
      server.on("sessionError", sessionError.resolve);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const c = await RawH2.connect((server.address() as net.AddressInfo).port);
      try {
        c.sendPreface();
        c.sendEmptySettings();
        c.sendSettingsAck(); // for the server's first SETTINGS frame
        c.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
        await c.waitFor(isPingAck);
        expect(c.frames.filter(isGoaway)).toEqual([]);
        c.sendSettingsAck();
        expect(goawayErrorCode(await c.waitForGoaway())).toBe(ErrorCode.PROTOCOL_ERROR);
        const { code, message } = await sessionError.promise;
        expect({ code, message }).toEqual(PROTOCOL_ERROR_SESSION);
      } finally {
        c.destroy();
        server.close();
      }
    });

    test("ends a client session", async () => {
      const raw = await RawH2Server.listen();
      const client = http2.connect(`http://127.0.0.1:${raw.port}`);
      const sessionError = once(client, "error");
      try {
        await raw.waitFor(f => f.type === FrameType.SETTINGS);
        raw.sendFrame(FrameType.SETTINGS, 0, 0);
        raw.sendFrame(FrameType.SETTINGS, 0x1, 0); // for the client's first SETTINGS frame
        raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
        await raw.waitFor(isPingAck);
        expect(raw.frames.filter(isGoaway)).toEqual([]);
        raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
        expect(goawayErrorCode(await raw.waitFor(isGoaway))).toBe(ErrorCode.PROTOCOL_ERROR);
        const [{ code, message }] = await sessionError;
        expect({ code, message }).toEqual(PROTOCOL_ERROR_SESSION);
      } finally {
        client.destroy();
        raw.close();
      }
    });
  });
});

describe("malformed responses (RFC 9113 §8.1, §8.1.1)", () => {
  const END_STREAM = 0x1;
  const END_HEADERS = 0x4;
  const PADDED = 0x8;
  // Literal fields without indexing. 8 is `:status` and 28 is `content-length` in the static table.
  const status = (code: number) => Buffer.concat([Buffer.from([0x08]), hpackLiteral(String(code))]);
  const contentLength = (length: number) => Buffer.concat([Buffer.from([0x0f, 0x0d]), hpackLiteral(String(length))]);
  const ok = (length: number) => Buffer.concat([status(200), contentLength(length)]);
  const TRAILERS = Buffer.concat([Buffer.from([0x00]), hpackLiteral("x-trailer"), hpackLiteral("1")]);
  const headers = (block: Buffer, flags = 0, id = 1) => encodeFrame(FrameType.HEADERS, END_HEADERS | flags, id, block);
  const data = (body: string, flags = 0, id = 1) => encodeFrame(FrameType.DATA, flags, id, Buffer.from(body));
  const padded = (body: string, padding: number) =>
    encodeFrame(
      FrameType.DATA,
      END_STREAM | PADDED,
      1,
      Buffer.concat([Buffer.from([padding]), Buffer.from(body), Buffer.alloc(padding)]),
    );
  /** PUSH_PROMISE on stream 1 that reserves stream 2. */
  const promise = (method: string) =>
    encodeFrame(
      FrameType.PUSH_PROMISE,
      END_HEADERS,
      1,
      Buffer.concat([
        Buffer.from([0, 0, 0, 2, 0x02]),
        hpackLiteral(method),
        Buffer.from([0x86, 0x84, 0x01]),
        hpackLiteral("localhost"),
      ]),
    );
  const inOneRead = (...frames: Buffer[]) => [Buffer.concat(frames)];
  /** The second read starts after `payloadBytes` bytes of the last frame's payload. */
  const inTwoReads = (payloadBytes: number, ...frames: Buffer[]) => {
    const bytes = Buffer.concat(frames);
    const cut = bytes.length - frames[frames.length - 1].length + 9 + payloadBytes;
    return [bytes.subarray(0, cut), bytes.subarray(cut)];
  };

  type Outcome = { events: string[]; body: string; rstCode: number; wireRst: number[] };
  type Request = { request?: http2.OutgoingHttpHeaders | string[]; pushed?: boolean };

  /** Answers one request with `writes`. Before each later write, the client has delivered data or reset the stream. */
  async function exchange(writes: Buffer[], { request = { ":path": "/" }, pushed = false }: Request): Promise<Outcome> {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    try {
      const id = pushed ? 2 : 1;
      const events: string[] = [];
      let body = "";
      const closed = Promise.withResolvers<http2.ClientHttp2Stream>();
      const firstData = Promise.withResolvers<void>();
      const observe = (stream: http2.ClientHttp2Stream) => {
        stream.on("headers", h => events.push(`headers ${h[":status"]}`));
        stream.on(pushed ? "push" : "response", h => events.push(`response ${h[":status"]}`));
        stream.on("data", chunk => {
          body += chunk;
          firstData.resolve();
        });
        stream.on("end", () => events.push("end"));
        stream.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code}`));
        stream.on("close", () => closed.resolve(stream));
      };
      const req = client.request(request as http2.OutgoingHttpHeaders);
      if (pushed) {
        req.on("error", () => {});
        client.on("stream", observe);
      } else {
        observe(req);
        // A CONNECT request stays open until the client ends it.
        req.on("end", () => req.end());
      }
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
      for (const [i, bytes] of writes.entries()) {
        if (i > 0) {
          await Promise.race([
            firstData.promise,
            raw.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === id),
          ]);
        }
        raw.socket!.write(bytes);
      }
      const stream = await closed.promise;
      // The ACK follows every frame the client wrote for the stream, and only a live session sends it.
      raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
      await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0);
      const wireRst = raw.frames
        .filter(f => f.type === FrameType.RST_STREAM && f.streamId === id)
        .map(f => f.payload.readUInt32BE(0));
      return { events, body, rstCode: stream.rstCode, wireRst };
    } finally {
      client.destroy();
      raw.close();
    }
  }

  const reset = (events: string[], body: string): Outcome => ({
    events: [...events, "error ERR_HTTP2_STREAM_ERROR"],
    body,
    rstCode: ErrorCode.PROTOCOL_ERROR,
    wireRst: [ErrorCode.PROTOCOL_ERROR],
  });
  const delivered = (code: number, body: string): Outcome => ({
    events: [`response ${code}`, "end"],
    body,
    rstCode: ErrorCode.NO_ERROR,
    wireRst: [],
  });
  const PUSHED = { pushed: true };
  const HEAD = { request: { ":method": "HEAD", ":path": "/" } };
  const RAW_HEAD = { request: [":method", "HEAD", ":path", "/"] };
  const CONNECT = { request: { ":method": "CONNECT", ":authority": "localhost:443" } };
  type Row = [name: string, writes: Buffer[], expected: Outcome, options?: Request];
  const run = ([, writes, expected, options = {}]: Row) =>
    exchange(writes, options).then(o => expect(o).toEqual(expected));

  test.each<Row>([
    ["on a request", inOneRead(headers(status(100), END_STREAM)), reset([], "")],
    ["on a pushed stream", inOneRead(promise("GET"), headers(status(100), END_STREAM, 2)), reset([], ""), PUSHED],
  ])("END_STREAM on a 1xx HEADERS block resets the stream: %s", (...row) => run(row));

  test.each<Row>([
    ["then the response", inOneRead(data("early"), headers(status(200)), data("tail", END_STREAM)), reset([], "")],
    ["an empty frame with END_STREAM", inOneRead(data("", END_STREAM)), reset([], "")],
    ["after only a 1xx block", inOneRead(headers(status(103)), data("early", END_STREAM)), reset(["headers 103"], "")],
    ["a frame that arrives in two reads", inTwoReads(2, data("early", END_STREAM)), reset([], "")],
  ])("DATA before the response HEADERS resets the stream: %s", (...row) => run(row));

  const after200 = (body: string) => reset(["response 200"], body);
  test.each<Row>([
    ["a short body", inOneRead(headers(ok(5)), data("xy", END_STREAM)), after200("xy")],
    ["END_STREAM on the HEADERS frame", inOneRead(headers(ok(5), END_STREAM)), reset([], "")],
    [
      "a short body, then trailers",
      inOneRead(headers(ok(5)), data("xy"), headers(TRAILERS, END_STREAM)),
      after200("xy"),
    ],
    ["a short body in two reads", inTwoReads(1, headers(ok(5)), data("xyz", END_STREAM)), after200("xyz")],
    ["a short body padded to the length", inOneRead(headers(ok(5)), padded("xy", 2)), after200("xy")],
    [
      "a short pushed body",
      inOneRead(promise("GET"), headers(ok(5), 0, 2), data("xy", END_STREAM, 2)),
      after200("xy"),
      PUSHED,
    ],
    ["a long body", inOneRead(headers(ok(5)), data("toolong", END_STREAM)), after200("")],
    ["one byte too many", inOneRead(headers(ok(5)), data("hello"), data("!", END_STREAM)), after200("hello")],
    ["a long body in two reads", inTwoReads(3, headers(ok(5)), data("toolong", END_STREAM)), after200("")],
    ["DATA on a response to HEAD", inOneRead(headers(ok(5)), data("hello", END_STREAM)), after200(""), HEAD],
    ["DATA on a 204", inOneRead(headers(status(204)), data("hello", END_STREAM)), reset(["response 204"], "")],
    ["DATA on a 304", inOneRead(headers(status(304)), data("hello", END_STREAM)), reset(["response 304"], "")],
  ])("a body that doesn't match content-length resets the stream: %s", (...row) => run(row));

  const hello = delivered(200, "hello");
  const empty = delivered(200, "");
  test.each<Row>([
    ["an exact body", inOneRead(headers(ok(5)), data("he"), data("llo", END_STREAM)), hello],
    ["an exact body in two reads", inTwoReads(2, headers(ok(5)), data("hello", END_STREAM)), hello],
    ["an exact padded body", inOneRead(headers(ok(5)), padded("hello", 7)), hello],
    ["an exact body, then trailers", inOneRead(headers(ok(5)), data("hello"), headers(TRAILERS, END_STREAM)), hello],
    ["a response to HEAD", inOneRead(headers(ok(1234), END_STREAM)), empty, HEAD],
    ["a response to HEAD sent as a raw header list", inOneRead(headers(ok(1234), END_STREAM)), empty, RAW_HEAD],
    ["a pushed response to HEAD", inOneRead(promise("HEAD"), headers(ok(1234), END_STREAM, 2)), empty, PUSHED],
    ["a 304", inOneRead(headers(Buffer.concat([status(304), contentLength(1234)]), END_STREAM)), delivered(304, "")],
    [
      "a CONNECT tunnel",
      inOneRead(headers(ok(5)), data("hello world", END_STREAM)),
      delivered(200, "hello world"),
      CONNECT,
    ],
  ])("content-length doesn't fail %s", (...row) => run(row));
});

function requestHeaderBlock(method: "GET" | "POST", extra: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([
    Buffer.from([method === "POST" ? 0x83 : 0x82, 0x86, 0x84, 0x01]),
    hpackLiteral("localhost"),
    extra,
  ]);
}

const CONTENT_LENGTH_5 = Buffer.concat([Buffer.from([0x0f, 0x0d]), hpackLiteral("5")]);

describe("WINDOW_UPDATE and the 2^31-1 cap (RFC 9113 §6.9.1)", () => {
  const MAX_WINDOW = 0x7fffffff;
  const UPLOAD = 1000;
  const windowUpdate = (streamId: number, increment: number) => {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(increment);
    return encodeFrame(FrameType.WINDOW_UPDATE, 0, streamId, payload);
  };
  const isReset = (f: Frame) => f.type === FrameType.RST_STREAM || f.type === FrameType.GOAWAY;

  // The response HEADERS are the first inbound frame on a stream the client opened.
  test.each([
    ["in the same read as the response", true],
    ["before any response", false],
  ])("a client counts the bytes it uploaded when the grant arrives %s", async (_, withResponse) => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    try {
      const req = client.request({ ":method": "POST", ":path": "/" });
      req.on("error", () => {});
      const responded = withResponse ? once(req, "response") : undefined;
      req.write(Buffer.alloc(UPLOAD, 0x61));
      await raw.waitFor(f => f.type === FrameType.DATA && f.streamId === 1);
      raw.socket!.write(
        Buffer.concat([
          encodeFrame(FrameType.SETTINGS, 0, 0),
          encodeFrame(FrameType.SETTINGS, 0x1, 0),
          withResponse
            ? encodeFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 1, Buffer.from([0x88]))
            : Buffer.alloc(0),
          // 65535 - 1000 bytes are left, so this takes the window to exactly 2^31-1.
          windowUpdate(1, MAX_WINDOW - (65535 - UPLOAD)),
          encodeFrame(FrameType.PING, 0, 0, Buffer.alloc(8)),
        ]),
      );
      await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0);
      expect(raw.frames.filter(isReset)).toEqual([]);
      if (responded) expect((await responded)[0][":status"]).toBe(200);
      raw.socket!.write(windowUpdate(1, 1));
      const reset = await raw.waitFor(isReset);
      expect([reset.type, reset.streamId, reset.payload.readUInt32BE(0)]).toEqual([
        FrameType.RST_STREAM,
        1,
        ErrorCode.FLOW_CONTROL_ERROR,
      ]);
    } finally {
      client.destroy();
      raw.close();
    }
  });

  // The client sent its 2000 bytes before it saw the smaller window, which is now 1999 bytes below zero.
  test("a server accepts an empty END_STREAM frame after it lowered initialWindowSize below the bytes in flight", async () => {
    const received = Promise.withResolvers<number>();
    const server = http2.createServer();
    server.on("stream", stream => {
      let bytes = 0;
      stream.on("error", () => {});
      if (stream.id === 1) stream.session!.settings({ initialWindowSize: 1 });
      stream.on("data", (chunk: Buffer) => (bytes += chunk.length));
      stream.on("end", () => {
        if (stream.id !== 3) return;
        received.resolve(bytes);
        stream.respond({ ":status": 200 });
        stream.end();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      await c.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0);
      c.sendSettingsAck();
      c.sendFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 1, requestHeaderBlock("POST"));
      await c.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0 && f !== c.frames[0]);
      c.send(
        Buffer.concat([
          encodeFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 3, requestHeaderBlock("POST")),
          encodeFrame(FrameType.DATA, 0, 3, Buffer.alloc(2000, 0x62)),
          encodeFrame(FrameType.SETTINGS, 0x1, 0),
          encodeFrame(FrameType.DATA, 0x1 /* END_STREAM */, 3),
        ]),
      );
      const answer = await c.waitFor(
        f => f.type === FrameType.GOAWAY || (f.type === FrameType.HEADERS && f.streamId === 3),
      );
      expect(answer.type).toBe(FrameType.HEADERS);
      expect(await received.promise).toBe(2000);
    } finally {
      c.destroy();
      server.close();
    }
  });

  // A reset stream is only forgotten at the next read, so every frame goes out in one write.
  test.each([
    ["an open stream", []],
    ["a stream the response has closed", [encodeFrame(FrameType.DATA, 0x1, 1, Buffer.from("hello"))]],
  ])("a client that gets two overflowing grants in one read resets %s once", async (_, restOfResponse) => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    try {
      const closed = Promise.withResolvers<void>();
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      req.on("close", closed.resolve);
      req.resume();
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      raw.socket!.write(
        Buffer.concat([
          encodeFrame(FrameType.SETTINGS, 0, 0),
          encodeFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 1, Buffer.from([0x88])),
          ...restOfResponse,
          windowUpdate(1, MAX_WINDOW),
          windowUpdate(1, MAX_WINDOW),
          encodeFrame(FrameType.PING, 0, 0, Buffer.alloc(8)),
        ]),
      );
      await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0);
      await closed.promise;
      expect(raw.frames.filter(isReset).map(f => [f.type, f.payload.readUInt32BE(0)])).toEqual([
        [FrameType.RST_STREAM, ErrorCode.FLOW_CONTROL_ERROR],
      ]);
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

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

describe("request pseudo-header requirements (RFC 9113 §8.3.1)", () => {
  // HPACK "literal never indexed, new name" (0x10) so the wire shape is exactly what is written
  // and no client library normalizes it away.
  function hpackBlock(pairs: readonly (readonly [string, string])[]): Buffer {
    return Buffer.concat(pairs.flatMap(([n, v]) => [Buffer.from([0x10]), hpackLiteral(n), hpackLiteral(v)]));
  }

  async function probe(
    headers: readonly (readonly [string, string])[],
    opts?: http2.ServerOptions,
  ): Promise<{ dispatched: boolean; frames: Frame[] }> {
    const srv = http2.createServer(opts ?? {});
    srv.on("sessionError", () => {});
    let dispatched = false;
    srv.on("stream", (stream: http2.ServerHttp2Stream) => {
      dispatched = true;
      stream.on("error", () => {});
      try {
        stream.respond({ ":status": 200 });
        stream.end();
      } catch {}
    });
    srv.listen(0, "127.0.0.1");
    await once(srv, "listening");
    const srvPort = (srv.address() as net.AddressInfo).port;
    const c = await RawH2.connect(srvPort);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.sendFrame(FrameType.HEADERS, 0x5, 1, hpackBlock(headers));
      // PING as a barrier: by the time the ACK (or a GOAWAY/close) arrives, the server has
      // fully processed the HEADERS above.
      c.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
      await Promise.race([
        c.waitFor(f => (f.type === FrameType.PING && (f.flags & 1) !== 0) || f.type === FrameType.GOAWAY),
        c.waitClosed(),
      ]);
      return { dispatched, frames: c.frames.slice() };
    } finally {
      c.destroy();
      srv.close();
    }
  }

  function expectStreamProtocolError({ dispatched, frames }: { dispatched: boolean; frames: Frame[] }) {
    expect(dispatched).toBe(false);
    const rst = frames.find(f => f.type === FrameType.RST_STREAM && f.streamId === 1);
    expect(rst?.payload.readUInt32BE(0)).toBe(ErrorCode.PROTOCOL_ERROR);
    expect(frames.find(f => f.type === FrameType.HEADERS && f.streamId === 1)).toBeUndefined();
  }

  test.each([
    [
      "empty :path",
      [
        [":method", "GET"],
        [":scheme", "http"],
        [":path", ""],
        [":authority", "localhost"],
      ],
    ],
    [
      "empty :method",
      [
        [":method", ""],
        [":scheme", "http"],
        [":path", "/"],
        [":authority", "localhost"],
      ],
    ],
    [
      "empty :scheme",
      [
        [":method", "GET"],
        [":scheme", ""],
        [":path", "/"],
        [":authority", "localhost"],
      ],
    ],
    [
      "empty :authority",
      [
        [":method", "GET"],
        [":scheme", "http"],
        [":path", "/"],
        [":authority", ""],
      ],
    ],
    [
      "missing :path",
      [
        [":method", "GET"],
        [":scheme", "http"],
        [":authority", "localhost"],
      ],
    ],
    [
      "missing :method",
      [
        [":scheme", "http"],
        [":path", "/"],
        [":authority", "localhost"],
      ],
    ],
    [
      "missing :scheme",
      [
        [":method", "GET"],
        [":path", "/"],
        [":authority", "localhost"],
      ],
    ],
    [
      "no :authority or host",
      [
        [":method", "GET"],
        [":scheme", "http"],
        [":path", "/"],
      ],
    ],
    [
      "CONNECT with :path",
      [
        [":method", "CONNECT"],
        [":authority", "localhost"],
        [":path", "/"],
      ],
    ],
    [
      "CONNECT with :scheme",
      [
        [":method", "CONNECT"],
        [":authority", "localhost"],
        [":scheme", "http"],
      ],
    ],
    ["CONNECT without :authority", [[":method", "CONNECT"]]],
  ] as const)("a request with %s is RST with PROTOCOL_ERROR and never dispatched", async (_, headers) => {
    expectStreamProtocolError(await probe(headers));
  });

  test.each([
    [
      ":protocol on non-CONNECT",
      [
        [":method", "GET"],
        [":scheme", "http"],
        [":path", "/"],
        [":authority", "localhost"],
        [":protocol", "websocket"],
      ],
    ],
    [
      "extended CONNECT without :scheme",
      [
        [":method", "CONNECT"],
        [":protocol", "websocket"],
        [":path", "/"],
        [":authority", "localhost"],
      ],
    ],
    [
      "extended CONNECT without :path",
      [
        [":method", "CONNECT"],
        [":protocol", "websocket"],
        [":scheme", "http"],
        [":authority", "localhost"],
      ],
    ],
    [
      "extended CONNECT without :authority",
      [
        [":method", "CONNECT"],
        [":protocol", "websocket"],
        [":scheme", "http"],
        [":path", "/"],
      ],
    ],
    [
      "extended CONNECT with empty :path",
      [
        [":method", "CONNECT"],
        [":protocol", "websocket"],
        [":scheme", "http"],
        [":path", ""],
        [":authority", "localhost"],
      ],
    ],
  ] as const)("with enableConnectProtocol: %s is RST with PROTOCOL_ERROR and never dispatched", async (_, headers) => {
    expectStreamProtocolError(await probe(headers, { settings: { enableConnectProtocol: true } }));
  });

  test("a valid request block is dispatched", async () => {
    const { dispatched, frames } = await probe([
      [":method", "GET"],
      [":scheme", "http"],
      [":path", "/"],
      [":authority", "localhost"],
    ]);
    expect(dispatched).toBe(true);
    expect(frames.find(f => f.type === FrameType.RST_STREAM && f.streamId === 1)).toBeUndefined();
  });

  test("a request with a host header in place of :authority is dispatched", async () => {
    const { dispatched, frames } = await probe([
      [":method", "GET"],
      [":scheme", "http"],
      [":path", "/"],
      ["host", "localhost"],
    ]);
    expect(dispatched).toBe(true);
    expect(frames.find(f => f.type === FrameType.RST_STREAM && f.streamId === 1)).toBeUndefined();
  });

  test("a plain CONNECT with only :authority is dispatched", async () => {
    const { dispatched, frames } = await probe([
      [":method", "CONNECT"],
      [":authority", "localhost"],
    ]);
    expect(dispatched).toBe(true);
    expect(frames.find(f => f.type === FrameType.RST_STREAM && f.streamId === 1)).toBeUndefined();
  });

  test("an extended CONNECT (:protocol) with :scheme/:path/:authority is dispatched", async () => {
    const { dispatched, frames } = await probe(
      [
        [":method", "CONNECT"],
        [":protocol", "websocket"],
        [":scheme", "http"],
        [":path", "/"],
        [":authority", "localhost"],
      ],
      { settings: { enableConnectProtocol: true } },
    );
    expect(dispatched).toBe(true);
    expect(frames.find(f => f.type === FrameType.RST_STREAM && f.streamId === 1)).toBeUndefined();
  });
});

// A stream nothing references any more can still survive a bounded number of collections: JSC scans
// the machine stack conservatively and honors interior pointers, so a stale word left in a native
// frame (seen on x64 as cell+0x84 in the microtask-drain frames; near-deterministic on aarch64) pins
// one object until that slot is overwritten. The leaks these tests guard against retain every stream,
// so they open many streams and tolerate a few stragglers instead of demanding exactly zero.
const GC_STRAGGLERS = 3;

/**
 * Collects until every one of `refs` is gone, giving up after 50 passes or once the count has not
 * moved for 10 passes, and resolves to how many survived.
 */
async function liveCount(refs: WeakRef<object>[]): Promise<number> {
  const live = () => refs.filter(ref => ref.deref() !== undefined).length;
  // A completed stream's JS teardown is spread over a few immediates (rstNextTick, deferred
  // destroy), and a WeakRef target survives the job that dereferenced it, so every pass gets a
  // fresh turn before collecting.
  let last = live();
  for (let pass = 0, stuck = 0; pass < 50 && last > 0 && stuck < 10; pass++) {
    await new Promise(resolve => setImmediate(resolve));
    await gcTick();
    const now = live();
    stuck = now === last ? stuck + 1 : 0;
    last = now;
  }
  return last;
}

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
      expect(await liveCount(refs)).toBeLessThanOrEqual(GC_STRAGGLERS);
    } finally {
      c.destroy();
      server.close();
    }
  });

  // A header-value `toString` runs user JS while sendTrailers holds the native `&mut Stream`;
  // feeding the stream's own RST_STREAM (then another read) back into the parser from that
  // callback must not free the Stream out from under the caller (use-after-free under ASAN).
  test.each(["client", "server"])(
    "a destroyed %s session that stays reachable releases settings() callbacks that were never ACKed",
    async side => {
      const silentPeer = net.createServer(socket => socket.on("error", () => {}).resume());
      silentPeer.listen(0, "127.0.0.1");
      await once(silentPeer, "listening");
      const { port } = silentPeer.address() as net.AddressInfo;
      const refs: WeakRef<object>[] = [];
      const callbackHolding = (payload: object) => {
        refs.push(new WeakRef(payload));
        return () => payload;
      };
      try {
        const sessions = await Promise.all(
          Array.from({ length: 20 }, async () => {
            const socket = net.connect(port, "127.0.0.1");
            socket.on("error", () => {});
            await once(socket, "connect");
            const session =
              side === "client"
                ? http2.connect("http://127.0.0.1", { createConnection: () => socket })
                : http2.performServerHandshake(socket);
            session.on("error", () => {});
            const closed = once(session, "close");
            session.settings({}, callbackHolding({ bytes: new Uint8Array(64 * 1024) }));
            session.destroy();
            await closed;
            return session;
          }),
        );
        expect(await liveCount(refs)).toBeLessThanOrEqual(GC_STRAGGLERS);
        expect(sessions.every(session => session.destroyed)).toBe(true);
      } finally {
        silentPeer.close();
      }
    },
  );

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

  // emitErrorToAllStreams must reject a non-numeric error code up front instead of reading it
  // once per live stream. goaway() is stubbed because its own number check sits in front of
  // this path in destroy().
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
          console.log("destroy threw: " + e.code);
        }
        // A numeric code must still tear every open stream down. (null, not undefined: like node,
        // an undefined error takes the NGHTTP2_NO_ERROR default and the code argument is ignored.)
        client.destroy(null, 8);
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
      "destroy threw: ERR_INVALID_ARG_TYPE
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
      // node refuses an over-budget stream with ENHANCE_YOUR_CALM (Http2Session::OnBeginHeadersCallback);
      // node's own sequential/test-http2-max-session-memory.js asserts this exact code.
      expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.ENHANCE_YOUR_CALM);
      expect(c.frames.find(f => f.type === FrameType.HEADERS && f.streamId === 3)).toBeUndefined();
    } finally {
      c.destroy();
      server.close();
    }
  });

  test("counts the streams a client holds open against maxSessionMemory", async () => {
    const server = http2.createServer({ maxSessionMemory: 1 });
    server.on("stream", (stream: any) => stream.on("error", () => {}));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      // Node 26 refuses the 1,329th.
      const block = requestHeaderBlock("POST");
      const requests: Buffer[] = [];
      for (let id = 1; id < 3000; id += 2) requests.push(encodeFrame(FrameType.HEADERS, 0x4, id, block));
      c.send(Buffer.concat(requests));
      const rst = await c.waitFor(f => f.type === FrameType.RST_STREAM, 20_000);
      expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.ENHANCE_YOUR_CALM);
      expect(rst.streamId).toBeGreaterThan(2000);
    } finally {
      c.destroy();
      server.close();
    }
  }, 30_000);

  // grpc-js passes maxSessionMemory: Number.MAX_SAFE_INTEGER to disable the limit. node keeps the
  // option as a double, so any huge value means "no limit"; it must saturate, not wrap to the
  // 1MB minimum (#41294).
  test.each([
    ["Number.MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
    ["2**51", 2 ** 51],
    ["2**32", 2 ** 32],
  ])(
    "serves a new request stream with queued response data when maxSessionMemory is %s",
    async (_, maxSessionMemory) => {
      const server = http2.createServer({ maxSessionMemory });
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
        const reply = await c.waitFor(
          f => (f.type === FrameType.HEADERS || f.type === FrameType.RST_STREAM) && f.streamId === 3,
        );
        expect(reply.type).toBe(FrameType.HEADERS);
      } finally {
        c.destroy();
        server.close();
      }
    },
  );

  test("emits 'trailers' for a trailer block that arrives after session.close()", async () => {
    const events: string[] = [];
    const done = Promise.withResolvers<void>();
    const server = http2.createServer();
    server.on("stream", (stream: any) => {
      stream.on("trailers", (headers: any) => events.push("trailers " + headers["x-trailer"]));
      stream.on("end", () => {
        events.push("end");
        stream.respond({ ":status": 200 });
        stream.end("ok");
      });
      stream.on("close", () => {
        events.push("close");
        done.resolve();
      });
      stream.resume();
      stream.session.close();
    });
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
      await c.waitForGoaway();
      const trailers = Buffer.concat([Buffer.from([0x00]), hpackLiteral("x-trailer"), hpackLiteral("1")]);
      c.sendFrame(FrameType.HEADERS, 0x5, 1, trailers);
      await done.promise;
      expect(events).toEqual(["trailers 1", "end", "close"]);
    } finally {
      c.destroy();
      server.close();
    }
  });

  test("respond() still answers an open stream when queued response data is over maxSessionMemory", async () => {
    const server = http2.createServer({ maxSessionMemory: 1 });
    const streams: any[] = [];
    const streamError = Promise.withResolvers<never>();
    server.on("stream", (stream: any) => {
      stream.on("error", streamError.reject);
      streams.push(stream);
      if (streams.length < 2) return;
      const [first, second] = streams;
      first.respond({ ":status": 200 });
      first.end(Buffer.alloc(1 << 22, "a"));
      second.respond({ ":status": 200 });
      second.end("ok");
    });
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.send(
        Buffer.concat([
          encodeFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET")),
          encodeFrame(FrameType.HEADERS, 0x5, 3, requestHeaderBlock("GET")),
        ]),
      );
      const reply = await Promise.race([
        c.waitFor(f => (f.type === FrameType.HEADERS || f.type === FrameType.RST_STREAM) && f.streamId === 3),
        streamError.promise,
      ]);
      expect(reply.type).toBe(FrameType.HEADERS);

      await drainFirstStream(c);
      await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 3 && (f.flags & 0x1) === 1);
      const bodyBytes = (streamId: number) =>
        c.frames.filter(f => f.type === FrameType.DATA && f.streamId === streamId).reduce((n, f) => n + f.length, 0);
      expect({ first: bodyBytes(1), second: bodyBytes(3) }).toEqual({ first: 1 << 22, second: 2 });
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
      // node refuses an over-budget stream with ENHANCE_YOUR_CALM (Http2Session::OnBeginHeadersCallback);
      // node's own sequential/test-http2-max-session-memory.js asserts this exact code.
      expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.ENHANCE_YOUR_CALM);

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
      // node refuses an over-budget stream with ENHANCE_YOUR_CALM (Http2Session::OnBeginHeadersCallback);
      // node's own sequential/test-http2-max-session-memory.js asserts this exact code.
      expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.ENHANCE_YOUR_CALM);

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

// A DATA frame that cannot be written right away (the peer's flow-control window is used up, the
// socket has backpressure, or the same stream already has frames waiting) is put on the stream's
// outbound queue and written later, when a WINDOW_UPDATE or a writable socket drains the queue.
// Writing the last queued frame of a stream whose peer half is already closed completes the
// stream, and, exactly like the direct-write path, has to release it (the JS stream object and
// the native entry) while the session lives on. Node releases these streams too; a stream that is
// only released at session teardown is a per-request leak on a long-lived session. The first and
// the last case reach the queue through the stream's own window. The cases that answer behind
// another stream's stalled response are written directly and cover the same release.
describe("stream release after a queued END_STREAM", () => {
  // Well above GC_STRAGGLERS: without the release every one of these survives.
  const STREAMS = 16;
  // The peer advertises a 1 KiB stream window: a 4 KiB body cannot be written in one go, so its
  // tail (the frame carrying END_STREAM) is queued and flushed as the peer's WINDOW_UPDATEs arrive.
  const WINDOW = 1024;
  const BODY = Buffer.alloc(4 * WINDOW, "x");
  // Far more than the default window plus the receiving stream's readable buffer can hold, so a
  // response of this size that the client never reads stays partly queued on the server for good.
  const STALLED_BODY = Buffer.alloc(256 * 1024, "s");

  async function listen(server: http2.Http2Server): Promise<string> {
    server.listen(0);
    await once(server, "listening");
    return `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  }

  /**
   * Sends one request and resolves once the client stream has closed, reporting how many response
   * body bytes arrived and how many frames the client session still had queued when the response
   * headers came in.
   */
  function roundTrip(client: http2.ClientHttp2Session, headers: http2.OutgoingHttpHeaders, body?: Buffer) {
    const { promise, resolve, reject } = Promise.withResolvers<{ received: number; queuedAtResponse: number }>();
    const req = client.request(headers);
    let received = 0;
    let queuedAtResponse = -1;
    req.on("error", reject);
    req.on("response", () => {
      queuedAtResponse = client.state.outboundQueueSize!;
    });
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
    });
    req.on("close", () => resolve({ received, queuedAtResponse }));
    req.end(body);
    return { ref: new WeakRef<object>(req), closed: promise };
  }

  test("server streams whose response outgrew the client's window are released", async () => {
    const refs: WeakRef<object>[] = [];
    const queuedAfterEnd: number[] = [];
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      refs.push(new WeakRef(stream));
      stream.respond({ ":status": 200 });
      stream.end(BODY);
      queuedAfterEnd.push(stream.session!.state.outboundQueueSize!);
    });
    const client = http2.connect(await listen(server), { settings: { initialWindowSize: WINDOW } });
    try {
      const received: number[] = [];
      for (let i = 0; i < STREAMS; i++) {
        received.push((await roundTrip(client, { ":path": "/" }).closed).received);
      }
      // The premise: each response left part of its body queued, and the queue then delivered it.
      expect({ tailQueued: queuedAfterEnd.map(n => n > 0), received }).toEqual({
        tailQueued: Array(STREAMS).fill(true),
        received: Array(STREAMS).fill(BODY.length),
      });
      expect(await liveCount(refs)).toBeLessThanOrEqual(GC_STRAGGLERS);
    } finally {
      client.close();
      server.close();
    }
  });

  /**
   * Stalls one response on a fresh session (never read on the client: once the client's readable
   * buffer is full it stops replenishing that stream's window, so the server keeps the rest of the
   * response, and with it a non-empty outbound queue, until the session goes away), then runs
   * STREAMS ordinary requests on the same session. `server` must answer "/stalled" with
   * STALLED_BODY and report through `stalledFinished` whether that response ever finished; every
   * other request must register its stream in `refs`. Resolves to how many of `refs` survived GC.
   */
  async function liveAfterRequestsBehindStalledResponse(
    server: http2.Http2Server,
    refs: WeakRef<object>[],
    stalledFinished: () => boolean,
  ): Promise<number> {
    const client = http2.connect(await listen(server));
    try {
      const stalled = client.request({ ":path": "/stalled" });
      let stalledError: Error | null = null;
      stalled.on("error", err => (stalledError = err));
      await once(stalled, "response");
      for (let i = 0; i < STREAMS; i++) {
        await roundTrip(client, { ":path": "/" }).closed;
      }
      expect(refs).toHaveLength(STREAMS);
      const live = await liveCount(refs);
      // The premise: the stalled stream is still open (not errored or reset into releasing the
      // queue) and its response was still queued while the other requests were answered.
      expect(stalledError).toBeNull();
      expect(stalledFinished()).toBe(false);
      stalled.close();
      return live;
    } finally {
      client.close();
      server.close();
    }
  }

  test.each([
    ['end("ok")', (stream: http2.ServerHttp2Stream) => stream.end("ok")],
    ["end() without a body", (stream: http2.ServerHttp2Stream) => stream.end()],
  ])("server streams answered with %s behind another stream's stalled response are released", async (_, finish) => {
    const refs: WeakRef<object>[] = [];
    let stalledFinished = false;
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
      if (headers[":path"] === "/stalled") {
        stream.once("finish", () => {
          stalledFinished = true;
        });
        stream.respond({ ":status": 200 });
        stream.end(STALLED_BODY);
        return;
      }
      refs.push(new WeakRef(stream));
      stream.resume();
      // Answer once the request's END_STREAM has been processed, like a handler that consumes the
      // request body does: the response is then the only thing the stream still waits for.
      stream.on("end", () => {
        stream.respond({ ":status": 200 });
        finish(stream);
      });
    });
    expect(await liveAfterRequestsBehindStalledResponse(server, refs, () => stalledFinished)).toBeLessThanOrEqual(
      GC_STRAGGLERS,
    );
  });

  // The compat API's responses wait for trailers, so after the body END_STREAM always goes out on an
  // empty DATA frame of its own.
  test("server streams answered through the compat API behind another stream's stalled response are released", async () => {
    const refs: WeakRef<object>[] = [];
    let stalledFinished = false;
    const server = http2.createServer((req, res) => {
      if (req.url === "/stalled") {
        res.stream.once("finish", () => {
          stalledFinished = true;
        });
        res.end(STALLED_BODY);
        return;
      }
      refs.push(new WeakRef(res.stream));
      req.resume();
      req.on("end", () => res.end("ok"));
    });
    expect(await liveAfterRequestsBehindStalledResponse(server, refs, () => stalledFinished)).toBeLessThanOrEqual(
      GC_STRAGGLERS,
    );
  });

  test("client streams whose request body outgrew the server's window are released", async () => {
    const refs: WeakRef<object>[] = [];
    const uploaded: Promise<number>[] = [];
    const server = http2.createServer({ settings: { initialWindowSize: WINDOW } });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      // Answer as soon as the headers arrive, so the server's END_STREAM reaches the client while
      // the client still has the body's tail queued, and keep reading the body so that tail really
      // is flushed from the queue (an upload nobody reads gets reset instead, and a reset releases
      // the stream through a different path).
      uploaded.push(
        new Promise((resolve, reject) => {
          let bytes = 0;
          stream.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
          });
          stream.on("end", () => resolve(bytes));
          stream.on("error", reject);
        }),
      );
      stream.respond({ ":status": 200 });
      stream.end();
    });
    const client = http2.connect(await listen(server));
    try {
      // The server's window applies to requests opened after its SETTINGS frame has been received.
      await once(client, "remoteSettings");
      const queuedAtResponse: number[] = [];
      for (let i = 0; i < STREAMS; i++) {
        const { ref, closed } = roundTrip(client, { ":method": "POST", ":path": "/" }, BODY);
        refs.push(ref);
        queuedAtResponse.push((await closed).queuedAtResponse);
      }
      // The premise: each response arrived while the request's tail was still queued, and the queue
      // then delivered that tail.
      expect({ tailQueued: queuedAtResponse.map(n => n > 0), uploaded: await Promise.all(uploaded) }).toEqual({
        tailQueued: Array(STREAMS).fill(true),
        uploaded: Array(STREAMS).fill(BODY.length),
      });
      expect(await liveCount(refs)).toBeLessThanOrEqual(GC_STRAGGLERS);
    } finally {
      client.close();
      server.close();
    }
  });
});

// Stream resets are rate-limited per connection like nghttp2's stream_reset_ratelim (burst 1000,
// refill 33/s): past the bucket the session dies with GOAWAY, surfaced as ERR_HTTP2_ERROR.
describe("stream-reset floods (CVE-2023-44487 rapid reset, CVE-2025-8671 MadeYouReset)", () => {
  const CANCEL = Buffer.alloc(4);
  CANCEL.writeUInt32BE(ErrorCode.CANCEL, 0);
  const rstStream = (sid: number) => encodeFrame(FrameType.RST_STREAM, 0, sid, CANCEL);
  const request = (sid: number) => encodeFrame(FrameType.HEADERS, 0x5, sid, requestHeaderBlock("GET"));
  // END_HEADERS without END_STREAM: the stream stays open until one side resets it.
  const upload = (sid: number) => encodeFrame(FrameType.HEADERS, 0x4, sid, requestHeaderBlock("POST"));
  const pairs = (count: number, firstSid: number, kill: (sid: number) => Buffer) =>
    Buffer.concat(Array.from({ length: count }, (_, i) => [request(firstSid + 2 * i), kill(firstSid + 2 * i)]).flat());
  const calm = (f: Frame) => f.type === FrameType.GOAWAY && goawayErrorCode(f) === ErrorCode.ENHANCE_YOUR_CALM;

  function respondingServer(options: Record<string, unknown> = {}, rejectUploads = false) {
    const state = { handlers: 0, sessionErrorCode: undefined as string | undefined };
    const server = http2.createServer(options);
    server.on("sessionError", (e: any) => (state.sessionErrorCode = e.code));
    server.on("session", s => s.on("error", () => {}));
    server.on("stream", (stream: any, headers: any) => {
      state.handlers++;
      stream.on("error", () => {});
      if (rejectUploads && headers[":method"] === "POST") return stream.close();
      // The uploads these tests hold open need a reader, or the server resets them once they're answered.
      stream.resume();
      stream.respond({ ":status": 200 });
      stream.end("x");
    });
    return { server, state };
  }

  async function withClient<T>(server: http2.Http2Server, body: (c: RawH2) => Promise<T>): Promise<T> {
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      return await body(c);
    } finally {
      c.destroy();
      server.close();
    }
  }

  async function flood(opts: { options?: Record<string, unknown>; count: number; kill?: (sid: number) => Buffer }) {
    const { server, state } = respondingServer(opts.options);
    return withClient(server, async c => {
      c.send(pairs(opts.count, 1, opts.kill ?? rstStream));
      const goaway = await c.waitForGoaway(10_000);
      return { c, goaway, ...state };
    });
  }

  // True when stream `sid` is answered and no GOAWAY came first.
  async function servedBeforeGoaway(c: RawH2, sid: number) {
    const served = (f: Frame) => f.type === FrameType.HEADERS && f.streamId === sid;
    return served(await c.waitFor(f => served(f) || f.type === FrameType.GOAWAY, 10_000));
  }

  test("a RST_STREAM flood is answered with GOAWAY(ENHANCE_YOUR_CALM) and a session error", async () => {
    const { goaway, handlers, sessionErrorCode } = await flood({ count: 1200 });
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.ENHANCE_YOUR_CALM);
    expect(goaway.payload.subarray(8).toString()).toBe("too many stream resets");
    // Like node, every request up to the bucket's edge still reaches the handler.
    expect(handlers).toBeGreaterThan(900);
    expect(sessionErrorCode).toBe("ERR_HTTP2_ERROR");
  });

  test("streamResetBurst sets where the flood is detected", async () => {
    const { goaway } = await flood({ options: { streamResetBurst: 50, streamResetRate: 1 }, count: 200 });
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.ENHANCE_YOUR_CALM);
    // Burst 50 empties on the 51st reset (stream 101); the default burst would need stream 2001.
    expect(goaway.payload.readUInt32BE(0)).toBeGreaterThanOrEqual(101);
    expect(goaway.payload.readUInt32BE(0)).toBeLessThan(200);
  });

  test("a flood under the burst keeps the session serving requests", async () => {
    const { server, state } = respondingServer();
    await withClient(server, async c => {
      c.send(Buffer.concat([pairs(100, 1, rstStream), request(201)]));
      await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 201, 10_000);
      expect(c.frames.find(f => f.type === FrameType.GOAWAY)).toBeUndefined();
      expect(state.handlers).toBe(101);
    });
  });

  test("the bucket refills at streamResetRate per second", async () => {
    // Burst 0 is floored to 1 like node, so the bucket holds exactly one token.
    const { server } = respondingServer({ streamResetBurst: 0, streamResetRate: 1 });
    await withClient(server, async c => {
      c.send(pairs(1, 1, rstStream)); // drains the only token
      await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      await Bun.sleep(1500); // the refill under test is per whole second of wall clock
      // The refilled token covers stream 3, stream 5 is served, and the later resets find the
      // bucket empty again because the refill clock advanced.
      c.send(Buffer.concat([pairs(1, 3, rstStream), request(5), pairs(3, 7, rstStream)]));
      const goaway = await c.waitForGoaway(10_000);
      expect(goawayErrorCode(goaway)).toBe(ErrorCode.ENHANCE_YOUR_CALM);
      expect(c.frames.some(f => f.type === FrameType.HEADERS && f.streamId === 5)).toBe(true);
    });
  });

  // MadeYouReset: the client never sends RST_STREAM; each stream is killed by a frame this engine
  // answers with its own RST_STREAM (nghttp2 escalates these shapes to connection errors instead).
  // Those resets drain a separate fixed bucket, so streamResetBurst does not apply to them.
  const madeYouReset = {
    "WINDOW_UPDATE with a 0 increment": (sid: number) => encodeFrame(FrameType.WINDOW_UPDATE, 0, sid, Buffer.alloc(4)),
    "WINDOW_UPDATE past 2^31-1": (sid: number) =>
      encodeFrame(FrameType.WINDOW_UPDATE, 0, sid, Buffer.from([0x7f, 0xff, 0xff, 0xff])),
    "DATA after END_STREAM": (sid: number) => encodeFrame(FrameType.DATA, 0, sid, Buffer.from("x")),
  };

  for (const [name, kill] of Object.entries(madeYouReset)) {
    test(`a flood of server-sent resets via ${name} is answered with GOAWAY(ENHANCE_YOUR_CALM)`, async () => {
      const { c, goaway, handlers, sessionErrorCode } = await flood({
        options: { streamResetBurst: 5, streamResetRate: 1 },
        count: 1200,
        kill,
      });
      expect(goawayErrorCode(goaway)).toBe(ErrorCode.ENHANCE_YOUR_CALM);
      expect(c.frames.filter(f => f.type === FrameType.RST_STREAM).length).toBeGreaterThanOrEqual(1000);
      expect(handlers).toBeGreaterThanOrEqual(1000);
      expect(sessionErrorCode).toBe("ERR_HTTP2_ERROR");
    });
  }

  // A reset is charged only when it cancels a live stream. nghttp2 charges every RST_STREAM, but
  // Bun's own client answers each late DATA frame on a cancelled stream with one.
  test("RST_STREAM frames for a stream that is already closed are not charged", async () => {
    const { server } = respondingServer();
    await withClient(server, async c => {
      const again = Buffer.concat(Array.from({ length: 1100 }, () => rstStream(1)));
      c.send(Buffer.concat([upload(1), rstStream(1), again])); // one write: the closed stream is still in the map
      await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      c.send(Buffer.concat([again, request(3)])); // a later read: the stream is evicted
      expect(await servedBeforeGoaway(c, 3)).toBe(true);
    });
  });

  // A server-sent reset is charged only when it cancels a request the handler was given. The
  // late DATA frames below are dropped.
  const lateData = Buffer.concat(
    Array.from({ length: 1200 }, () => encodeFrame(FrameType.DATA, 0, 1, Buffer.from("x"))),
  );

  test("late DATA for a stream the server already closed is not charged", async () => {
    // A client can have a window of upload DATA in flight when the server rejects the request.
    const { server } = respondingServer({}, true);
    await withClient(server, async c => {
      c.send(upload(1));
      await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 1);
      c.send(Buffer.concat([lateData, request(3)]));
      expect(await servedBeforeGoaway(c, 3)).toBe(true);
    });
  });

  test("a stream error is charged once, not once per frame queued behind it", async () => {
    const { server } = respondingServer();
    await withClient(server, async c => {
      // One write: the DATA frames arrive while the reset stream is still in the engine's map.
      const streamError = madeYouReset["WINDOW_UPDATE with a 0 increment"](1);
      c.send(Buffer.concat([upload(1), streamError, lateData, request(3)]));
      expect(await servedBeforeGoaway(c, 3)).toBe(true);
    });
  });

  test("a header block refused before dispatch is not charged", async () => {
    // maxSessionInvalidFrames and maxSessionRejectedStreams already bound these resets.
    const { server, state } = respondingServer({ maxSessionInvalidFrames: 5000, maxSessionRejectedStreams: 5000 });
    await withClient(server, async c => {
      // A literal "connection: close" field makes the block malformed (RFC 9113 8.2.2).
      const field = Buffer.concat([Buffer.from([0x00]), hpackLiteral("connection"), hpackLiteral("close")]);
      const malformed = (sid: number) => encodeFrame(FrameType.HEADERS, 0x5, sid, requestHeaderBlock("GET", field));
      c.send(Buffer.concat([...Array.from({ length: 1200 }, (_, i) => malformed(1 + 2 * i)), request(2401)]));
      expect(await servedBeforeGoaway(c, 2401)).toBe(true);
      expect(state.handlers).toBe(1);
    });
  });

  test("resets are not charged once the server has sent its own GOAWAY", async () => {
    // nghttp2 stops charging as soon as a local GOAWAY is submitted. The requests and their
    // cancellations arrive in one read and close() is called from the last request's handler, so
    // the cancellations behind it in the same read must already go uncharged: one GOAWAY
    // (NO_ERROR) and 'close', not a second GOAWAY and a session error.
    const open = 20;
    let sessionError: Error | undefined;
    const closed = Promise.withResolvers<void>();
    const server = http2.createServer({ streamResetBurst: 2, streamResetRate: 1 });
    server.on("sessionError", e => (sessionError = e));
    server.on("stream", stream => {
      stream.on("error", () => {});
      if (stream.id !== 2 * open - 1) return;
      stream.session!.once("close", () => closed.resolve());
      stream.session!.close();
    });
    await withClient(server, async c => {
      const ids = Array.from({ length: open }, (_, i) => 1 + 2 * i);
      c.send(Buffer.concat([...ids.map(request), ...ids.map(rstStream)]));
      await closed.promise;
      await c.waitClosed(10_000); // everything the server wrote before closing has been parsed
      expect(c.frames.filter(f => f.type === FrameType.GOAWAY).map(goawayErrorCode)).toEqual([ErrorCode.NO_ERROR]);
      expect(sessionError).toBeUndefined();
    });
  });

  // The client's GOAWAY(NO_ERROR) makes the server close() the session, which sends the server's
  // own GOAWAY. A stream the client holds open keeps the session alive after that.
  async function serverGoaway(c: RawH2) {
    c.sendFrame(FrameType.GOAWAY, 0, 0, Buffer.alloc(8));
    expect(goawayErrorCode(await c.waitForGoaway(10_000))).toBe(ErrorCode.NO_ERROR);
  }

  test("resets of streams opened after the server's GOAWAY are charged", async () => {
    // nghttp2 can exempt every reset after its GOAWAY because it ignores the streams a client
    // opens after that frame. This engine still opens them, so only the earlier streams are exempt.
    const { server, state } = respondingServer({ streamResetBurst: 50, streamResetRate: 1 });
    await withClient(server, async c => {
      c.send(upload(1));
      await serverGoaway(c);
      c.send(pairs(100, 3, rstStream));
      const goaway = await c.waitFor(calm, 10_000);
      expect(goaway.payload.subarray(8).toString()).toBe("too many stream resets");
      expect(state.sessionErrorCode).toBe("ERR_HTTP2_ERROR");
    });
  });

  // A request on an id below the highest one never reaches a handler, so its reset cancels nothing.
  // nghttp2 charges each dropped block to its glitch limiter instead (burst 10,000, refill 330/s).
  test("a flood of requests on ids below the highest one runs no handler and ends the session", async () => {
    const { server, state } = respondingServer();
    await withClient(server, async c => {
      c.send(upload(40_001));
      // pairs(15_000, 1, rstStream), built by patching the ids into copies of one pair.
      const pair = pairs(1, 1, rstStream);
      const flood = Buffer.concat(Array(15_000).fill(pair));
      for (let i = 0; i < 15_000; i++) {
        flood.writeUInt32BE(1 + 2 * i, i * pair.length + 5);
        flood.writeUInt32BE(1 + 2 * i, (i + 1) * pair.length - 8);
      }
      c.send(flood);
      const goaway = await c.waitFor(calm, 10_000);
      expect(goaway.payload.subarray(8).toString()).toBe("too many ignored frames");
      expect(state.handlers).toBe(1);
      expect(state.sessionErrorCode).toBe("ERR_HTTP2_ERROR");
    });
  });

  test("server-sent resets stay charged after the server has sent its GOAWAY", async () => {
    // Every stream here is older than the GOAWAY. The exemption is for the peer's own resets only.
    const { server, state } = respondingServer();
    await withClient(server, async c => {
      const ids = Array.from({ length: 1300 }, (_, i) => 1 + 2 * i);
      c.send(Buffer.concat(ids.map(upload)));
      await serverGoaway(c);
      c.send(Buffer.concat(ids.map(madeYouReset["WINDOW_UPDATE with a 0 increment"])));
      const goaway = await c.waitFor(calm, 10_000);
      expect(goaway.payload.subarray(8).toString()).toBe("too many stream resets");
      expect(state.sessionErrorCode).toBe("ERR_HTTP2_ERROR");
    });
  });
});

// nghttp2 charges every frame it drops without a reply to one token bucket per session: 10,000
// tokens, 330 back per second. An empty bucket ends the session with GOAWAY(ENHANCE_YOUR_CALM).
describe("floods of ignored frames (nghttp2's glitch rate limit)", () => {
  const BURST = 10_000;
  const originEntry = Buffer.concat([Buffer.from([0, 1]), Buffer.from("x")]);
  const PRIORITY = encodeFrame(FrameType.PRIORITY, 0, 1001, Buffer.from([0, 0, 0, 0, 16]));
  const UNKNOWN = encodeFrame(0xfa, 0, 0, Buffer.from("12345"));
  const ALTSVC = encodeFrame(0x0a, 0, 0, Buffer.concat([Buffer.from([0, 1]), Buffer.from('xh2=":1"')]));
  const ORIGIN = encodeFrame(0x0c, 0, 0, originEntry);
  const ORIGIN_ON_STREAM = encodeFrame(0x0c, 0, 1, originEntry);
  const ORIGIN_RESERVED_FLAG = encodeFrame(0x0c, 0x10, 0, originEntry);
  const PING = encodeFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
  const PROTOCOL_ERROR_SESSION = { code: "ERR_HTTP2_ERROR", message: "Protocol error" };
  const isPingAck = (f: Frame) => f.type === FrameType.PING && (f.flags & 0x1) !== 0;
  const isGoaway = (f: Frame) => f.type === FrameType.GOAWAY;

  /** `count` frames that alternate between `kinds`, so the bucket only empties if every kind is charged. */
  const flood = (kinds: Buffer[], count: number) =>
    Buffer.concat(Array.from({ length: count }, (_, i) => kinds[i % kinds.length]));

  test.each([
    ["PRIORITY and unknown frame types", [PRIORITY, UNKNOWN]],
    ["ALTSVC and ORIGIN", [ALTSVC, ORIGIN]],
  ])("a server tolerates 10,000 and ends the session before 20,000: %s", async (_, kinds) => {
    const sessionError = Promise.withResolvers<NodeJS.ErrnoException>();
    const server = http2.createServer();
    server.on("sessionError", sessionError.resolve);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.send(Buffer.concat([flood(kinds, BURST), PING]));
      await c.waitFor(isPingAck, 10_000);
      expect(c.frames.filter(isGoaway)).toEqual([]);
      c.send(flood(kinds, BURST));
      expect(goawayErrorCode(await c.waitForGoaway(10_000))).toBe(ErrorCode.ENHANCE_YOUR_CALM);
      const { code, message } = await sessionError.promise;
      expect({ code, message }).toEqual(PROTOCOL_ERROR_SESSION);
    } finally {
      c.destroy();
      server.close();
    }
  });

  test.each([
    ["PRIORITY and unknown frame types", [PRIORITY, UNKNOWN]],
    ["ORIGIN on a stream and ORIGIN with a reserved flag", [ORIGIN_ON_STREAM, ORIGIN_RESERVED_FLAG]],
  ])("a client tolerates 10,000 and ends the session before 20,000: %s", async (_, kinds) => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    const sessionError = once(client, "error");
    try {
      await raw.waitFor(f => f.type === FrameType.SETTINGS);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
      raw.socket!.write(Buffer.concat([flood(kinds, BURST), PING]));
      await raw.waitFor(isPingAck, 10_000);
      expect(raw.frames.filter(isGoaway)).toEqual([]);
      raw.socket!.write(flood(kinds, BURST));
      expect(goawayErrorCode(await raw.waitFor(isGoaway, 10_000))).toBe(ErrorCode.ENHANCE_YOUR_CALM);
      const [{ code, message }] = await sessionError;
      expect({ code, message }).toEqual(PROTOCOL_ERROR_SESSION);
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

describe("DATA past the declared content-length (RFC 9113 §8.1.1)", () => {
  type Probe = {
    c: RawH2;
    /** What 'data' delivered, by stream id. */
    bodies: Map<number, string>;
    /** The streams that emitted 'close'. */
    closed: Set<number>;
    /** Resolves once `condition` holds for `bodies` and `closed`. */
    until(condition: () => boolean): Promise<void>;
  };

  async function withBodyServer(
    { secure = false, compat = false }: { secure?: boolean; compat?: boolean },
    run: (probe: Probe) => Promise<void>,
  ) {
    const bodies = new Map<number, string>();
    const closed = new Set<number>();
    const changes = new EventEmitter();
    function track(id: number, body: Readable, respond: () => void) {
      bodies.set(id, "");
      body.on("error", () => {});
      body.on("data", (chunk: Buffer) => {
        bodies.set(id, bodies.get(id) + chunk.toString("latin1"));
        changes.emit("change");
      });
      body.on("end", () => {
        if (!body.destroyed) respond();
      });
      body.on("close", () => {
        closed.add(id);
        changes.emit("change");
      });
    }
    const srv = secure ? http2.createSecureServer(tlsCert) : http2.createServer();
    if (compat) {
      srv.on("request", (req, res) => track(req.stream.id!, req, () => res.end("ok")));
    } else {
      srv.on("stream", stream =>
        track(stream.id!, stream, () => {
          stream.respond({ ":status": 200 });
          stream.end("ok");
        }),
      );
    }
    srv.listen(0, "127.0.0.1");
    await once(srv, "listening");
    const c = await RawH2.connect((srv.address() as net.AddressInfo).port, secure);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      await run({
        c,
        bodies,
        closed,
        async until(condition) {
          while (!condition()) await once(changes, "change");
        },
      });
    } finally {
      c.destroy();
      srv.close();
    }
  }

  function openRequest(c: RawH2, streamId: number, contentLength: number) {
    const field = Buffer.concat([Buffer.from([0x0f, 0x0d]), hpackLiteral(String(contentLength))]);
    c.sendFrame(FrameType.HEADERS, 0x4, streamId, requestHeaderBlock("POST", field));
  }

  async function expectReset(c: RawH2, streamId: number) {
    const rst = await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === streamId);
    expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.PROTOCOL_ERROR);
  }

  // Each entry sends a request on stream 1 that declares 5 bytes. `delivered` is what 'data' may see.
  const framings: Record<string, { delivered: string; send(probe: Probe): void | Promise<void> }> = {
    "in one frame that ends the stream": {
      delivered: "",
      send: ({ c }) => c.sendFrame(FrameType.DATA, 0x1, 1, Buffer.from("hello, world")),
    },
    "in one frame that leaves the stream open": {
      delivered: "",
      send: ({ c }) => c.sendFrame(FrameType.DATA, 0, 1, Buffer.from("hello, world")),
    },
    "in a second frame": {
      delivered: "hello",
      send: ({ c }) =>
        c.send(
          Buffer.concat([
            encodeFrame(FrameType.DATA, 0, 1, Buffer.from("hello")),
            encodeFrame(FrameType.DATA, 0x1, 1, Buffer.from(", world")),
          ]),
        ),
    },
    "in a frame that follows a body already read": {
      delivered: "hello",
      send: async ({ c, bodies, until }) => {
        c.sendFrame(FrameType.DATA, 0, 1, Buffer.from("hello"));
        await until(() => bodies.get(1) === "hello");
        c.sendFrame(FrameType.DATA, 0, 1, Buffer.from(", world"));
      },
    },
    "in a frame that arrives in pieces": {
      delivered: "",
      send: async ({ c }) => {
        const frame = encodeFrame(FrameType.DATA, 0x1, 1, Buffer.from("hello, world"));
        c.send(frame.subarray(0, 12));
        await expectReset(c, 1);
        c.send(frame.subarray(12));
      },
    },
    "in a padded frame": {
      delivered: "",
      send: ({ c }) =>
        c.sendFrame(FrameType.DATA, 0x9, 1, Buffer.concat([Buffer.from([3]), Buffer.from("hello!"), Buffer.alloc(3)])),
    },
  };

  describe.each(["h2c", "tls"])("%s", transport => {
    test.each(Object.keys(framings))("is not delivered %s", async name => {
      await withBodyServer({ secure: transport === "tls" }, async probe => {
        const { c, bodies, closed, until } = probe;
        openRequest(c, 1, 5);
        await framings[name].send(probe);
        await expectReset(c, 1);
        // The session goes on, and padding does not count toward the next request's length.
        openRequest(c, 3, 5);
        c.sendFrame(FrameType.DATA, 0x9, 3, Buffer.concat([Buffer.from([4]), Buffer.from("again"), Buffer.alloc(4)]));
        await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 3);
        await until(() => closed.has(1));
        expect(Object.fromEntries(bodies)).toEqual({ 1: framings[name].delivered, 3: "again" });
        expect(c.frames.filter(f => f.type === FrameType.GOAWAY)).toEqual([]);
      });
    });
  });

  test("is not delivered to a request of the compatibility API", async () => {
    await withBodyServer({ compat: true }, async ({ c, bodies, closed, until }) => {
      openRequest(c, 1, 5);
      c.sendFrame(FrameType.DATA, 0, 1, Buffer.from("hel"));
      c.sendFrame(FrameType.DATA, 0x1, 1, Buffer.from("lo, world"));
      await expectReset(c, 1);
      await until(() => closed.has(1));
      expect(bodies.get(1)).toBe("hel");
    });
  });

  test("goes back to the connection window", async () => {
    await withBodyServer({}, async ({ c, bodies, closed, until }) => {
      for (const streamId of [1, 3, 5]) {
        openRequest(c, streamId, 5);
        c.sendFrame(FrameType.DATA, 0x1, streamId, Buffer.alloc(16000, "x"));
        await expectReset(c, streamId);
      }
      const returned = () =>
        c.frames
          .filter(f => f.type === FrameType.WINDOW_UPDATE && f.streamId === 0)
          .reduce((sum, f) => sum + f.payload.readUInt32BE(0), 0);
      await c.waitFor(() => returned() >= 48000);
      expect(returned()).toBe(48000);
      openRequest(c, 7, 64000);
      for (let i = 0; i < 4; i++) c.sendFrame(FrameType.DATA, i === 3 ? 0x1 : 0, 7, Buffer.alloc(16000, "y"));
      await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 7);
      await until(() => closed.has(1) && closed.has(3) && closed.has(5));
      expect([1, 3, 5, 7].map(streamId => bodies.get(streamId)!.length)).toEqual([0, 0, 0, 64000]);
    });
  });
});

describe("received field values (RFC 9113 §8.2.1, §8.3)", () => {
  type Fields = readonly (readonly [string, string])[];

  // Literal never indexed with a new name, so that the bytes on the wire are the bytes written here.
  function fieldBlock(fields: Fields): Buffer {
    return Buffer.concat(fields.flatMap(([n, v]) => [Buffer.from([0x10]), hpackLiteral(n), hpackLiteral(v)]));
  }

  // Without the symbol key that lists the never-indexed fields.
  const named = (headers: http2.IncomingHttpHeaders) => Object.fromEntries(Object.entries(headers));

  /** Sends one request to a fresh server. `headers` and `trailers` are what the stream's events got, if they fired. */
  async function sendRequest(fields: Fields, options: http2.ServerOptions = {}, trailerFields?: Fields) {
    let headers: http2.IncomingHttpHeaders | undefined;
    let trailers: http2.IncomingHttpHeaders | undefined;
    const srv = http2.createServer(options);
    srv.on("stream", (stream, received) => {
      headers = named(received);
      stream.on("error", () => {});
      stream.on("trailers", received => (trailers = named(received)));
      stream.on("end", () => {
        stream.respond({ ":status": 200 });
        stream.end();
      });
      stream.resume();
    });
    srv.listen(0, "127.0.0.1");
    await once(srv, "listening");
    const c = await RawH2.connect((srv.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.sendFrame(FrameType.HEADERS, trailerFields ? 0x4 : 0x5, 1, fieldBlock(fields));
      if (trailerFields) c.sendFrame(FrameType.HEADERS, 0x5, 1, fieldBlock(trailerFields));
      const answer = await c.waitFor(
        f => f.streamId === 1 && (f.type === FrameType.RST_STREAM || f.type === FrameType.HEADERS),
      );
      const reset = answer.type === FrameType.RST_STREAM ? answer.payload.readUInt32BE(0) : undefined;
      return { headers, trailers, reset };
    } finally {
      c.destroy();
      srv.close();
    }
  }

  const refused = { headers: undefined, reset: ErrorCode.PROTOCOL_ERROR };
  const request = { ":method": "GET", ":scheme": "http", ":path": "/", ":authority": "localhost" };

  test.each([":method", ":scheme", ":path", ":authority", "host"])(
    "a request whose %s has whitespace at an edge is a stream PROTOCOL_ERROR",
    async name => {
      const { ":authority": authority, ...rest } = request;
      const valid: Record<string, string> = name === "host" ? { ...rest, host: authority } : request;
      for (const strictFieldWhitespaceValidation of [true, false]) {
        for (const value of [` ${valid[name]}`, `${valid[name]} `, `\t${valid[name]}`, `${valid[name]}\t`]) {
          const fields = Object.entries({ ...valid, [name]: value });
          expect(await sendRequest(fields, { strictFieldWhitespaceValidation })).toEqual(refused);
        }
      }
    },
  );

  test("a :protocol with whitespace at an edge is valid without strictFieldWhitespaceValidation", async () => {
    const settings = { enableConnectProtocol: true };
    const connect = { ...request, ":method": "CONNECT" };
    for (const value of [" websocket", "websocket ", "\twebsocket", "websocket\t"]) {
      const fields = Object.entries({ ...connect, ":protocol": value });
      expect([value, await sendRequest(fields, { settings })]).toEqual([value, refused]);
      const loose = await sendRequest(fields, { settings, strictFieldWhitespaceValidation: false });
      expect(loose.headers?.[":protocol"]).toBe(value);
    }
    const blank = Object.entries({ ...connect, ":protocol": " \t" });
    expect(await sendRequest(blank, { settings, strictFieldWhitespaceValidation: false })).toEqual(refused);
  });

  test.each([
    [":method", ["GE T", "G\tT", "G@T", "G(T", "G:T", "G\x01T", "G\x7fT", "G\xe9T"], ["get", "A-B", "!#$%&'*+.^_`|~"]],
    [
      ":path",
      ["x", "../x", "?x", "http://localhost/", "*", "/a b", "/a\tb", "/a\x01b", "/a\x7fb"],
      ["//x", "/\xe9", '/#\\"<>^`{|}'],
    ],
    [":scheme", ["ht tp", "1http", "+http", "http:", "http/", "htt\x01p", "htt\xe9p"], ["HTTPS", "ftp", "a+b-c.1"]],
    [
      ":authority",
      ["a b", "a@b", "a/b", "a\\b", "a?b", "a#b", 'a"b', "a<b", "a^b", "a`b", "a{b", "a\x01b", "a\x7fb", "a\xe9b"],
      ["[::1]:80", "a_b-c.d:1", "!$%&'()*+,;=~"],
    ],
  ])("a request with an invalid %s is a stream PROTOCOL_ERROR", async (name, invalid, valid) => {
    for (const value of invalid) {
      expect([value, await sendRequest(Object.entries({ ...request, [name]: value }))]).toEqual([value, refused]);
    }
    for (const value of valid) {
      expect((await sendRequest(Object.entries({ ...request, [name]: value }))).headers?.[name]).toBe(value);
    }
  });

  test("a :path without a leading slash is valid as OPTIONS * and outside http and https", async () => {
    expect(await sendRequest(Object.entries({ ...request, ":method": "options", ":path": "*" }))).toEqual(refused);
    expect(await sendRequest(Object.entries({ ...request, ":method": "OPTIONS", ":path": "x" }))).toEqual(refused);
    for (const fields of [
      { ...request, ":method": "OPTIONS", ":path": "*" },
      { ...request, ":scheme": "ftp", ":path": "x" },
    ]) {
      expect((await sendRequest(Object.entries(fields))).headers).toEqual({ ...fields });
    }
  });

  test("an invalid host in a request is ignored", async () => {
    const { ":authority": authority, ...rest } = request;
    for (const host of ["a b", "a/b", "a@b", "a\x7fb"]) {
      expect([host, await sendRequest(Object.entries({ ...rest, host }))]).toEqual([host, refused]);
      expect((await sendRequest(Object.entries({ ...request, host }))).headers).toEqual({ ...request });
    }
    expect((await sendRequest(Object.entries({ ...rest, host: authority }))).headers?.host).toBe(authority);
  });

  /** Answers one request of a fresh client with `frames`. Resolves once the client has answered `until`. */
  async function answerRequest(
    frames: (raw: RawH2Server) => void,
    until: (f: Frame) => boolean,
    options: http2.ClientSessionOptions = {},
  ) {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`, options);
    const events: [string, http2.IncomingHttpHeaders][] = [];
    try {
      client.on("error", () => {});
      client.on("stream", (pushed, headers) => {
        events.push(["stream", named(headers)]);
        pushed.on("error", () => {});
        pushed.on("push", headers => events.push(["push", named(headers)]));
        pushed.resume();
      });
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      for (const name of ["headers", "response", "trailers"]) {
        req.on(name, (headers: http2.IncomingHttpHeaders) => events.push([name, named(headers)]));
      }
      req.resume();
      const closed = new Promise(resolve => req.on("close", resolve));
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      frames(raw);
      await closed;
      const answer = await raw.waitFor(until);
      return { events, answer };
    } finally {
      client.destroy();
      raw.close();
    }
  }

  const promise = (fields: Fields) => Buffer.concat([Buffer.from([0, 0, 0, 2]), fieldBlock(fields)]);

  test("a promised request with an invalid pseudo-header is refused", async () => {
    for (const [name, value] of [
      [":path", "x"],
      [":path", "/a b"],
      [":method", "GE T"],
      [":scheme", "ht:tp"],
      [":authority", "a b"],
    ]) {
      const { events, answer } = await answerRequest(
        raw => {
          raw.sendFrame(FrameType.PUSH_PROMISE, 0x4, 1, promise(Object.entries({ ...request, [name]: value })));
          raw.sendFrame(FrameType.HEADERS, 0x5, 1, fieldBlock([[":status", "200"]]));
        },
        f => f.type === FrameType.RST_STREAM && f.streamId === 2,
      );
      expect([value, answer.payload.readUInt32BE(0)]).toEqual([value, ErrorCode.PROTOCOL_ERROR]);
      expect(events.map(([event]) => event)).toEqual(["response"]);
    }
  });

  // Every control byte but HTAB, and NUL, LF and CR, which make the whole block malformed.
  const controlBytes = Array.from({ length: 0x20 }, (_, code) => code)
    .filter(code => ![0x00, 0x09, 0x0a, 0x0d].includes(code))
    .concat(0x7f)
    .map(code => String.fromCharCode(code));
  const withControlBytes: Fields = controlBytes.flatMap((c, i) => [
    [`x-first-${i}`, `${c}b`],
    [`x-inside-${i}`, `a${c}b`],
    [`x-last-${i}`, `a${c}`],
  ]);
  const kept = { "x-tab": "a\tb", "x-high": "\x80a\xff" };
  const mixed: Fields = [
    ["cookie", "a=\x01"],
    ...withControlBytes.slice(0, 45),
    ...Object.entries(kept),
    ...withControlBytes.slice(45),
  ];

  test("a field whose value has a control byte is left out of a request and its trailers", async () => {
    const post = { ...request, ":method": "POST" };
    expect(await sendRequest([...Object.entries(post), ...mixed], {}, mixed)).toEqual({
      headers: { ...post, ...kept },
      trailers: kept,
      reset: undefined,
    });
  });

  test("a field whose value has a control byte is left out of a response, its trailers and a push", async () => {
    const status = { ":status": 200 };
    const { events } = await answerRequest(
      raw => {
        raw.sendFrame(FrameType.PUSH_PROMISE, 0x4, 1, promise([...Object.entries(request), ...mixed]));
        raw.sendFrame(FrameType.HEADERS, 0x4, 1, fieldBlock([[":status", "103"], ...mixed]));
        raw.sendFrame(FrameType.HEADERS, 0x4, 1, fieldBlock([[":status", "200"], ...mixed]));
        raw.sendFrame(FrameType.HEADERS, 0x5, 2, fieldBlock([[":status", "200"], ...mixed]));
        raw.sendFrame(FrameType.HEADERS, 0x5, 1, fieldBlock(mixed));
      },
      f => f.type === FrameType.SETTINGS && (f.flags & 1) !== 0,
    );
    expect(events).toEqual([
      ["stream", { ...request, ...kept }],
      ["headers", { ":status": 103, ...kept }],
      ["response", { ...status, ...kept }],
      ["push", { ...status, ...kept }],
      ["trailers", kept],
    ]);
  });

  test("a :status with a control byte is a stream PROTOCOL_ERROR", async () => {
    const { events, answer } = await answerRequest(
      raw => raw.sendFrame(FrameType.HEADERS, 0x5, 1, fieldBlock([[":status", "20\x01"]])),
      f => f.type === FrameType.RST_STREAM && f.streamId === 1,
    );
    expect(answer.payload.readUInt32BE(0)).toBe(ErrorCode.PROTOCOL_ERROR);
    expect(events).toEqual([]);
  });

  test("a response with a request pseudo-header is a stream PROTOCOL_ERROR", async () => {
    for (const field of [...Object.entries(request), [":protocol", "websocket"]] as Fields) {
      for (const fields of [[[":status", "200"], field], [field, [":status", "200"]], [field]] as Fields[]) {
        const { events, answer } = await answerRequest(
          raw => raw.sendFrame(FrameType.HEADERS, 0x5, 1, fieldBlock(fields)),
          f => f.type === FrameType.RST_STREAM && f.streamId === 1,
        );
        expect([fields, answer.payload.readUInt32BE(0), events]).toEqual([fields, ErrorCode.PROTOCOL_ERROR, []]);
      }
    }
  });

  test("a response without :status is a stream PROTOCOL_ERROR", async () => {
    for (const blocks of [[[["x-a", "b"]]], [[]], [[[":status", "103"]], [["x-a", "b"]]]] as Fields[][]) {
      const { events, answer } = await answerRequest(
        raw => {
          blocks.forEach((fields, i) =>
            raw.sendFrame(FrameType.HEADERS, i === blocks.length - 1 ? 0x5 : 0x4, 1, fieldBlock(fields)),
          );
        },
        f => f.type === FrameType.RST_STREAM && f.streamId === 1,
      );
      expect([blocks, answer.payload.readUInt32BE(0), events.map(([event]) => event)]).toEqual([
        blocks,
        ErrorCode.PROTOCOL_ERROR,
        blocks.length > 1 ? ["headers"] : [],
      ]);
    }
  });

  test("a pushed response without :status and a promised CONNECT are refused", async () => {
    const connect: Fields = [
      [":method", "CONNECT"],
      [":authority", "localhost"],
    ];
    for (const [promised, expected] of [
      [Object.entries(request), ["stream", "response"]],
      [connect, ["response"]],
    ] as [Fields, string[]][]) {
      const { events, answer } = await answerRequest(
        raw => {
          raw.sendFrame(FrameType.PUSH_PROMISE, 0x4, 1, promise(promised));
          raw.sendFrame(FrameType.HEADERS, 0x5, 2, fieldBlock([["x-a", "b"]]));
          raw.sendFrame(FrameType.HEADERS, 0x5, 1, fieldBlock([[":status", "200"]]));
        },
        f => f.type === FrameType.RST_STREAM && f.streamId === 2,
      );
      expect(answer.payload.readUInt32BE(0)).toBe(ErrorCode.PROTOCOL_ERROR);
      expect(events.map(([event]) => event)).toEqual(expected);
    }
  });

  test("a pushed response with a request pseudo-header and a promised request with :status are refused", async () => {
    const response = fieldBlock([[":status", "200"]]);
    for (const [promised, pushed, expected] of [
      [
        Object.entries(request),
        [
          [":status", "200"],
          [":path", "/"],
        ],
        ["stream", "response"],
      ],
      [Object.entries({ ...request, ":status": "200" }), [[":status", "200"]], ["response"]],
    ] as [Fields, Fields, string[]][]) {
      const { events, answer } = await answerRequest(
        raw => {
          raw.sendFrame(FrameType.PUSH_PROMISE, 0x4, 1, promise(promised));
          raw.sendFrame(FrameType.HEADERS, 0x5, 2, fieldBlock(pushed));
          raw.sendFrame(FrameType.HEADERS, 0x5, 1, response);
        },
        f => f.type === FrameType.RST_STREAM && f.streamId === 2,
      );
      expect(answer.payload.readUInt32BE(0)).toBe(ErrorCode.PROTOCOL_ERROR);
      expect(events.map(([event]) => event)).toEqual(expected);
    }
  });

  test("an empty or a second host in a request is a stream PROTOCOL_ERROR", async () => {
    const { ":authority": authority, ...rest } = request;
    for (const base of [Object.entries(rest), Object.entries(request)]) {
      for (const hosts of [[""], ["a", "a"], ["a", "b"], ["a", ""]]) {
        const fields: Fields = [...base, ...hosts.map(host => ["host", host] as const)];
        expect([hosts, await sendRequest(fields)]).toEqual([hosts, refused]);
      }
      // An invalid host is ignored, so it is not the first of two.
      expect((await sendRequest([...base, ["host", "a b"], ["host", "a"], ["host", "a/b"]])).headers?.host).toBe("a");
    }
    const post = Object.entries({ ...request, ":method": "POST" });
    for (const [extra, trailers] of [
      [[["host", "a"]], [["host", "a"]]],
      [[["host", "a"]], [["host", "b"]]],
      [[], [["host", ""]]],
      [
        [],
        [
          ["host", "a"],
          ["host", "a"],
        ],
      ],
    ] as [Fields, Fields][]) {
      const result = await sendRequest([...post, ...extra], {}, trailers);
      expect([trailers, result.trailers, result.reset]).toEqual([trailers, undefined, ErrorCode.PROTOCOL_ERROR]);
    }
    expect((await sendRequest([...post, ["host", "a b"]], {}, [["host", "a"]])).trailers).toEqual({ host: "a" });
  });

  test("a :status with whitespace at an edge is a stream PROTOCOL_ERROR", async () => {
    for (const strictFieldWhitespaceValidation of [true, false]) {
      for (const value of [" 200", "200 ", "\t200", "200\t"]) {
        const { events, answer } = await answerRequest(
          raw => raw.sendFrame(FrameType.HEADERS, 0x5, 1, fieldBlock([[":status", value]])),
          f => f.type === FrameType.RST_STREAM && f.streamId === 1,
          { strictFieldWhitespaceValidation },
        );
        expect([value, answer.payload.readUInt32BE(0), events]).toEqual([value, ErrorCode.PROTOCOL_ERROR, []]);
      }
    }
  });

  test("a :status that is not a status code of HTTP/2 is a stream PROTOCOL_ERROR", async () => {
    const status = (value: string) => fieldBlock([[":status", value]]);
    for (const value of [
      "2x0",
      "2000",
      "20",
      "+20",
      "-20",
      "1e2",
      "2.0",
      "0200",
      "0xc8",
      "200 OK",
      "099",
      "000",
      "101",
    ]) {
      const { events, answer } = await answerRequest(
        raw => raw.sendFrame(FrameType.HEADERS, 0x5, 1, status(value)),
        f => f.type === FrameType.RST_STREAM && f.streamId === 1,
      );
      expect([value, answer.payload.readUInt32BE(0), events]).toEqual([value, ErrorCode.PROTOCOL_ERROR, []]);
    }
    const { events } = await answerRequest(
      raw => {
        raw.sendFrame(FrameType.HEADERS, 0x4, 1, status("100"));
        raw.sendFrame(FrameType.HEADERS, 0x4, 1, status("199"));
        raw.sendFrame(FrameType.HEADERS, 0x5, 1, status("999"));
      },
      f => f.type === FrameType.SETTINGS && (f.flags & 1) !== 0,
    );
    expect(events).toEqual([
      ["headers", { ":status": 100 }],
      ["headers", { ":status": 199 }],
      ["response", { ":status": 999 }],
    ]);
  });
});

describe("DATA on a closed stream (RFC 9113 §5.1)", () => {
  const resets = (frames: Frame[]) =>
    frames.filter(f => f.type === FrameType.RST_STREAM).map(f => [f.streamId, f.payload.readUInt32BE(0)]);
  const isPingAck = (f: Frame) => f.type === FrameType.PING && (f.flags & 0x1) !== 0;
  const credit = (frames: Frame[]) =>
    frames
      .filter(f => f.type === FrameType.WINDOW_UPDATE && f.streamId === 0)
      .reduce((sum, f) => sum + f.payload.readUInt32BE(0), 0);
  const small = encodeFrame(FrameType.DATA, 0, 1, Buffer.from("x"));
  const large = encodeFrame(FrameType.DATA, 0, 1, Buffer.alloc(16_384));

  // Each entry closes stream 1 of a server and resolves to the resets that this takes.
  const closings: Record<string, (c: RawH2) => Promise<number[][]>> = {
    "the server reset": async c => {
      // The DATA behind the one that draws the reset arrives in the same read.
      c.send(
        Buffer.concat([
          encodeFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST", CONTENT_LENGTH_5)),
          encodeFrame(FrameType.DATA, 0, 1, Buffer.from("hello!")),
          small,
          small,
        ]),
      );
      await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 1);
      return [[1, ErrorCode.PROTOCOL_ERROR]];
    },
    "the server answered": async c => {
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 1 && (f.flags & 0x1) !== 0);
      return [];
    },
  };

  test.each(Object.keys(closings))("that %s is dropped and goes back to the connection window", async name => {
    const srv = http2.createServer();
    srv.on("stream", stream => {
      stream.on("error", () => {});
      stream.on("end", () => {
        if (stream.destroyed) return;
        stream.respond({ ":status": 200 });
        stream.end("ok");
      });
      stream.resume();
    });
    srv.listen(0, "127.0.0.1");
    await once(srv, "listening");
    const c = await RawH2.connect((srv.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      const expected = await closings[name](c);
      // More than the whole window, so it only fits if what is dropped comes back. The window is
      // credited once half of it is used, so less than that can be outstanding after any read.
      let sent = expected.length ? 8 : 0;
      for (const frames of [
        [small, large, large],
        [large, large],
        [large, large],
      ]) {
        c.send(Buffer.concat(frames));
        sent += frames.reduce((sum, frame) => sum + frame.length - 9, 0);
        await c.waitFor(() => credit(c.frames) > sent - 32_767);
      }
      // A stream that nobody opened is not a closed one.
      c.sendFrame(FrameType.DATA, 0, 99, Buffer.from("x"));
      c.sendFrame(FrameType.HEADERS, 0x5, 101, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 101);
      expect(resets(c.frames)).toEqual([...expected, [99, ErrorCode.STREAM_CLOSED]]);
      expect(c.frames.filter(f => f.type === FrameType.GOAWAY)).toEqual([]);
    } finally {
      c.destroy();
      srv.close();
    }
  });

  test("that the client canceled is dropped", async () => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    try {
      client.on("error", () => {});
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      req.on("response", () => req.close(http2.constants.NGHTTP2_CANCEL));
      const closed = new Promise(resolve => req.on("close", resolve));
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      raw.sendFrame(FrameType.HEADERS, 0x4, 1, Buffer.from([0x88]));
      await raw.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 1);
      await closed;
      raw.socket!.write(Buffer.concat([...Array(50).fill(small), encodeFrame(FrameType.PING, 0, 0, Buffer.alloc(8))]));
      await raw.waitFor(isPingAck);
      expect(resets(raw.frames).filter(([, code]) => code !== ErrorCode.CANCEL)).toEqual([]);
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

describe("HEADERS on a closed stream (RFC 9113 §5.1)", () => {
  const isPingAck = (f: Frame) => f.type === FrameType.PING && (f.flags & 0x1) !== 0;
  const cancel = Buffer.from([0, 0, 0, ErrorCode.CANCEL]);
  const open = (id: number, flags: number) => encodeFrame(FrameType.HEADERS, flags, id, requestHeaderBlock("GET"));
  /** A request whose CONTINUATION inserts `x-sync: 1` into the HPACK dynamic table (index 62). */
  const late = (id: number) =>
    Buffer.concat([
      open(id, 0x1 /* END_STREAM */),
      encodeFrame(
        FrameType.CONTINUATION,
        0x4 /* END_HEADERS */,
        id,
        Buffer.concat([Buffer.from([0x40]), hpackLiteral("x-sync"), hpackLiteral("1")]),
      ),
    ]);
  /** The next write lands in a later read than everything written so far. */
  async function barrier(c: RawH2) {
    const seen = c.frames.filter(isPingAck).length;
    c.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
    await c.waitFor(() => c.frames.filter(isPingAck).length > seen);
  }

  // Each entry opens one stream, sends `late()` on a closed one, and returns the id it opened.
  const closings: Record<string, (c: RawH2) => Promise<number>> = {
    "the peer reset in the same write": async c => {
      c.send(Buffer.concat([open(1, 0x4), encodeFrame(FrameType.RST_STREAM, 0, 1, cancel), late(1)]));
      return 1;
    },
    "the peer reset in an earlier read": async c => {
      c.send(Buffer.concat([open(1, 0x4), encodeFrame(FrameType.RST_STREAM, 0, 1, cancel)]));
      await barrier(c);
      c.send(late(1));
      return 1;
    },
    "the server answered": async c => {
      c.send(open(1, 0x5));
      await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 1 && (f.flags & 0x1) !== 0);
      await barrier(c);
      c.send(late(1));
      return 1;
    },
    "a higher id implicitly closed": async c => {
      c.send(open(5, 0x5));
      await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 5 && (f.flags & 0x1) !== 0);
      c.send(late(3));
      return 5;
    },
  };

  test.each(Object.keys(closings))("server decodes and drops a block on a stream that %s", async name => {
    const opened: [number, unknown][] = [];
    const srv = http2.createServer();
    srv.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      opened.push([stream.id, headers["x-sync"]]);
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    srv.listen(0, "127.0.0.1");
    await once(srv, "listening");
    const c = await RawH2.connect((srv.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      const id = await closings[name](c);
      // Index 62 only resolves if the dropped block was decoded.
      c.sendFrame(FrameType.HEADERS, 0x5, 7, Buffer.concat([requestHeaderBlock("GET"), Buffer.from([0xbe])]));
      const reply = await c.waitFor(
        f => (f.type === FrameType.HEADERS && f.streamId === 7) || f.type === FrameType.GOAWAY,
      );
      expect(reply.type).toBe(FrameType.HEADERS);
      expect(opened).toEqual([
        [id, undefined],
        [7, "1"],
      ]);
      expect(c.frames.filter(f => f.type === FrameType.RST_STREAM)).toEqual([]);
    } finally {
      c.destroy();
      srv.close();
    }
  });

  test("server still opens a client stream id below the ids it promised", async () => {
    const opened: number[] = [];
    const srv = http2.createServer();
    srv.on("stream", stream => {
      opened.push(stream.id);
      stream.on("error", () => {});
      for (let i = 0; stream.id === 1 && i < 3; i++) {
        stream.pushStream({ ":path": `/push/${i}` }, (err, push) => {
          if (err) return;
          push.on("error", () => {});
          push.respond({ ":status": 200 });
          push.end();
        });
      }
      stream.respond({ ":status": 200 });
      stream.end();
    });
    srv.listen(0, "127.0.0.1");
    await once(srv, "listening");
    const c = await RawH2.connect((srv.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.send(open(1, 0x5));
      await c.waitFor(f => f.type === FrameType.PUSH_PROMISE && f.payload.readUInt32BE(0) === 6);
      c.send(open(3, 0x5));
      const reply = await c.waitFor(
        f => (f.type === FrameType.HEADERS && f.streamId === 3) || f.type === FrameType.GOAWAY,
      );
      expect(reply.type).toBe(FrameType.HEADERS);
      expect(opened).toEqual([1, 3]);
    } finally {
      c.destroy();
      srv.close();
    }
  });

  test("client.close() finishes after a response arrives for a canceled request", async () => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    try {
      client.on("error", () => {});
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      const closed = once(req, "close");
      req.close(http2.constants.NGHTTP2_CANCEL);
      await raw.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 1);
      await closed;
      raw.sendFrame(FrameType.HEADERS, 0x4, 1, Buffer.from([0x88]));
      raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8));
      await raw.waitFor(isPingAck);
      const sessionClosed = once(client, "close");
      client.close();
      await sessionClosed;
    } finally {
      client.destroy();
      raw.close();
    }
  });

  test("client treats HEADERS on an idle stream as a connection error", async () => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    try {
      const sessionError = once(client, "error");
      let pushed = 0;
      client.on("stream", () => pushed++);
      const req = client.request({ ":path": "/" });
      const requestError = once(req, "error");
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      raw.sendFrame(FrameType.HEADERS, 0x4, 2, Buffer.from([0x88]));
      expect(goawayErrorCode(await raw.waitFor(f => f.type === FrameType.GOAWAY))).toBe(ErrorCode.PROTOCOL_ERROR);
      expect((await sessionError)[0]).toMatchObject({ code: "ERR_HTTP2_ERROR" });
      expect((await requestError)[0]).toMatchObject({ code: "ERR_HTTP2_ERROR" });
      expect(pushed).toBe(0);
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

describe("header blocks over maxSendHeaderBlockLength", () => {
  const LIMIT = 200;
  const OVER_LIMIT = Buffer.alloc(1000, "b").toString();

  const requestFor = (path: string) =>
    Buffer.concat([
      Buffer.from([0x82, 0x86, 0x04]),
      hpackLiteral(path),
      Buffer.from([0x01]),
      hpackLiteral("localhost"),
    ]);

  // events.once() would reject on the 'error' these streams are expected to emit.
  const closed = (emitter: EventEmitter) => new Promise<void>(resolve => emitter.once("close", () => resolve()));

  const framesOn = (c: RawH2, streamId: number) =>
    c.frames
      .filter(f => f.streamId === streamId)
      .map(f => (f.type === FrameType.RST_STREAM ? ["RST_STREAM", f.payload.readUInt32BE(0)] : [f.type, f.flags]));

  /** Opens stream 1, which the server answers and holds open, then stream 3 on `/over`. */
  async function connectWithOpenStream(server: http2.Http2Server) {
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    c.sendPreface();
    c.sendEmptySettings();
    await c.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0);
    c.sendSettingsAck();
    c.sendFrame(FrameType.HEADERS, 0x5, 1, requestFor("/in-flight"));
    await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
    c.sendFrame(FrameType.HEADERS, 0x5, 3, requestFor("/over"));
    return c;
  }

  async function expectGracefulClose(c: RawH2, inFlight: http2.ServerHttp2Stream) {
    const goaway = await c.waitForGoaway();
    expect(goawayErrorCode(goaway)).toBe(ErrorCode.NO_ERROR);
    inFlight.end("still delivered");
    await c.waitClosed();
    const body = c.frames.filter(f => f.type === FrameType.DATA && f.streamId === 1).map(f => f.payload);
    expect(Buffer.concat(body).toString()).toBe("still delivered");
  }

  const answers: Record<string, (server: http2.Http2Server) => void> = {
    "respond() and end()": server =>
      server.on("stream", (stream, headers) => {
        if (headers[":path"] !== "/over") return;
        stream.respond({ ":status": 200, "x-big": OVER_LIMIT });
        stream.end("body");
      }),
    "respond() with waitForTrailers, end() and sendTrailers()": server =>
      server.on("stream", (stream, headers) => {
        if (headers[":path"] !== "/over") return;
        stream.on("wantTrailers", () => stream.sendTrailers({ "x-trailer": "t" }));
        stream.respond({ ":status": 200, "x-big": OVER_LIMIT }, { waitForTrailers: true });
        stream.end("body");
      }),
    "additionalHeaders()": server =>
      server.on("stream", (stream, headers) => {
        if (headers[":path"] !== "/over") return;
        stream.additionalHeaders({ ":status": 103, "x-big": OVER_LIMIT });
      }),
    "res.setHeader() and res.end()": server =>
      server.on("request", (req, res) => {
        if (req.url !== "/over") return;
        res.setHeader("x-big", OVER_LIMIT);
        res.end("body");
      }),
  };

  test.each(Object.keys(answers))("server resets the stream and closes the session after %s", async name => {
    const server = http2.createServer({ maxSendHeaderBlockLength: LIMIT });
    const events: unknown[][] = [];
    const overClosed = Promise.withResolvers<void>();
    let inFlight!: http2.ServerHttp2Stream;
    server.on("stream", (stream, headers) => {
      if (headers[":path"] === "/in-flight") {
        inFlight = stream;
        stream.respond({ ":status": 200 });
        return;
      }
      stream.on("frameError", (type, code) => events.push(["frameError", type, code]));
      stream.on("error", err => events.push(["error", (err as NodeJS.ErrnoException).code, err.message]));
      stream.on("close", () => {
        events.push(["close", stream.rstCode]);
        overClosed.resolve();
      });
    });
    answers[name](server);
    const c = await connectWithOpenStream(server);
    try {
      await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 3);
      await overClosed.promise;
      expect(events).toEqual([
        ["frameError", FrameType.HEADERS, ErrorCode.FRAME_SIZE_ERROR],
        ["error", "ERR_HTTP2_STREAM_ERROR", "Stream closed with error code NGHTTP2_FRAME_SIZE_ERROR"],
        ["close", ErrorCode.FRAME_SIZE_ERROR],
      ]);
      await expectGracefulClose(c, inFlight);
      expect(framesOn(c, 3)).toEqual([["RST_STREAM", ErrorCode.FRAME_SIZE_ERROR]]);
    } finally {
      c.destroy();
      server.close();
    }
  });

  test("server still sends a respond() that follows a refused additionalHeaders()", async () => {
    const server = http2.createServer({ maxSendHeaderBlockLength: LIMIT });
    let inFlight!: http2.ServerHttp2Stream;
    server.on("stream", (stream, headers) => {
      if (headers[":path"] === "/in-flight") {
        inFlight = stream;
        stream.respond({ ":status": 200 });
        return;
      }
      stream.additionalHeaders({ ":status": 103, "x-big": OVER_LIMIT });
      stream.respond({ ":status": 200 });
      stream.end("body");
    });
    const c = await connectWithOpenStream(server);
    try {
      await expectGracefulClose(c, inFlight);
      expect(framesOn(c, 3)).toEqual([
        [FrameType.HEADERS, 0x4],
        [FrameType.DATA, 0x1],
      ]);
    } finally {
      c.destroy();
      server.close();
    }
  });

  test("server resets the stream when sendTrailers() is over the limit", async () => {
    const server = http2.createServer({ maxSendHeaderBlockLength: LIMIT });
    let inFlight!: http2.ServerHttp2Stream;
    const frameError = Promise.withResolvers<number[]>();
    server.on("stream", (stream, headers) => {
      if (headers[":path"] === "/in-flight") {
        inFlight = stream;
        stream.respond({ ":status": 200 });
        return;
      }
      stream.on("error", () => {});
      stream.on("frameError", (type, code) => frameError.resolve([type, code]));
      stream.on("wantTrailers", () => stream.sendTrailers({ "x-big": OVER_LIMIT }));
      stream.respond({ ":status": 200 }, { waitForTrailers: true });
      stream.end("body");
    });
    const c = await connectWithOpenStream(server);
    try {
      expect(await frameError.promise).toEqual([FrameType.HEADERS, ErrorCode.FRAME_SIZE_ERROR]);
      await expectGracefulClose(c, inFlight);
      expect(framesOn(c, 3).map(f => f[0])).toEqual([FrameType.HEADERS, FrameType.DATA, "RST_STREAM"]);
    } finally {
      c.destroy();
      server.close();
    }
  });

  test("the default limit is nghttp2's 65536 bytes", async () => {
    // nghttp2's bound for these two fields is 56 bytes plus the value.
    const largestSent = 65536 - 56;
    const server = http2.createServer();
    server.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      const length = headers[":path"] === "/in-flight" ? largestSent : largestSent + 1;
      stream.respond({ ":status": 200, "x-big": Buffer.alloc(length, "b").toString() }, { sendDate: false });
      stream.end();
    });
    const c = await connectWithOpenStream(server);
    try {
      await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 3);
      expect(framesOn(c, 3)).toEqual([["RST_STREAM", ErrorCode.FRAME_SIZE_ERROR]]);
      expect(goawayErrorCode(await c.waitForGoaway())).toBe(ErrorCode.NO_ERROR);
      const blockBytes = c.frames
        .filter(f => f.streamId === 1 && (f.type === FrameType.HEADERS || f.type === FrameType.CONTINUATION))
        .reduce((n, f) => n + f.length, 0);
      expect(blockBytes).toBeGreaterThan(8192);
    } finally {
      c.destroy();
      server.close();
    }
  });

  test("client request() fails with REFUSED_STREAM and the session closes", async () => {
    const server = http2.createServer();
    const paths: string[] = [];
    let inFlight!: http2.ServerHttp2Stream;
    const trailers = Promise.withResolvers<http2.IncomingHttpHeaders>();
    server.on("stream", (stream, headers) => {
      paths.push(headers[":path"] as string);
      inFlight = stream;
      stream.on("trailers", trailers.resolve);
      stream.resume();
      stream.respond({ ":status": 200 });
    });
    const serverGoaway = Promise.withResolvers<number>();
    server.on("session", session => session.on("goaway", code => serverGoaway.resolve(code)));
    server.listen(0);
    await once(server, "listening");
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, {
      maxSendHeaderBlockLength: LIMIT,
    });
    try {
      const events: unknown[][] = [];
      client.on("error", err => events.push(["session error", (err as NodeJS.ErrnoException).code]));
      const sessionClosed = closed(client);
      const first = client.request({ ":path": "/in-flight", ":method": "POST" }, { waitForTrailers: true });
      first.on("wantTrailers", () => first.sendTrailers({ "x-refused": "field" }));
      first.on("error", err => events.push(["in-flight error", (err as NodeJS.ErrnoException).code]));
      const firstClosed = closed(first);
      await once(first, "response");

      const over = client.request({ ":path": "/over", "x-refused": "field", "x-big": OVER_LIMIT });
      over.on("frameError", (type, code) => events.push(["frameError", type, code]));
      over.on("error", err => events.push(["error", (err as NodeJS.ErrnoException).code, err.message]));
      await closed(over);
      expect(await serverGoaway.promise).toBe(ErrorCode.NO_ERROR);

      // The refused block left nothing in the HPACK table, or this field would refer to an entry the server never got.
      first.end();
      expect((await trailers.promise)["x-refused"]).toBe("field");

      inFlight.end("still delivered");
      const body = await first.setEncoding("utf8").toArray();
      await firstClosed;
      await sessionClosed;
      expect({ events, body: body.join(""), paths }).toEqual({
        events: [
          ["frameError", FrameType.HEADERS, ErrorCode.FRAME_SIZE_ERROR],
          ["error", "ERR_HTTP2_STREAM_ERROR", "Stream closed with error code NGHTTP2_REFUSED_STREAM"],
        ],
        body: "still delivered",
        paths: ["/in-flight"],
      });
    } finally {
      client.destroy();
      server.close();
    }
  });
});

describe("a server stream that ends before respond() (RFC 9113 §8.1)", () => {
  async function framesAfter(handler: (stream: http2.ServerHttp2Stream) => void, last: (f: Frame) => boolean) {
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.on("error", () => {});
      handler(stream);
    });
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
      await c.waitFor(f => f.streamId === 1 && last(f));
      return c.frames
        .filter(f => f.streamId === 1)
        .map(f => (f.type === FrameType.RST_STREAM ? ["RST_STREAM", f.payload.readUInt32BE(0)] : [f.type, f.flags]));
    } finally {
      c.destroy();
      server.close();
    }
  }

  test.each([
    [
      "close(code)",
      (stream: http2.ServerHttp2Stream) => stream.close(ErrorCode.REFUSED_STREAM),
      ErrorCode.REFUSED_STREAM,
    ],
    ["close()", (stream: http2.ServerHttp2Stream) => stream.close(), ErrorCode.NO_ERROR],
    ["destroy()", (stream: http2.ServerHttp2Stream) => stream.destroy(), ErrorCode.NO_ERROR],
  ] as const)("%s sends RST_STREAM and no DATA frame", async (_, handler, code) => {
    expect(await framesAfter(handler, f => f.type === FrameType.RST_STREAM)).toEqual([["RST_STREAM", code]]);
  });

  test("end() then respond() puts END_STREAM on the HEADERS frame", async () => {
    const frames = await framesAfter(
      stream => {
        stream.end();
        stream.respond({ ":status": 200 });
      },
      f => f.type === FrameType.HEADERS,
    );
    expect(frames).toEqual([[FrameType.HEADERS, 0x5]]);
  });
});

describe("RST_STREAM from close(code) and destroy() (RFC 9113 §6.4)", () => {
  const onStream1 = (frames: Frame[]) =>
    frames
      .filter(f => f.streamId === 1)
      .map(f => (f.type === FrameType.RST_STREAM ? ["RST_STREAM", f.payload.readUInt32BE(0)] : [f.type, f.flags]));
  const isReset = (f: Frame) => f.type === FrameType.RST_STREAM && f.streamId === 1;
  const isPingAck = (payload: Buffer) => (f: Frame) =>
    f.type === FrameType.PING && (f.flags & 0x1) !== 0 && f.payload.equals(payload);

  /** Everything the peer wrote on stream 1, once a second RST_STREAM would have had time to arrive. */
  async function framesAfterReset(raw: RawH2 | RawH2Server, closed: Promise<unknown>) {
    await raw.waitFor(isReset);
    // The session forgets a closed stream at its next read.
    raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8, 1));
    await raw.waitFor(isPingAck(Buffer.alloc(8, 1)));
    await closed;
    // _destroy() schedules its RST_STREAM with setImmediate() before 'close'.
    await new Promise(resolve => setImmediate(resolve));
    raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8, 2));
    await raw.waitFor(isPingAck(Buffer.alloc(8, 2)));
    return onStream1(raw.frames);
  }

  async function serverFrames(method: "GET" | "POST", handler: (stream: http2.ServerHttp2Stream) => void) {
    const closed = Promise.withResolvers<void>();
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.on("error", () => {});
      stream.on("close", closed.resolve);
      handler(stream);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.sendFrame(FrameType.HEADERS, method === "GET" ? 0x5 : 0x4, 1, requestHeaderBlock(method));
      return await framesAfterReset(c, closed.promise);
    } finally {
      c.destroy();
      server.close();
    }
  }

  async function clientFrames(start: (req: http2.ClientHttp2Stream) => void) {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    try {
      client.on("error", () => {});
      // The client's 'connect' can come before the raw server's 'connection', which sets raw.socket.
      await raw.waitFor(f => f.type === FrameType.SETTINGS);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      const req = client.request({ ":method": "POST", ":path": "/" });
      req.on("error", () => {});
      const closed = once(req, "close");
      start(req);
      return await framesAfterReset(raw, closed);
    } finally {
      client.destroy();
      raw.close();
    }
  }

  // The first close wins, as in Node: the reset behind close(code) comes too late to change the code.
  describe.each([
    ["ends on HEADERS", [encodeFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"))]],
    [
      "ends on DATA",
      [
        encodeFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST")),
        encodeFrame(FrameType.DATA, 0x1, 1, Buffer.from("body")),
      ],
    ],
    ["hasn't ended", [encodeFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"))]],
  ])("server close(code) on a request that %s", (_, request) => {
    test.each([ErrorCode.NO_ERROR, ErrorCode.CANCEL, ErrorCode.INTERNAL_ERROR])(
      "keeps its code when RST_STREAM(%d) arrives in the same read",
      async peerCode => {
        const closed = Promise.withResolvers<unknown[]>();
        const errors: string[] = [];
        const server = http2.createServer();
        server.on("stream", stream => {
          stream.on("error", err => errors.push(`${err.code}: ${err.message}`));
          stream.on("close", () => closed.resolve([stream.rstCode, errors]));
          stream.close(ErrorCode.REFUSED_STREAM);
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const c = await RawH2.connect((server.address() as net.AddressInfo).port);
        try {
          const reset = Buffer.alloc(4);
          reset.writeUInt32BE(peerCode);
          c.sendPreface();
          c.sendEmptySettings();
          c.send(Buffer.concat([...request, encodeFrame(FrameType.RST_STREAM, 0, 1, reset)]));
          expect(await closed.promise).toEqual([
            ErrorCode.REFUSED_STREAM,
            ["ERR_HTTP2_STREAM_ERROR: Stream closed with error code NGHTTP2_REFUSED_STREAM"],
          ]);
        } finally {
          c.destroy();
          server.close();
        }
      },
    );

    test("takes the client's CANCEL when nobody listens for 'error'", async () => {
      const closed = Promise.withResolvers<number>();
      const server = http2.createServer();
      server.on("stream", stream => {
        stream.on("close", () => closed.resolve(stream.rstCode));
        stream.close(ErrorCode.REFUSED_STREAM);
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const c = await RawH2.connect((server.address() as net.AddressInfo).port);
      try {
        const reset = Buffer.alloc(4);
        reset.writeUInt32BE(ErrorCode.CANCEL);
        c.sendPreface();
        c.sendEmptySettings();
        c.send(Buffer.concat([...request, encodeFrame(FrameType.RST_STREAM, 0, 1, reset)]));
        expect(await closed.promise).toBe(ErrorCode.CANCEL);
      } finally {
        c.destroy();
        server.close();
      }
    });
  });

  test.each(["GET", "POST"] as const)(
    "server close(code) right after write() on a %s sends no END_STREAM",
    async method => {
      const frames = await serverFrames(method, stream => {
        stream.respond({ ":status": 200 });
        stream.write("partial");
        stream.close(ErrorCode.INTERNAL_ERROR);
      });
      expect(frames).toEqual([
        [FrameType.HEADERS, 0x4],
        [FrameType.DATA, 0],
        ["RST_STREAM", ErrorCode.INTERNAL_ERROR],
      ]);
    },
  );

  test("server close(code) with a second chunk still buffered sends no END_STREAM", async () => {
    const frames = await serverFrames("GET", stream => {
      stream.respond({ ":status": 200 });
      stream.write("aaaa");
      stream.write("bbbb");
      stream.close(ErrorCode.INTERNAL_ERROR);
    });
    expect(frames.filter(([type]) => type !== FrameType.DATA)).toEqual([
      [FrameType.HEADERS, 0x4],
      ["RST_STREAM", ErrorCode.INTERNAL_ERROR],
    ]);
    expect(frames.filter(([type, flags]) => type === FrameType.DATA && flags !== 0)).toEqual([]);
  });

  test.each(["GET", "POST"] as const)(
    "server destroy() after a finished write() on a %s sends no END_STREAM",
    async method => {
      const frames = await serverFrames(method, stream => {
        stream.respond({ ":status": 200 });
        stream.write("partial", () => stream.destroy());
      });
      expect(frames).toEqual([
        [FrameType.HEADERS, 0x4],
        [FrameType.DATA, 0],
        ["RST_STREAM", ErrorCode.NO_ERROR],
      ]);
    },
  );

  test("client destroy() in the middle of an upload sends no END_STREAM", async () => {
    const frames = await clientFrames(req => req.write("partial", () => req.destroy()));
    expect(frames).toEqual([
      [FrameType.HEADERS, 0x4],
      [FrameType.DATA, 0],
      ["RST_STREAM", ErrorCode.NO_ERROR],
    ]);
  });

  test("client close(code) right after write() sends one RST_STREAM and no END_STREAM", async () => {
    const frames = await clientFrames(req => {
      req.write("partial");
      req.close(ErrorCode.CANCEL);
    });
    expect(frames).toEqual([
      [FrameType.HEADERS, 0x4],
      [FrameType.DATA, 0],
      ["RST_STREAM", ErrorCode.CANCEL],
    ]);
  });

  test("respond(), respondWithFile() and respondWithFD() throw on a closed stream", async () => {
    const codes: Record<string, string | undefined> = {};
    const frames = await serverFrames("GET", stream => {
      stream.close(ErrorCode.REFUSED_STREAM);
      const fd = fs.openSync(import.meta.path, "r");
      const calls = {
        respond: () => stream.respond({ ":status": 200 }),
        respondWithFile: () => stream.respondWithFile(import.meta.path),
        respondWithFD: () => stream.respondWithFD(fd),
      };
      for (const [name, call] of Object.entries(calls)) {
        try {
          call();
        } catch (e: any) {
          codes[name] = e.code;
        }
      }
      fs.closeSync(fd);
    });
    expect(codes).toEqual({
      respond: "ERR_HTTP2_INVALID_STREAM",
      respondWithFile: "ERR_HTTP2_INVALID_STREAM",
      respondWithFD: "ERR_HTTP2_INVALID_STREAM",
    });
    expect(frames).toEqual([["RST_STREAM", ErrorCode.REFUSED_STREAM]]);
  });

  test.each([false, true])("client gets an error for a response the server reset mid-body (TLS: %p)", async secure => {
    const server = secure ? http2.createSecureServer(tlsCert) : http2.createServer();
    server.on("stream", stream => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.write("partial");
      stream.close(ErrorCode.INTERNAL_ERROR);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    const client = http2.connect(`${secure ? "https" : "http"}://127.0.0.1:${port}`, { ca: tlsCert.cert });
    try {
      client.on("error", () => {});
      const req = client.request({ ":path": "/" });
      const events: string[] = [];
      req.on("error", (e: any) => events.push(e.code));
      req.on("end", () => events.push("end"));
      req.resume();
      await new Promise<void>(resolve => req.on("close", resolve));
      expect({ events, rstCode: req.rstCode }).toEqual({
        events: ["ERR_HTTP2_STREAM_ERROR"],
        rstCode: ErrorCode.INTERNAL_ERROR,
      });
    } finally {
      client.destroy();
      server.close();
    }
  });
});

describe("client requests queued behind SETTINGS_MAX_CONCURRENT_STREAMS (RFC 9113 §5.1.2)", () => {
  /** A client whose peer allows one stream, with request 1 open on the wire and request 2 waiting for its slot. */
  async function atTheLimit(signal?: AbortSignal) {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    // The client's 'connect' can come before the raw server's 'connection', which sets raw.socket.
    await raw.waitFor(f => f.type === FrameType.SETTINGS);
    raw.sendFrame(FrameType.SETTINGS, 0, 0, http2.getPackedSettings({ maxConcurrentStreams: 1 }));
    await once(client, "remoteSettings");
    const open = client.request({ ":method": "POST", ":path": "/" }, { signal });
    const queued = client.request({ ":path": "/" });
    for (const req of [open, queued]) req.on("error", () => {});
    await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
    return { raw, client, open, queued };
  }

  test.each([
    ["destroy()", (req: http2.ClientHttp2Stream) => req.destroy()],
    ["destroy(err)", (req: http2.ClientHttp2Stream) => req.destroy(new Error("boom"))],
    ["close(code)", (req: http2.ClientHttp2Stream) => req.close(ErrorCode.CANCEL)],
    ["its signal", (_: http2.ClientHttp2Stream, controller: AbortController) => controller.abort()],
  ] as const)("the next request goes out after the RST_STREAM when %s cancels the open one", async (_, cancel) => {
    const controller = new AbortController();
    const { raw, client, open, queued } = await atTheLimit(controller.signal);
    try {
      expect(queued.pending).toBe(true);
      cancel(open, controller);
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 3);
      await raw.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 1);
      expect(
        raw.frames
          .filter(f => f.type === FrameType.HEADERS || f.type === FrameType.RST_STREAM)
          .map(f => [f.type, f.streamId]),
      ).toEqual([
        [FrameType.HEADERS, 1],
        [FrameType.RST_STREAM, 1],
        [FrameType.HEADERS, 3],
      ]);
    } finally {
      client.destroy();
      raw.close();
    }
  });

  test("a finished response that isn't read yet doesn't hold its slot", async () => {
    const { raw, client, open } = await atTheLimit();
    try {
      open.end();
      await raw.waitFor(f => f.streamId === 1 && (f.flags & 0x1) !== 0);
      raw.sendFrame(FrameType.HEADERS, 0x4, 1, Buffer.from([0x88])); // :status 200
      raw.sendFrame(FrameType.DATA, 0x1, 1, Buffer.from("unread"));
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 3);
      expect(open.destroyed).toBe(false);
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

describe("request({ signal })", () => {
  /** A request to a server that never reads the body, so anything past the 64 KiB window stays blocked. */
  async function blockedUpload(signal: AbortSignal, send: (req: http2.ClientHttp2Stream) => void, abort: () => void) {
    const server = http2.createServer();
    const received = Promise.withResolvers<void>();
    server.on("stream", stream => {
      stream.on("error", () => {});
      received.resolve();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    try {
      const events: string[] = [];
      const req = client.request({ ":method": "POST", ":path": "/" }, { signal });
      for (const name of ["drain", "aborted", "finish"]) req.on(name, () => events.push(name));
      req.on("error", (err: any) => events.push(err.code));
      const closed = new Promise<void>(resolve => req.on("close", resolve));
      send(req);
      await received.promise;
      abort();
      await closed;
      return { events, aborted: req.aborted, rstCode: req.rstCode };
    } finally {
      client.destroy();
      server.close();
    }
  }

  test("aborting while a write waits for the window emits no 'drain'", async () => {
    const controller = new AbortController();
    expect(
      await blockedUpload(
        controller.signal,
        req => void req.write(Buffer.alloc(200_000)),
        () => controller.abort(),
      ),
    ).toEqual({ events: ["aborted", "ABORT_ERR"], aborted: true, rstCode: ErrorCode.CANCEL });
  });

  test("aborting after end() doesn't emit 'aborted'", async () => {
    const controller = new AbortController();
    expect(
      await blockedUpload(
        controller.signal,
        req => void req.end(Buffer.alloc(200_000)),
        () => controller.abort(),
      ),
    ).toEqual({ events: ["ABORT_ERR"], aborted: false, rstCode: ErrorCode.CANCEL });
  });

  test("accepts any EventTarget with an 'aborted' property", async () => {
    const signal = Object.assign(new EventTarget(), { aborted: false }) as unknown as AbortSignal;
    expect(
      await blockedUpload(
        signal,
        () => {},
        () => signal.dispatchEvent(new Event("abort")),
      ),
    ).toEqual({ events: ["aborted", "ABORT_ERR"], aborted: true, rstCode: ErrorCode.CANCEL });
  });
});

test("endAfterHeaders, rstCode and headersSent work on a pending stream and keep their values after 'close'", async () => {
  const seen: Record<string, unknown[]> = {};
  const record = (label: string, stream: http2.Http2Stream) =>
    (seen[label] = [stream.endAfterHeaders, stream.rstCode, stream.headersSent]);
  const server = http2.createServer();
  const serverClosed = Promise.withResolvers<void>();
  server.on("stream", (stream, headers) => {
    const method = headers[":method"];
    record(`server ${method} 'stream'`, stream);
    stream.on("trailers", () => record(`server ${method} 'trailers'`, stream));
    stream.on("close", () => {
      record(`server ${method} 'close'`, stream);
      if (method === "POST") serverClosed.resolve();
    });
    stream.on("end", () => stream.respond({ ":status": 204 }, { endStream: true }));
    stream.resume();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
  try {
    const get = client.request({ ":path": "/" });
    expect(get.pending).toBe(true);
    record("client pending", get);
    get.on("response", () => record("client 'response'", get));
    get.resume();
    await once(get, "close");
    record("client 'close'", get);

    const post = client.request({ ":method": "POST", ":path": "/" }, { waitForTrailers: true });
    post.on("wantTrailers", () => post.sendTrailers({ a: "b" }));
    post.end("x");
    post.resume();
    await Promise.all([once(post, "close"), serverClosed.promise]);
    expect(seen).toEqual({
      "client pending": [false, 0, true],
      "server GET 'stream'": [true, 0, false],
      "server GET 'close'": [true, 0, true],
      // A request's own flag stays false even though this response's HEADERS carry END_STREAM.
      "client 'response'": [false, 0, true],
      "client 'close'": [false, 0, true],
      "server POST 'stream'": [false, 0, false],
      "server POST 'trailers'": [false, 0, false],
      "server POST 'close'": [false, 0, true],
    });
  } finally {
    client.close();
    server.close();
  }
});

test("client emits 'end' before 'close' when the server resets an unread request with NO_ERROR", async () => {
  const raw = await RawH2Server.listen();
  const client = http2.connect(`http://127.0.0.1:${raw.port}`);
  try {
    const events: string[] = [];
    const req = client.request({ ":path": "/" });
    for (const name of ["response", "end", "error"]) req.on(name, () => events.push(name));
    const closed = new Promise<void>(resolve => req.on("close", () => resolve()));
    await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
    raw.sendFrame(FrameType.SETTINGS, 0, 0);
    raw.sendFrame(FrameType.RST_STREAM, 0, 1, Buffer.alloc(4));
    await closed;
    expect({ events, rstCode: req.rstCode }).toEqual({ events: ["end"], rstCode: ErrorCode.NO_ERROR });
  } finally {
    client.destroy();
    raw.close();
  }
});

/** The §6.3 size updates in an HPACK header block and every dynamic-table index (above 61) it uses. */
function inspectHeaderBlock(block: Buffer): { sizeUpdates: number[]; dynamicIndexes: number[] } {
  const sizeUpdates: number[] = [];
  const dynamicIndexes: number[] = [];
  let pos = 0;
  const readInt = (prefixBits: number) => {
    const max = (1 << prefixBits) - 1;
    let value = block[pos++] & max;
    if (value === max) {
      let shift = 0;
      let byte: number;
      do {
        byte = block[pos++];
        value += (byte & 0x7f) * 2 ** shift;
        shift += 7;
      } while (byte & 0x80);
    }
    return value;
  };
  const skipString = () => {
    const length = readInt(7);
    pos += length;
  };
  const literalField = (prefixBits: number) => {
    const nameIndex = readInt(prefixBits);
    if (nameIndex > 61) dynamicIndexes.push(nameIndex);
    if (nameIndex === 0) skipString();
    skipString();
  };
  while (pos < block.length) {
    const first = block[pos];
    if (first & 0x80) {
      const index = readInt(7);
      if (index > 61) dynamicIndexes.push(index);
    } else if (first & 0x40) {
      literalField(6);
    } else if (first & 0x20) {
      sizeUpdates.push(readInt(5));
    } else {
      literalField(4);
    }
  }
  return { sizeUpdates, dynamicIndexes };
}

// nginx sends 0 to every gRPC upstream and fails a response that uses a dynamic index.
describe("SETTINGS_HEADER_TABLE_SIZE (RFC 7541 §4.2)", () => {
  /** A SETTINGS payload with one HEADER_TABLE_SIZE entry per value. */
  const headerTableSizes = (...values: number[]) => {
    const payload = Buffer.alloc(6 * values.length);
    values.forEach((value, i) => {
      payload.writeUInt16BE(0x1, i * 6);
      payload.writeUInt32BE(value, i * 6 + 2);
    });
    return payload;
  };
  const sizeUpdate = (size: number) => hpackInt(size, 5, 0x20);
  const isSettings = (f: Frame) => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0;

  async function listen(
    onStream: (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void,
    options: http2.ServerOptions = {},
  ) {
    const h2server = http2.createServer(options);
    h2server.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      onStream(stream, headers);
    });
    h2server.listen(0, "127.0.0.1");
    await once(h2server, "listening");
    return { h2server, h2port: (h2server.address() as net.AddressInfo).port };
  }

  /** A raw client that opens the connection with these SETTINGS payloads and ACKs the server's SETTINGS. */
  async function rawClient(h2port: number, ...settingsPayloads: Buffer[]) {
    const c = await RawH2.connect(h2port);
    c.sendPreface();
    if (settingsPayloads.length === 0) c.sendEmptySettings();
    for (const payload of settingsPayloads) c.sendFrame(FrameType.SETTINGS, 0, 0, payload);
    await c.waitFor(isSettings);
    c.sendSettingsAck();
    return c;
  }

  function headerBlock(frame: Frame) {
    // END_HEADERS, not PADDED, no PRIORITY: the payload is the whole block.
    expect(frame.flags & 0x2c).toBe(0x04);
    return inspectHeaderBlock(frame.payload);
  }

  async function responseBlock(c: RawH2, streamId: number, request = requestHeaderBlock("GET")) {
    c.sendFrame(FrameType.HEADERS, 0x5, streamId, request);
    return headerBlock(await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === streamId));
  }

  const respondWithSharedHeader = (stream: http2.ServerHttp2Stream) => {
    stream.respond({ ":status": 200, "x-shared": "the same value on every response" });
    stream.end("ok");
  };

  test("server stops using the dynamic table after the peer sends 0", async () => {
    const { h2server, h2port } = await listen(respondWithSharedHeader);
    const c = await rawClient(h2port, headerTableSizes(0));
    try {
      expect([await responseBlock(c, 1), await responseBlock(c, 3), await responseBlock(c, 5)]).toEqual([
        { sizeUpdates: [0], dynamicIndexes: [] },
        { sizeUpdates: [], dynamicIndexes: [] },
        { sizeUpdates: [], dynamicIndexes: [] },
      ]);
    } finally {
      c.destroy();
      h2server.close();
    }
  });

  test.each([
    ["two SETTINGS frames", [headerTableSizes(0), headerTableSizes(4096)]],
    ["two entries of one SETTINGS frame", [headerTableSizes(0, 4096)]],
  ])("server announces the minimum, then the final size, for 0 then 4096 in %s", async (_, settingsPayloads) => {
    const { h2server, h2port } = await listen(respondWithSharedHeader);
    const c = await rawClient(h2port, ...settingsPayloads);
    try {
      expect(await responseBlock(c, 1)).toEqual({ sizeUpdates: [0, 4096], dynamicIndexes: [] });
      const second = await responseBlock(c, 3);
      expect(second.sizeUpdates).toEqual([]);
      expect(second.dynamicIndexes.length).toBeGreaterThan(0);
    } finally {
      c.destroy();
      h2server.close();
    }
  });

  test("server announces the change in the trailers when it arrives after the response headers", async () => {
    const { h2server, h2port } = await listen(stream => {
      stream.respond({ ":status": 200 }, { waitForTrailers: true });
      stream.on("wantTrailers", () => stream.sendTrailers({ "x-trailer": "done" }));
      stream.session!.on("remoteSettings", settings => {
        if (settings.headerTableSize === 0) stream.end("ok");
      });
    });
    const c = await rawClient(h2port);
    try {
      const response = await responseBlock(c, 1);
      c.sendFrame(FrameType.SETTINGS, 0, 0, headerTableSizes(0));
      const trailers = await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1 && (f.flags & 0x1) !== 0);
      expect([response, headerBlock(trailers)]).toEqual([
        { sizeUpdates: [], dynamicIndexes: [] },
        { sizeUpdates: [0], dynamicIndexes: [] },
      ]);
    } finally {
      c.destroy();
      h2server.close();
    }
  });

  test.each([
    ["the peer's", {}, [headerTableSizes(65536)]],
    ["the local", { settings: { headerTableSize: 65536 } }, []],
  ])("%s table size above 4096 doesn't grow the server's encoder table", async (_, options, settingsPayloads) => {
    // About 243 bytes per entry (name + value + 32), so a 4096-byte table holds 16 of these 40.
    const bigHeaders: Record<string, string> = {};
    for (let i = 0; i < 40; i++) {
      bigHeaders[`x-big-${i}`] = String(i).padStart(3, "0") + Buffer.alloc(200, "v").toString();
    }
    const { h2server, h2port } = await listen(stream => {
      stream.respond({ ":status": 200, ...bigHeaders });
      stream.end("ok");
    }, options);
    const c = await rawClient(h2port, ...settingsPayloads);
    try {
      const blocks = [await responseBlock(c, 1), await responseBlock(c, 3)];
      expect(blocks.map(b => b.sizeUpdates)).toEqual([[], []]);
      expect(Math.max(0, ...blocks.flatMap(b => b.dynamicIndexes))).toBeLessThanOrEqual(61 + 16);
    } finally {
      c.destroy();
      h2server.close();
    }
  });

  test("client stops using the dynamic table after the server sends 0", async () => {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    const requestBlock = async (streamId: number, beforeResponse?: () => Promise<unknown>) => {
      const req = client.request({ ":path": "/", "x-request-id": "abcdef0123456789" });
      req.on("error", () => {});
      req.resume();
      const headers = await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === streamId);
      await beforeResponse?.();
      raw.sendFrame(FrameType.HEADERS, 0x5, streamId, Buffer.from([0x88]));
      await once(req, "close");
      return headerBlock(headers);
    };
    try {
      // The first request leaves before the server's SETTINGS arrives.
      const first = await requestBlock(1, () => {
        raw.sendFrame(FrameType.SETTINGS, 0, 0, headerTableSizes(0));
        raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
        return raw.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 1);
      });
      expect([first, await requestBlock(3), await requestBlock(5)]).toEqual([
        { sizeUpdates: [], dynamicIndexes: [] },
        { sizeUpdates: [0], dynamicIndexes: [] },
        { sizeUpdates: [], dynamicIndexes: [] },
      ]);
    } finally {
      client.destroy();
      raw.close();
    }
  });

  describe("the local value bounds the decoder once the peer ACKs it", () => {
    /** A literal field with incremental indexing (§6.2.1). The first one becomes dynamic index 62. */
    const indexed = (name: string, value: string) =>
      Buffer.concat([Buffer.from([0x40]), hpackLiteral(name), hpackLiteral(value)]);
    const DYNAMIC_INDEX_62 = Buffer.from([0x80 | 62]);

    /** A server that records the "x-probe" request header of every stream. */
    async function probeServer(options: http2.ServerOptions, onFirstStream?: (session: http2.Http2Session) => void) {
      const probes: (string | undefined)[] = [];
      const listening = await listen((stream, headers) => {
        probes.push(headers["x-probe"] as string | undefined);
        stream.respond({ ":status": 200 });
        stream.end("ok");
        if (probes.length === 1) onFirstStream?.(stream.session!);
      }, options);
      return { ...listening, probes };
    }

    test("a local 0 doesn't bind the decoder before the ACK", async () => {
      const { h2server, h2port, probes } = await probeServer({ settings: { headerTableSize: 0 } });
      const c = await RawH2.connect(h2port);
      try {
        c.sendPreface();
        c.sendEmptySettings();
        await responseBlock(c, 1, requestHeaderBlock("GET", indexed("x-probe", "kept in the table")));
        await responseBlock(c, 3, requestHeaderBlock("GET", DYNAMIC_INDEX_62));
        expect(probes).toEqual(["kept in the table", "kept in the table"]);
        expect(c.frames.filter(f => f.type === FrameType.GOAWAY)).toEqual([]);
      } finally {
        c.destroy();
        h2server.close();
      }
    });

    test("a size update above the ACKed local value is a COMPRESSION_ERROR", async () => {
      const { h2server, h2port } = await probeServer({ settings: { headerTableSize: 0 } });
      const c = await rawClient(h2port);
      try {
        c.sendFrame(FrameType.HEADERS, 0x5, 1, Buffer.concat([sizeUpdate(4096), requestHeaderBlock("GET")]));
        expect(goawayErrorCode(await c.waitForGoaway())).toBe(ErrorCode.COMPRESSION_ERROR);
      } finally {
        c.destroy();
        h2server.close();
      }
    });

    test("the table grows to a raised local value after the ACK", async () => {
      const RAISED = 8192;
      const { h2server, h2port, probes } = await probeServer({}, session =>
        session.settings({ headerTableSize: RAISED }),
      );
      const c = await rawClient(h2port);
      try {
        await responseBlock(c, 1);
        await c.waitFor(f => isSettings(f) && f.payload.includes(headerTableSizes(RAISED)));
        c.sendSettingsAck();
        // 7 + 6000 + 32 bytes: this entry only fits in the raised table.
        const big = indexed("x-probe", Buffer.alloc(6000, "p").toString());
        await responseBlock(c, 3, Buffer.concat([sizeUpdate(RAISED), requestHeaderBlock("GET", big)]));
        await responseBlock(c, 5, requestHeaderBlock("GET", DYNAMIC_INDEX_62));
        expect(probes.map(p => p?.length)).toEqual([undefined, 6000, 6000]);
        expect(c.frames.filter(f => f.type === FrameType.GOAWAY)).toEqual([]);
      } finally {
        c.destroy();
        h2server.close();
      }
    });
  });
});

// With SETTINGS_INITIAL_WINDOW_SIZE = 0 every response's last DATA frame waits in its stream's queue. Raising the
// window lets one flush write them all, and each write callback ends its stream, which calls flush() again.
describe("flushing the queued frames of many streams", () => {
  const initialWindowSize = (size: number) => {
    const payload = Buffer.alloc(6);
    payload.writeUInt16BE(0x4, 0);
    payload.writeUInt32BE(size, 2);
    return encodeFrame(FrameType.SETTINGS, 0, 0, payload);
  };
  const requests = (count: number) =>
    Buffer.concat(
      Array.from({ length: count }, (_, i) =>
        encodeFrame(FrameType.HEADERS, 0x5, 1 + 2 * i, requestHeaderBlock("GET")),
      ),
    );

  test.each([
    [
      "write(chunk), end()",
      (stream: http2.ServerHttp2Stream) => {
        stream.respond({ ":status": 200 });
        stream.write("x");
        stream.end();
      },
    ],
    [
      "end(chunk) with trailers",
      (stream: http2.ServerHttp2Stream) => {
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        stream.on("wantTrailers", () => stream.sendTrailers({ "x-trailer": "1" }));
        stream.end("x");
      },
    ],
  ])("%s: one stream's end doesn't run inside another's", async (_, answer) => {
    const STREAMS = 50;
    let depth = 0;
    let maxDepth = 0;
    let finished = 0;
    const { promise: allAnswered, resolve: answered } = Promise.withResolvers<void>();
    const { promise: allFinished, resolve: done } = Promise.withResolvers<void>();
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      // _final() runs from the stream's last write callback and flushes the session.
      const final = stream._final;
      stream._final = function (callback) {
        maxDepth = Math.max(maxDepth, ++depth);
        try {
          return final.call(this, callback);
        } finally {
          depth--;
        }
      };
      stream.on("finish", () => void (++finished === STREAMS && done()));
      answer(stream);
      if (stream.id === 2 * STREAMS - 1) answered();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.send(Buffer.concat([initialWindowSize(0), requests(STREAMS)]));
      await allAnswered;
      c.send(initialWindowSize(65535));
      await allFinished;
      expect({ maxDepth, finished }).toEqual({ maxDepth: 1, finished: STREAMS });
    } finally {
      c.destroy();
      server.close();
    }
  });

  // 3000 streams take about 15 s on a debug build. The tests above cover the same flush there.
  test.skipIf(isDebug || isASAN)("3000 queued streams don't overflow the stack", async () => {
    const fixture = String.raw`
      const http2 = require("node:http2");
      const net = require("node:net");
      const STREAMS = 3000;
      const frame = (type, flags, id, payload = Buffer.alloc(0)) => {
        const header = Buffer.alloc(9);
        header.writeUIntBE(payload.length, 0, 3);
        header[3] = type;
        header[4] = flags;
        header.writeUInt32BE(id, 5);
        return Buffer.concat([header, payload]);
      };
      const initialWindowSize = size => frame(4, 0, 0, Buffer.from([0, 4, 0, 0, size >> 8, size & 255]));
      const get = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01, 9]), Buffer.from("localhost")]);
      let started = 0;
      let ended = 0;
      let socket;
      const server = http2.createServer();
      server.on("stream", stream => {
        stream.respond({ ":status": 200 });
        stream.write("x");
        stream.end(() => {
          if (++ended < STREAMS) return;
          console.log(ended + " responses ended");
          process.exit(0);
        });
        if (++started === STREAMS) socket.write(initialWindowSize(65535));
      });
      server.listen(0, "127.0.0.1", () => {
        socket = net.connect(server.address().port, "127.0.0.1");
        socket.resume();
        const frames = [Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"), initialWindowSize(0)];
        for (let i = 0; i < STREAMS; i++) frames.push(frame(1, 0x5, 1 + 2 * i, get));
        socket.write(Buffer.concat(frames));
      });
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "3000 responses ended\n", stderr: "", exitCode: 0 });
  });
});

// Like Node through v26, RST_STREAM(NO_ERROR) closes a server stream once its response has left and its
// request was never read. Nothing else releases the stream while the client keeps the request open.
describe("an answered server stream whose request was never read", () => {
  // A loaded debug build can need more than waitFor()'s default 2 s.
  const WAIT = 10_000;
  const RST = `RST_STREAM ${ErrorCode.NO_ERROR}`;
  // END_HEADERS without END_STREAM: the request stays open.
  const open = (sid: number) => encodeFrame(FrameType.HEADERS, 0x4, sid, requestHeaderBlock("POST"));
  const get = (sid: number) => encodeFrame(FrameType.HEADERS, 0x5, sid, requestHeaderBlock("GET"));
  const data = (sid: number, payload: Buffer, endStream = false) =>
    encodeFrame(FrameType.DATA, endStream ? 0x1 : 0, sid, payload);
  const windowUpdate = (sid: number, increment: number) => {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(increment);
    return encodeFrame(FrameType.WINDOW_UPDATE, 0, sid, payload);
  };
  const notFound = (_req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => {
    res.writeHead(404);
    res.end("not found");
  };

  // Ends with a graceful server.close(), which only calls back once no stream is left, while the client stays connected.
  async function withClient(server: http2.Http2Server, secure: boolean, body: (c: RawH2) => Promise<void>) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port, secure);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      await c.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0, WAIT);
      c.sendSettingsAck();
      await body(c);
      await new Promise<void>(resolve => server.close(() => resolve()));
    } finally {
      c.destroy();
      if (server.listening) server.close();
    }
  }

  const answered = (c: RawH2, sid: number) =>
    c.waitFor(f => f.streamId === sid && f.type <= FrameType.HEADERS && (f.flags & 0x1) !== 0, WAIT);

  let pings = 0;
  // A PING ACK follows every frame the server wrote before it. The close takes two of the server's immediates.
  async function settle(c: RawH2) {
    for (let i = 0; i < 3; i++) {
      await new Promise<void>(resolve => setImmediate(resolve));
      const opaque = Buffer.alloc(8);
      opaque.writeUInt32BE(++pings, 4);
      c.sendFrame(FrameType.PING, 0, 0, opaque);
      await c.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0 && f.payload.equals(opaque), WAIT);
    }
  }

  function framesOf(c: RawH2, sid: number): string[] {
    return c.frames
      .filter(f => f.streamId === sid && f.type !== FrameType.WINDOW_UPDATE)
      .map(f => {
        if (f.type === FrameType.RST_STREAM) return `RST_STREAM ${f.payload.readUInt32BE(0)}`;
        const name = f.type === FrameType.HEADERS ? "HEADERS" : f.type === FrameType.DATA ? "DATA" : `type ${f.type}`;
        return (f.flags & 0x1) !== 0 ? `${name}+END_STREAM` : name;
      });
  }

  test.each([
    ["TCP", false],
    ["TLS", true],
  ])("is reset over %s unless the request ended", async (_, secure) => {
    const server = secure ? http2.createSecureServer(tlsCert, notFound) : http2.createServer(notFound);
    await withClient(server, secure, async c => {
      // 1 sends nothing more, 3 sends one body byte, 5 ends its request.
      c.send(Buffer.concat([open(1), open(3), data(3, Buffer.from("x")), open(5), data(5, Buffer.alloc(0), true)]));
      await Promise.all([answered(c, 1), answered(c, 3), answered(c, 5)]);
      await settle(c);
      expect({ 1: framesOf(c, 1), 3: framesOf(c, 3), 5: framesOf(c, 5) }).toEqual({
        1: ["HEADERS", "DATA", "DATA+END_STREAM", RST],
        3: ["HEADERS", "DATA", "DATA+END_STREAM", RST],
        5: ["HEADERS", "DATA", "DATA+END_STREAM"],
      });
    });
  });

  test("emits 'finish', 'end' and 'close', not 'aborted'", async () => {
    const events: string[] = [];
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      for (const name of ["finish", "end", "aborted", "error"]) stream.on(name, () => events.push(name));
      stream.on("close", () => events.push(`close ${stream.rstCode}`));
      stream.respond({ ":status": 401 }, { endStream: true });
    });
    await withClient(server, false, async c => {
      c.send(open(1));
      await answered(c, 1);
      await settle(c);
      expect({ events, frames: framesOf(c, 1) }).toEqual({
        events: ["finish", "end", "close 0"],
        frames: ["HEADERS+END_STREAM", RST],
      });
    });
  });

  test("frees its maxConcurrentStreams slot", async () => {
    const server = http2.createServer({ settings: { maxConcurrentStreams: 2 } }, notFound);
    await withClient(server, false, async c => {
      c.send(Buffer.concat([open(1), open(3)]));
      await Promise.all([answered(c, 1), answered(c, 3)]);
      await settle(c);
      c.send(Buffer.concat([get(5), get(7)]));
      await Promise.all([answered(c, 5), answered(c, 7)]);
      expect({ 5: framesOf(c, 5), 7: framesOf(c, 7) }).toEqual({
        5: ["HEADERS", "DATA", "DATA+END_STREAM"],
        7: ["HEADERS", "DATA", "DATA+END_STREAM"],
      });
    });
  });

  test("gets its whole response before the reset when flow control holds the response back", async () => {
    const server = http2.createServer((req, res) => {
      if (req.stream.id === 1) return void res.end(Buffer.alloc(100_000, "a"));
      notFound(req, res);
    });
    await withClient(server, false, async c => {
      const received = (sid: number) =>
        c.frames.filter(f => f.streamId === sid && f.type === FrameType.DATA).reduce((sum, f) => sum + f.length, 0);
      // Stream 1 uses up the connection window.
      c.send(get(1));
      await c.waitFor(() => received(1) >= 65535, WAIT);
      c.send(open(3));
      await c.waitFor(f => f.streamId === 3 && f.type === FrameType.HEADERS, WAIT);
      await settle(c);
      expect(framesOf(c, 3)).toEqual(["HEADERS"]);
      // Room for stream 3's body only. Stream 1 can't use it, its own window is empty.
      c.send(windowUpdate(0, "not found".length));
      await answered(c, 3);
      await settle(c);
      expect(framesOf(c, 3)).toEqual(["HEADERS", "DATA", "DATA+END_STREAM", RST]);
      c.send(Buffer.concat([windowUpdate(0, 1 << 20), windowUpdate(1, 1 << 20)]));
      await answered(c, 1);
    });
  });

  test("ignores the rest of the request when it arrives after the reset", async () => {
    const server = http2.createServer(notFound);
    await withClient(server, false, async c => {
      c.send(open(1));
      await answered(c, 1);
      await settle(c);
      c.send(Buffer.concat([data(1, Buffer.alloc(100, "a")), data(1, Buffer.alloc(0), true), get(3)]));
      await answered(c, 3);
      await settle(c);
      expect({ 1: framesOf(c, 1), 3: framesOf(c, 3), goaway: c.frames.some(f => f.type === FrameType.GOAWAY) }).toEqual(
        {
          1: ["HEADERS", "DATA", "DATA+END_STREAM", RST],
          3: ["HEADERS", "DATA", "DATA+END_STREAM"],
          goaway: false,
        },
      );
    });
  });

  test.each<[string, (stream: http2.ServerHttp2Stream, onData: (chunk: Buffer) => void) => void]>([
    ["a 'data' listener", (stream, onData) => void stream.on("data", onData)],
    ["a 'data' listener added after an await", async (stream, onData) => void (await null, stream.on("data", onData))],
    [
      "a 'data' listener added in 'finish'",
      (stream, onData) => void stream.on("finish", () => stream.on("data", onData)),
    ],
  ])("stays open for %s", async (_, read) => {
    let received = 0;
    const { promise: ended, resolve: onEnd } = Promise.withResolvers<void>();
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("end", onEnd);
      stream.respond({ ":status": 200 });
      stream.end("x");
      read(stream, chunk => (received += chunk.length));
    });
    await withClient(server, false, async c => {
      c.send(open(1));
      await answered(c, 1);
      await settle(c);
      c.send(Buffer.concat([data(1, Buffer.alloc(1000, "a")), data(1, Buffer.alloc(500, "a"), true)]));
      await ended;
      await settle(c);
      expect({ frames: framesOf(c, 1), received }).toEqual({ frames: ["HEADERS", "DATA+END_STREAM"], received: 1500 });
    });
  });
});
