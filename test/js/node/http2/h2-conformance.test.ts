// HTTP/2 protocol conformance suite (RFC 9113 + extensions).
//
// These tests drive a raw byte-level HTTP/2 client against a Bun `node:http2` h2c server and
// assert spec-mandated behavior at the wire level — the cases Node's own suite under-covers.
// Item numbers reference docs/http2-rewrite/03-spec-conformance-checklist.md.
//
// Connection-level cases only here (no HPACK required): preface, SETTINGS handshake/ack, PING,
// WINDOW_UPDATE, frame-size and stream-id rules. HPACK/HEADERS cases live in a sibling file.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, gcTick, normalizeBunSnapshot, tls as tlsCert } from "harness";
import { EventEmitter, once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { Readable, Writable } from "node:stream";
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

  constructor(port: number, secure = false) {
    this.socket = secure
      ? tls.connect({ port, host: "127.0.0.1", ca: tlsCert.cert, ALPNProtocols: ["h2"] })
      : net.connect(port, "127.0.0.1");
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
      // node refuses an over-budget stream with ENHANCE_YOUR_CALM (Http2Session::OnBeginHeadersCallback);
      // node's own sequential/test-http2-max-session-memory.js asserts this exact code.
      expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.ENHANCE_YOUR_CALM);
      expect(c.frames.find(f => f.type === FrameType.HEADERS && f.streamId === 3)).toBeUndefined();
    } finally {
      c.destroy();
      server.close();
    }
  });

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
// socket has backpressure, or another stream on the session already has frames waiting) is put on
// the session's outbound queue and written later, when a WINDOW_UPDATE or a writable socket drains
// the queue. Writing the last queued frame of a stream whose peer half is already closed completes
// the stream, and, exactly like the direct-write path, has to release it (the JS stream object and
// the native entry) while the session lives on. Node releases these streams too; a stream that is
// only released at session teardown is a per-request leak on a long-lived session. END_STREAM can
// ride on the queued frame that carries the last of the body or on an empty frame queued by itself
// (end() without a body, or the empty frame that follows a body once no trailers are coming); the
// queue writes the two through different branches, so both shapes are covered below.
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
      // request body does: the queued response is then the only thing the stream still waits for.
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
      c.send(Buffer.concat([pairs(500, 1, rstStream), request(1001)]));
      await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1001, 10_000);
      expect(c.frames.find(f => f.type === FrameType.GOAWAY)).toBeUndefined();
      expect(state.handlers).toBe(501);
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
    // It also accepts ids below the held stream's, so the GOAWAY's last stream id is no criterion.
    const { server, state } = respondingServer();
    await withClient(server, async c => {
      c.send(upload(4001));
      await serverGoaway(c);
      c.send(pairs(1200, 1, rstStream));
      const goaway = await c.waitFor(calm, 10_000);
      expect(goaway.payload.subarray(8).toString()).toBe("too many stream resets");
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
