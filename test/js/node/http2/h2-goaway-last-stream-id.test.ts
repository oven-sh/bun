/**
 * The Last-Stream-ID that a node:http2 session puts in a GOAWAY frame (RFC 9113 §6.8).
 *
 * The id names the highest stream that the receiver of the GOAWAY opened and that the sender
 * processed: a request id in the GOAWAY of a server, a promised id in the GOAWAY of a client, 0
 * when there is none. nghttp2 fails the connection with PROTOCOL_ERROR when a GOAWAY names a
 * stream that its sender opened, and when the id is above the id of an earlier GOAWAY.
 *
 * A raw byte-level HTTP/2 peer drives each session. Every expected id is the id that node
 * v26.3.0 puts on the wire in the same situation. Where the two runtimes write a different set
 * of GOAWAY frames (bun charges a malformed block to maxSessionRejectedStreams, node does not),
 * the test asserts the id of every GOAWAY and not the number of frames or the error code.
 *
 * The second block has the requests that cross a server's GOAWAY: the ones that the GOAWAY
 * keeps from opening.
 *
 * These cases are not in h2-conformance.test.ts, because that file also holds cases that fail
 * now and then on a debug build (the stream-reset floods, and the cases that count live stream
 * objects after a GC).
 *
 * Works with both:
 *   bun bd test test/js/node/http2/h2-goaway-last-stream-id.test.ts
 *   node --test test/js/node/http2/h2-goaway-last-stream-id.test.ts
 */
import assert from "node:assert";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { Duplex, duplexPair } from "node:stream";
import { describe, test } from "node:test";

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
  socket: Duplex;
  private buf: Buffer = Buffer.alloc(0);
  frames: Frame[] = [];
  closed = false;
  private waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];

  constructor(target: number | Duplex) {
    this.socket = typeof target === "number" ? net.connect(target, "127.0.0.1") : target;
    // A net.Socket ends its side when the peer does (allowHalfOpen is false). A Duplex does not.
    if (typeof target !== "number") target.on("end", () => target.end());
    this.socket.on("data", (d: Buffer) => this.onData(d));
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

/** GOAWAY payload: 4-octet last-stream-id, 4-octet error code, debug data. */
function goawayFields(f: Frame) {
  return { lastStreamId: f.payload.readUInt32BE(0) & 0x7fffffff, errorCode: f.payload.readUInt32BE(4) };
}

/** The last-stream-id of every GOAWAY in `frames`, in arrival order. */
function goawayLastStreamIds(frames: Frame[]): number[] {
  return frames.filter(f => f.type === FrameType.GOAWAY).map(f => f.payload.readUInt32BE(0) & 0x7fffffff);
}

/** A minimal raw HTTP/2 server: accept one connection, collect parsed inbound frames. */
class RawH2Server {
  server: net.Server;
  socket: net.Socket | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private sawPreface = false;
  frames: Frame[] = [];
  closed = false;
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
      socket.on("close", () => (s.closed = true));
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

  /** Wait until the connection is closed by the peer. */
  waitClosed(timeoutMs = 10_000): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("connection did not close")), timeoutMs);
      this.socket!.once("close", () => {
        clearTimeout(t);
        resolve();
      });
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

function requestHeaderBlock(method: "GET" | "POST", extra: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([
    Buffer.from([method === "POST" ? 0x83 : 0x82, 0x86, 0x84, 0x01]),
    hpackLiteral("localhost"),
    extra,
  ]);
}

describe("GOAWAY last-stream-id (RFC 9113 §6.8)", () => {
  const STATUS_200 = Buffer.from([0x88]); // HPACK static index 8
  const BAD_PING = Buffer.alloc(6); // a PING must be 8 octets: connection FRAME_SIZE_ERROR

  /** http2.connect() against `raw` with `count` requests in flight; resolves once the server
   *  has seen every request HEADERS and completed the SETTINGS exchange. */
  async function connectClient(
    raw: RawH2Server,
    count: number,
    // The types list these two session options for a server only, or not at all.
    options: http2.ClientSessionOptions & { maxSessionRejectedStreams?: number; maxOutstandingSettings?: number } = {},
  ) {
    const client = http2.connect(`http://127.0.0.1:${raw.port}`, options);
    client.on("error", () => {});
    client.on("stream", pushed => pushed.on("error", () => {}));
    const requests: http2.ClientHttp2Stream[] = [];
    for (let i = 0; i < count; i++) {
      const req = client.request({ ":path": `/${i}` });
      req.on("error", () => {});
      requests.push(req);
    }
    for (const req of requests) {
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === req.id);
    }
    raw.sendFrame(FrameType.SETTINGS, 0, 0);
    raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
    return { client, requests };
  }

  function pushPromise(promisedId: number): Buffer {
    const promised = Buffer.alloc(4);
    promised.writeUInt32BE(promisedId, 0);
    return Buffer.concat([promised, requestHeaderBlock("GET")]);
  }

  /** `once(emitter, event)` that rejects when `emitter` closes before the event. */
  async function onceOpen(emitter: http2.Http2Session | http2.Http2Stream, event: string): Promise<any[]> {
    const ac = new AbortController();
    try {
      return await Promise.race([
        once(emitter, event, { signal: ac.signal }),
        once(emitter, "close", { signal: ac.signal }).then(() => {
          throw new Error(`closed before '${event}'`);
        }),
      ]);
    } finally {
      ac.abort();
    }
  }

  // nghttp2 sets last_proc_stream_id before the callback in which node refuses a stream for
  // maxSessionMemory. So the refused stream counts, and a later GOAWAY names it.
  test("a graceful GOAWAY names a stream that was refused for maxSessionMemory", async () => {
    const seen: number[] = [];
    const server = http2.createServer({ maxSessionMemory: 1 });
    server.on("session", s => s.on("error", () => {}));
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      seen.push(stream.id!);
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      // 4 MiB against the default 64 KiB window: most of it stays queued, over the budget.
      stream.end(Buffer.alloc(1 << 22, "a"));
    });
    server.listen(0);
    await once(server, "listening");
    const sessionEvent = once(server, "session");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      const [session] = (await sessionEvent) as [http2.ServerHttp2Session];
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 1);
      c.sendFrame(FrameType.HEADERS, 0x5, 3, requestHeaderBlock("GET"));
      const rst = await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 3);
      assert.strictEqual(rst.payload.readUInt32BE(0), ErrorCode.ENHANCE_YOUR_CALM);
      assert.deepStrictEqual(seen, [1]);
      assert.strictEqual(session.state.lastProcStreamID, 3);
      session.close();
      const goaway = await c.waitForGoaway();
      assert.deepStrictEqual(goawayFields(goaway), { lastStreamId: 3, errorCode: ErrorCode.NO_ERROR });
    } finally {
      c.destroy();
      server.close();
    }
  });

  test("a client's connection-error GOAWAY does not name its own request stream", async () => {
    const raw = await RawH2Server.listen();
    try {
      const { client, requests } = await connectClient(raw, 1);
      const [req] = requests;
      assert.strictEqual(req.id, 1);
      raw.sendFrame(FrameType.HEADERS, 0x5 /* END_STREAM | END_HEADERS */, 1, STATUS_200);
      await onceOpen(req, "response");
      assert.strictEqual(client.state.lastProcStreamID, 0);
      raw.sendFrame(FrameType.PING, 0, 0, BAD_PING);
      const goaway = await raw.waitFor(f => f.type === FrameType.GOAWAY);
      assert.deepStrictEqual(goawayFields(goaway), { lastStreamId: 0, errorCode: ErrorCode.FRAME_SIZE_ERROR });
      client.destroy();
    } finally {
      raw.close();
    }
  });

  test("a client's connection-error GOAWAY names the last pushed stream, not its own higher request", async () => {
    const raw = await RawH2Server.listen();
    try {
      const { client, requests } = await connectClient(raw, 2);
      assert.deepStrictEqual(
        requests.map(r => r.id),
        [1, 3],
      );
      // Both responses arrive first, so the client's own stream 3 is already the highest id it
      // has seen when the (numerically lower) promise of stream 2 comes in on the still-open
      // stream 1. The promise must still become the mark.
      raw.sendFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 1, STATUS_200);
      raw.sendFrame(FrameType.HEADERS, 0x5 /* END_STREAM | END_HEADERS */, 3, STATUS_200);
      await Promise.all(requests.map(req => onceOpen(req, "response")));
      assert.strictEqual(client.state.lastProcStreamID, 0);
      const pushed = onceOpen(client, "stream");
      raw.sendFrame(FrameType.PUSH_PROMISE, 0x4, 1, pushPromise(2));
      assert.strictEqual((await pushed)[0].id, 2);
      assert.strictEqual(client.state.lastProcStreamID, 2);
      raw.sendFrame(FrameType.PING, 0, 0, BAD_PING);
      const goaway = await raw.waitFor(f => f.type === FrameType.GOAWAY);
      assert.deepStrictEqual(goawayFields(goaway), { lastStreamId: 2, errorCode: ErrorCode.FRAME_SIZE_ERROR });
      client.destroy();
    } finally {
      raw.close();
    }
  });

  test("a client's close() after a push names the pushed stream", async () => {
    const raw = await RawH2Server.listen();
    try {
      const { client, requests } = await connectClient(raw, 1);
      const pushed = onceOpen(client, "stream");
      const response = onceOpen(requests[0], "response");
      raw.sendFrame(FrameType.PUSH_PROMISE, 0x4, 1, pushPromise(2));
      raw.sendFrame(FrameType.HEADERS, 0x5, 2, STATUS_200);
      raw.sendFrame(FrameType.HEADERS, 0x5, 1, STATUS_200);
      const [pushedStream] = await pushed;
      assert.strictEqual(pushedStream.id, 2);
      await response;
      client.close();
      const goaway = await raw.waitFor(f => f.type === FrameType.GOAWAY);
      assert.deepStrictEqual(goawayFields(goaway), { lastStreamId: 2, errorCode: ErrorCode.NO_ERROR });
    } finally {
      raw.close();
    }
  });

  test("no GOAWAY a client sends after a refused response names its own request", async () => {
    const raw = await RawH2Server.listen();
    try {
      const { client } = await connectClient(raw, 1, { maxSessionRejectedStreams: 1 });
      // A response block with a repeated :status is malformed (§8.3), so the client resets the
      // stream. On bun that also uses up the rejection budget of 1 and the session writes an
      // ENHANCE_YOUR_CALM GOAWAY of its own. node only resets the stream. The test asserts every
      // GOAWAY that reaches the wire: the client received no push, so each one names 0.
      raw.sendFrame(FrameType.HEADERS, 0x5, 1, Buffer.concat([STATUS_200, STATUS_200, STATUS_200]));
      await raw.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 1);
      client.close();
      await raw.waitClosed();
      const lastStreamIds = goawayLastStreamIds(raw.frames);
      assert.ok(lastStreamIds.length > 0);
      assert.deepStrictEqual(
        lastStreamIds.filter(id => id !== 0),
        [],
      );
      client.destroy();
    } finally {
      raw.close();
    }
  });

  test("a client's GOAWAY after an unencodable trailer block does not name its own request", async () => {
    const raw = await RawH2Server.listen();
    try {
      const client = http2.connect(`http://127.0.0.1:${raw.port}`);
      client.on("error", () => {});
      const req = client.request({ ":method": "POST", ":path": "/" }, { waitForTrailers: true });
      req.on("error", () => {});
      const frameError = onceOpen(req, "frameError");
      req.on("wantTrailers", () => {
        // A single field above the HPACK encoder's 64 KiB limit cannot be put on the wire; the
        // stream is reset and the session shuts down with a graceful GOAWAY (node also ends up
        // writing GOAWAY(NO_ERROR, 0) here).
        req.sendTrailers({ "x-big": Buffer.alloc(64 * 1024 + 1, 0x58).toString() });
      });
      req.end();
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
      const [type, code] = await frameError;
      assert.deepStrictEqual([type, code], [FrameType.HEADERS, ErrorCode.FRAME_SIZE_ERROR]);
      const goaway = await raw.waitFor(f => f.type === FrameType.GOAWAY);
      assert.deepStrictEqual(goawayFields(goaway), { lastStreamId: 0, errorCode: ErrorCode.NO_ERROR });
    } finally {
      raw.close();
    }
  });

  test("no GOAWAY a client sends after too many pending SETTINGS names its own request", async () => {
    const raw = await RawH2Server.listen();
    try {
      const { client, requests } = await connectClient(raw, 1, { maxOutstandingSettings: 0 });
      raw.sendFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 1, STATUS_200);
      await onceOpen(requests[0], "response");
      // The first SETTINGS frame gets no ACK, so the second one is over the limit and the session
      // ends with ERR_HTTP2_MAX_PENDING_SETTINGS_ACK. node writes one GOAWAY, bun writes two.
      client.settings({ initialWindowSize: 70000 });
      client.settings({ initialWindowSize: 80000 });
      await raw.waitClosed();
      const lastStreamIds = goawayLastStreamIds(raw.frames);
      assert.ok(lastStreamIds.length > 0);
      assert.deepStrictEqual(
        lastStreamIds.filter(id => id !== 0),
        [],
      );
    } finally {
      raw.close();
    }
  });

  test("a server's connection-error GOAWAY names the last request stream", async () => {
    const server = http2.createServer();
    server.on("session", s => s.on("error", () => {}));
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      c.sendFrame(FrameType.HEADERS, 0x5, 3, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 3);
      c.sendFrame(FrameType.PING, 0, 0, BAD_PING);
      const goaway = await c.waitForGoaway();
      assert.deepStrictEqual(goawayFields(goaway), { lastStreamId: 3, errorCode: ErrorCode.FRAME_SIZE_ERROR });
    } finally {
      c.destroy();
      server.close();
    }
  });

  // bun serves a new stream whose id is below an earlier one. node ignores it. The id of the
  // GOAWAY stays at 3 in both.
  test("a new request with a lower id does not lower the last-stream-id", async () => {
    const server = http2.createServer();
    server.on("session", s => s.on("error", () => {}));
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.end();
    });
    server.listen(0);
    await once(server, "listening");
    const sessionEvent = once(server, "session");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      const [session] = (await sessionEvent) as [http2.ServerHttp2Session];
      c.sendFrame(FrameType.HEADERS, 0x5, 3, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 3);
      assert.strictEqual(session.state.lastProcStreamID, 3);
      // The PING ACK is behind the server's handling of the request on 1.
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      c.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8, 0x70));
      await c.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) === 1);
      assert.strictEqual(session.state.lastProcStreamID, 3);
      session.close();
      assert.deepStrictEqual(goawayFields(await c.waitForGoaway()), { lastStreamId: 3, errorCode: ErrorCode.NO_ERROR });
    } finally {
      c.destroy();
      server.close();
    }
  });

  test("no GOAWAY a server sends after a rejected request names a stream it pushed", async () => {
    const server = http2.createServer({ maxSessionRejectedStreams: 1 });
    let session!: http2.ServerHttp2Session;
    server.on("session", s => {
      session = s;
      s.on("error", () => {});
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      // Streams 2 and 4 are the server's own. 4 is above the request that the client sends next.
      for (const path of ["/a", "/b"]) {
        stream.pushStream({ ":path": path }, (err, pushed) => {
          if (err) return;
          pushed.on("error", () => {});
          pushed.respond({ ":status": 200 });
          pushed.end();
        });
      }
      stream.respond({ ":status": 200 });
      stream.end();
    });
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.PUSH_PROMISE && (f.payload.readUInt32BE(0) & 0x7fffffff) === 4);
      // A request block without :path is malformed (§8.3.1) and the server resets the stream. On
      // bun that uses up the budget of 1 and the session writes an ENHANCE_YOUR_CALM GOAWAY of its
      // own. node writes its GOAWAY on close().
      const noPath = Buffer.concat([Buffer.from([0x82, 0x86, 0x01]), hpackLiteral("localhost")]);
      c.sendFrame(FrameType.HEADERS, 0x5, 3, noPath);
      const rst = await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 3);
      assert.strictEqual(rst.payload.readUInt32BE(0), ErrorCode.PROTOCOL_ERROR);
      session.close();
      await c.waitClosed();
      // Each GOAWAY names the rejected request on 3, never the even id 4 that the server pushed.
      const lastStreamIds = goawayLastStreamIds(c.frames);
      assert.ok(lastStreamIds.length > 0);
      assert.deepStrictEqual(
        lastStreamIds.filter(id => id !== 3),
        [],
      );
    } finally {
      c.destroy();
      server.close();
    }
  });

  test("no GOAWAY a server sends after it refused a request over maxConcurrentStreams names a stream it pushed", async () => {
    const server = http2.createServer({ settings: { maxConcurrentStreams: 1 }, maxSessionRejectedStreams: 1 });
    let session!: http2.ServerHttp2Session;
    server.on("session", s => {
      session = s;
      s.on("error", () => {});
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      // Streams 2 and 4 are the server's own. 4 is above the request that the client sends next.
      for (const path of ["/a", "/b"]) {
        stream.pushStream({ ":path": path }, (err, pushed) => {
          if (err) return;
          pushed.on("error", () => {});
          pushed.respond({ ":status": 200 });
          pushed.end();
        });
      }
      // The response stays open, so this request holds the one stream that the server allows.
      stream.respond({ ":status": 200 });
      stream.write("a");
    });
    server.listen(0);
    await once(server, "listening");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.PUSH_PROMISE && (f.payload.readUInt32BE(0) & 0x7fffffff) === 4);
      await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 1);
      // The request on 3 is over the limit. On bun the refusal uses up the budget of 1 and the
      // session writes an ENHANCE_YOUR_CALM GOAWAY. node resets the stream and writes its GOAWAY
      // on close().
      c.sendFrame(FrameType.HEADERS, 0x5, 3, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.GOAWAY || (f.type === FrameType.RST_STREAM && f.streamId === 3));
      if (!session.destroyed) {
        session.close();
        const cancel = Buffer.alloc(4);
        cancel.writeUInt32BE(ErrorCode.CANCEL, 0);
        c.sendFrame(FrameType.RST_STREAM, 0, 1, cancel);
      }
      await c.waitClosed();
      // No GOAWAY names an even id: 2 and 4 are streams that the server opened.
      const lastStreamIds = goawayLastStreamIds(c.frames);
      assert.ok(lastStreamIds.length > 0);
      assert.deepStrictEqual(
        lastStreamIds.filter(id => id % 2 === 0),
        [],
      );
    } finally {
      c.destroy();
      server.close();
    }
  });

  // §6.8: "Endpoints MUST NOT increase the value they send in the last stream identifier". After
  // the read that wrote its GOAWAY, a server does not answer a new stream at all, and a stream
  // that it does not open must not raise the id.
  test("a request that arrives after session.goaway() does not raise the last-stream-id", async () => {
    const seen: number[] = [];
    const server = http2.createServer();
    server.on("session", s => s.on("error", () => {}));
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      seen.push(stream.id!);
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      // 4 MiB against the default 64 KiB window: most of it stays queued, so the stream stays open.
      stream.end(Buffer.alloc(1 << 22, "a"));
    });
    server.listen(0);
    await once(server, "listening");
    const sessionEvent = once(server, "session");
    const c = await RawH2.connect((server.address() as net.AddressInfo).port);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      const [session] = (await sessionEvent) as [http2.ServerHttp2Session];
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 1);
      session.goaway();
      const first = await c.waitForGoaway();
      assert.deepStrictEqual(goawayFields(first), { lastStreamId: 1, errorCode: ErrorCode.NO_ERROR });
      // The PING ACK is behind the server's handling of the request on 3.
      c.sendFrame(FrameType.HEADERS, 0x5, 3, requestHeaderBlock("GET"));
      c.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8, 0x70));
      await c.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) === 1);
      assert.deepStrictEqual(
        { seen, lastProcStreamID: session.state.lastProcStreamID },
        { seen: [1], lastProcStreamID: 1 },
      );
      // A connection error makes the server write one more GOAWAY.
      c.sendFrame(FrameType.PING, 0, 0, BAD_PING);
      const second = await c.waitFor(f => f.type === FrameType.GOAWAY && f !== first);
      assert.deepStrictEqual(goawayFields(second), { lastStreamId: 1, errorCode: ErrorCode.FRAME_SIZE_ERROR });
    } finally {
      c.destroy();
      server.close();
    }
  });

  // In the read that writes the GOAWAY, a request that the GOAWAY covers still opens. A server
  // counts such a request when it refuses it for memory, like every request refused for memory.
  test("a stream refused for maxSessionMemory in the read of a goaway() that covers it is named", async () => {
    const seen: number[] = [];
    const server = http2.createServer({ maxSessionMemory: 1 });
    server.on("session", s => {
      s.on("error", () => {});
      s.once("ping", () => s.goaway(http2.constants.NGHTTP2_NO_ERROR, 3));
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      seen.push(stream.id!);
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      // 4 MiB against the default 64 KiB window: most of it stays queued, over the budget.
      stream.end(Buffer.alloc(1 << 22, "a"));
    });
    const sessionEvent = once(server, "session");
    // Over a Duplex pair one write of the client is exactly one read of the server.
    const [clientSide, serverSide] = duplexPair();
    server.emit("connection", serverSide);
    const c = new RawH2(clientSide);
    try {
      c.sendPreface();
      c.sendEmptySettings();
      const [session] = (await sessionEvent) as [http2.ServerHttp2Session];
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 1);
      // The 'ping' listener sends the GOAWAY before the server parses the request on 3.
      c.send(
        Buffer.concat([
          encodeFrame(FrameType.PING, 0, 0, Buffer.alloc(8, 0x70)),
          encodeFrame(FrameType.HEADERS, 0x5, 3, requestHeaderBlock("GET")),
        ]),
      );
      const first = await c.waitForGoaway();
      assert.deepStrictEqual(goawayFields(first), { lastStreamId: 3, errorCode: ErrorCode.NO_ERROR });
      const rst = await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 3);
      assert.deepStrictEqual(
        { code: rst.payload.readUInt32BE(0), seen, lastProcStreamID: session.state.lastProcStreamID },
        { code: ErrorCode.ENHANCE_YOUR_CALM, seen: [1], lastProcStreamID: 3 },
      );
      // close() makes the server write one more GOAWAY.
      session.close();
      const second = await c.waitFor(f => f.type === FrameType.GOAWAY && f !== first);
      assert.deepStrictEqual(goawayFields(second), { lastStreamId: 3, errorCode: ErrorCode.NO_ERROR });
    } finally {
      c.destroy();
      serverSide.destroy();
      server.close();
    }
  });

  test("a stream promised after the client's goaway() does not raise the last-stream-id", async () => {
    const raw = await RawH2Server.listen();
    try {
      const { client } = await connectClient(raw, 1);
      client.goaway();
      const first = await raw.waitFor(f => f.type === FrameType.GOAWAY);
      assert.deepStrictEqual(goawayFields(first), { lastStreamId: 0, errorCode: ErrorCode.NO_ERROR });
      // The PING ACK is behind the client's handling of the PUSH_PROMISE.
      raw.sendFrame(FrameType.PUSH_PROMISE, 0x4, 1, pushPromise(2));
      raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8, 0x70));
      await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) === 1);
      assert.strictEqual(client.state.lastProcStreamID, 0);
      // A connection error makes the client write one more GOAWAY.
      raw.sendFrame(FrameType.PING, 0, 0, BAD_PING);
      const second = await raw.waitFor(f => f.type === FrameType.GOAWAY && f !== first);
      assert.deepStrictEqual(goawayFields(second), { lastStreamId: 0, errorCode: ErrorCode.FRAME_SIZE_ERROR });
      client.destroy();
    } finally {
      raw.close();
    }
  });

  describe("session.goaway(code, lastStreamID)", () => {
    /** A server with requests open on streams 1 and 3. */
    async function serverWithTwoRequests() {
      const server = http2.createServer();
      server.on("session", s => s.on("error", () => {}));
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        stream.respond({ ":status": 200 });
        stream.write("a");
      });
      server.listen(0);
      await once(server, "listening");
      const sessionEvent = once(server, "session");
      const c = await RawH2.connect((server.address() as net.AddressInfo).port);
      try {
        c.sendPreface();
        c.sendEmptySettings();
        const [session] = (await sessionEvent) as [http2.ServerHttp2Session];
        c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
        c.sendFrame(FrameType.HEADERS, 0x5, 3, requestHeaderBlock("GET"));
        await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 3);
        assert.strictEqual(session.state.lastProcStreamID, 3);
        return { server, session, c };
      } catch (e) {
        c.destroy();
        server.close();
        throw e;
      }
    }

    /** A client with a request open on stream 1, after the server promised streams 2 and 4. */
    async function clientWithTwoPushes(raw: RawH2Server) {
      const { client } = await connectClient(raw, 1);
      raw.sendFrame(FrameType.PUSH_PROMISE, 0x4, 1, pushPromise(2));
      raw.sendFrame(FrameType.PUSH_PROMISE, 0x4, 1, pushPromise(4));
      // The PING ACK is behind the client's handling of both promises.
      raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8, 0x70));
      await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) === 1);
      assert.strictEqual(client.state.lastProcStreamID, 4);
      return client;
    }

    // nghttp2 keeps the id of the last GOAWAY it sent and lowers the id of each later GOAWAY to
    // it. node also closes the streams above that id (REFUSED_STREAM). bun leaves them open.
    test("each later GOAWAY of a server keeps the lowest id that it sent", async () => {
      const { server, session, c } = await serverWithTwoRequests();
      try {
        session.goaway(ErrorCode.NO_ERROR, 1);
        const first = await c.waitForGoaway();
        assert.deepStrictEqual(goawayFields(first), { lastStreamId: 1, errorCode: ErrorCode.NO_ERROR });
        // The second GOAWAY asks for 3 and gets 1. The third one must still carry 1.
        session.goaway(ErrorCode.NO_ERROR, 3);
        const second = await c.waitFor(f => f.type === FrameType.GOAWAY && f !== first);
        assert.deepStrictEqual(goawayFields(second), { lastStreamId: 1, errorCode: ErrorCode.NO_ERROR });
        session.destroy();
        await c.waitClosed();
        const lastStreamIds = goawayLastStreamIds(c.frames);
        assert.ok(lastStreamIds.length > 2);
        assert.deepStrictEqual(
          lastStreamIds.filter(id => id !== 1),
          [],
        );
      } finally {
        c.destroy();
        server.close();
      }
    });

    test("a server's connection-error GOAWAY does not name a stream above an earlier id", async () => {
      const { server, session, c } = await serverWithTwoRequests();
      try {
        session.goaway(ErrorCode.NO_ERROR, 1);
        const first = await c.waitForGoaway();
        assert.deepStrictEqual(goawayFields(first), { lastStreamId: 1, errorCode: ErrorCode.NO_ERROR });
        c.sendFrame(FrameType.PING, 0, 0, BAD_PING);
        const second = await c.waitFor(f => f.type === FrameType.GOAWAY && f !== first);
        assert.deepStrictEqual(goawayFields(second), { lastStreamId: 1, errorCode: ErrorCode.FRAME_SIZE_ERROR });
      } finally {
        session.destroy();
        c.destroy();
        server.close();
      }
    });

    test("each later GOAWAY of a client keeps the lowest id that it sent", async () => {
      const raw = await RawH2Server.listen();
      try {
        const client = await clientWithTwoPushes(raw);
        client.goaway(ErrorCode.NO_ERROR, 2);
        const first = await raw.waitFor(f => f.type === FrameType.GOAWAY);
        assert.deepStrictEqual(goawayFields(first), { lastStreamId: 2, errorCode: ErrorCode.NO_ERROR });
        client.close();
        const second = await raw.waitFor(f => f.type === FrameType.GOAWAY && f !== first);
        assert.deepStrictEqual(goawayFields(second), { lastStreamId: 2, errorCode: ErrorCode.NO_ERROR });
        client.destroy(new Error("boom"));
        await raw.waitClosed();
        const lastStreamIds = goawayLastStreamIds(raw.frames);
        assert.ok(lastStreamIds.length > 2);
        assert.deepStrictEqual(
          lastStreamIds.filter(id => id !== 2),
          [],
        );
      } finally {
        raw.close();
      }
    });

    // nghttp2_submit_goaway refuses an id that only the sender can open, and node ignores that
    // error: the call sends nothing.
    test("a server sends no GOAWAY for an id that only it can open", async () => {
      const { server, session, c } = await serverWithTwoRequests();
      try {
        session.goaway(ErrorCode.NO_ERROR, 2);
        // The PING ACK is behind the GOAWAY, if there is one.
        c.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8, 0x70));
        await c.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) === 1);
        assert.deepStrictEqual(goawayLastStreamIds(c.frames), []);
        session.destroy();
        await c.waitClosed();
        const lastStreamIds = goawayLastStreamIds(c.frames);
        assert.ok(lastStreamIds.length > 0);
        assert.deepStrictEqual(
          lastStreamIds.filter(id => id !== 3),
          [],
        );
      } finally {
        c.destroy();
        server.close();
      }
    });

    test("a client sends no GOAWAY for an id that only it can open", async () => {
      const raw = await RawH2Server.listen();
      try {
        const client = await clientWithTwoPushes(raw);
        // 1 is the client's own request.
        client.goaway(ErrorCode.NO_ERROR, 1);
        raw.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8, 0x71));
        await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) === 1 && f.payload[0] === 0x71);
        assert.deepStrictEqual(goawayLastStreamIds(raw.frames), []);
        client.close();
        const goaway = await raw.waitFor(f => f.type === FrameType.GOAWAY);
        assert.deepStrictEqual(goawayFields(goaway), { lastStreamId: 4, errorCode: ErrorCode.NO_ERROR });
        client.destroy();
      } finally {
        raw.close();
      }
    });

    // node reads lastStreamID with ToInt32. 2 ** 32 + 2 is the id 2. 2 ** 31 is negative, which
    // means the last processed stream.
    test("a server reads lastStreamID as an int32", async () => {
      const { server, session, c } = await serverWithTwoRequests();
      try {
        session.goaway(ErrorCode.NO_ERROR, 2 ** 32 + 2);
        // The PING ACK is behind the GOAWAY, if there is one.
        c.sendFrame(FrameType.PING, 0, 0, Buffer.alloc(8, 0x70));
        await c.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) === 1);
        assert.deepStrictEqual(goawayLastStreamIds(c.frames), []);
        session.goaway(ErrorCode.NO_ERROR, 2 ** 31);
        assert.deepStrictEqual(goawayFields(await c.waitForGoaway()), {
          lastStreamId: 3,
          errorCode: ErrorCode.NO_ERROR,
        });
      } finally {
        session.destroy();
        c.destroy();
        server.close();
      }
    });

    test("a client reads lastStreamID as an int32", async () => {
      const raw = await RawH2Server.listen();
      try {
        const client = await clientWithTwoPushes(raw);
        client.goaway(ErrorCode.NO_ERROR, 2 ** 31);
        const goaway = await raw.waitFor(f => f.type === FrameType.GOAWAY);
        assert.deepStrictEqual(goawayFields(goaway), { lastStreamId: 4, errorCode: ErrorCode.NO_ERROR });
        client.destroy();
      } finally {
        raw.close();
      }
    });
  });
});

// A request can cross the server's GOAWAY on the wire. After the read that wrote the GOAWAY, the
// server opens no request. In that read it opens a request only when the id is new and the GOAWAY
// covers it. An ignored header block still goes through HPACK, its DATA still counts toward the
// connection window, and no frame answers it. node v26.3.0 puts the same frames on the wire in
// every case below. Where node emits a 'stream' event that bun does not (node opens a request in
// the read of the GOAWAY and the GOAWAY then closes it), the case asserts frames only.
describe("requests that cross the server's GOAWAY (RFC 9113 §6.8)", () => {
  /** Like duplexPair, but the client side has no write queue: what the client writes from inside
   *  its own 'data' callback reaches the server side at once, inside the server's current read.
   *  `nested.count` is the number of such writes. */
  const nested = { count: 0 };
  function reentrantPair(): [Duplex, Duplex] {
    let depth = 0;
    const serverSide: Duplex = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        clientSide.push(chunk);
        callback();
      },
      final(callback) {
        clientSide.push(null);
        callback();
      },
    });
    const clientSide: Duplex = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        callback(); // first: a write from inside the push below must not wait for this one
        if (depth > 0) nested.count++;
        depth++;
        try {
          serverSide.push(chunk);
        } finally {
          depth--;
        }
      },
      final(callback) {
        serverSide.push(null);
        callback();
      },
    });
    return [clientSide, serverSide];
  }

  /** A server that calls `shutdown(session)` from its first 'stream' event and answers a request
   *  once its body ends. Streams that reach JS are recorded in `seen`. Over "duplexPair" each
   *  write of the client is exactly one read of the server. */
  async function shuttingDownSession(
    shutdown: (session: http2.ServerHttp2Session) => void,
    transport: "tcp" | "duplexPair" | "reentrant" = "tcp",
  ) {
    const seen: number[] = [];
    let session!: http2.ServerHttp2Session;
    const firstRequest = Promise.withResolvers<void>();
    const sessionClosed = Promise.withResolvers<void>();
    /** Wait for the session's 'close' event. */
    const waitSessionClosed = (timeoutMs = 2000) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("session did not close")), timeoutMs);
        sessionClosed.promise.then(() => {
          clearTimeout(t);
          resolve();
        });
      });
    const server = http2.createServer();
    server.on("session", s => {
      session = s;
      s.on("error", () => {});
      s.on("close", () => sessionClosed.resolve());
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      seen.push(stream.id!);
      stream.on("error", () => {});
      stream.on("end", () => {
        // A failed test destroys the connection, which also ends the request.
        if (stream.destroyed) return;
        stream.respond({ ":status": 200 });
        stream.end("ok");
      });
      stream.resume();
      if (seen.length === 1) {
        shutdown(session);
        firstRequest.resolve();
      }
    });
    let c: RawH2;
    let serverSide: Duplex | undefined;
    if (transport === "tcp") {
      server.listen(0);
      await once(server, "listening");
      c = await RawH2.connect((server.address() as net.AddressInfo).port);
    } else {
      const pair = transport === "reentrant" ? reentrantPair() : duplexPair();
      serverSide = pair[1];
      server.emit("connection", serverSide);
      c = new RawH2(pair[0]);
    }
    /** A destroyed Duplex does not tell its peer, so the server's side is destroyed here too. */
    const stop = () => {
      c.destroy();
      serverSide?.destroy();
      server.close();
    };
    c.sendPreface();
    c.sendEmptySettings();
    // A closed session waits 250ms for a SETTINGS ACK that is still due before it destroys itself.
    await c.waitFor(f => f.type === FrameType.SETTINGS && (f.flags & 0x1) === 0);
    c.sendSettingsAck();
    return { c, seen, session: () => session, firstRequest: firstRequest.promise, waitSessionClosed, stop };
  }

  const NO_ERROR = http2.constants.NGHTTP2_NO_ERROR;
  const MAX_ID = 2 ** 31 - 1;
  const isErrorGoaway = (f: Frame) => f.type === FrameType.GOAWAY && goawayFields(f).errorCode !== ErrorCode.NO_ERROR;
  const endsStream = (id: number) => (f: Frame) =>
    f.streamId === id && (f.type === FrameType.DATA || f.type === FrameType.HEADERS) && (f.flags & 0x1) === 1;
  const framesOn = (c: RawH2, ...ids: number[]) => c.frames.filter(f => ids.includes(f.streamId));
  const get = (id: number) => encodeFrame(FrameType.HEADERS, 0x5, id, requestHeaderBlock("GET"));
  const ping = (fill: number) => encodeFrame(FrameType.PING, 0, 0, Buffer.alloc(8, fill));

  /** Expects the response to request `id`: a frame with END_STREAM, and no error GOAWAY first. */
  async function expectAnswered(c: RawH2, id: number) {
    const frame = await c.waitFor(f => isErrorGoaway(f) || endsStream(id)(f));
    assert.strictEqual(frame.type, FrameType.DATA);
  }

  /** Ends request `id`, then expects its response, the end of the connection and the session
   *  'close', while this client keeps its side of the connection open until the server ends it. */
  async function expectGracefulCloseCompletes(c: RawH2, waitSessionClosed: () => Promise<void>, id = 1) {
    c.sendFrame(FrameType.DATA, 0x1, id, Buffer.from("body"));
    await expectAnswered(c, id);
    await c.waitClosed();
    await waitSessionClosed();
  }

  /** PING as a barrier: its ACK means that the server processed every frame sent before it. */
  let barriers = 0;
  async function pingBarrier(c: RawH2) {
    const opaque = Buffer.alloc(8, 0xba);
    opaque.writeUInt32BE(++barriers, 4);
    c.sendFrame(FrameType.PING, 0, 0, opaque);
    const frame = await c.waitFor(
      f => isErrorGoaway(f) || (f.type === FrameType.PING && (f.flags & 0x1) === 1 && f.payload.equals(opaque)),
    );
    assert.strictEqual(frame.type, FrameType.PING);
  }

  test("ignores a request that arrives after the GOAWAY of close()", async () => {
    const { c, seen, waitSessionClosed, stop } = await shuttingDownSession(session => session.close());
    try {
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
      assert.deepStrictEqual(goawayFields(await c.waitForGoaway()), { lastStreamId: 1, errorCode: ErrorCode.NO_ERROR });
      c.send(get(3));

      await expectGracefulCloseCompletes(c, waitSessionClosed);
      assert.deepStrictEqual({ seen, on3: framesOn(c, 3) }, { seen: [1], on3: [] });
    } finally {
      stop();
    }
  });

  // The result is the same for one read and for two, so this case needs no control of the reads.
  test("ignores a request in the same write as the request whose handler calls close()", async () => {
    const { c, seen, waitSessionClosed, stop } = await shuttingDownSession(session => session.close());
    try {
      c.send(Buffer.concat([encodeFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST")), get(3)]));
      assert.deepStrictEqual(goawayFields(await c.waitForGoaway()), { lastStreamId: 1, errorCode: ErrorCode.NO_ERROR });

      await expectGracefulCloseCompletes(c, waitSessionClosed);
      assert.deepStrictEqual({ seen, on3: framesOn(c, 3) }, { seen: [1], on3: [] });
    } finally {
      stop();
    }
  });

  // A 'ping' listener runs inside the read, so the GOAWAY is written before the server parses the
  // frames behind the PING. A build that opens request 3 here answers it with RST_STREAM.
  for (const [name, shutdown, closes] of [
    ["close()", (s: http2.ServerHttp2Session) => s.close(), true],
    ["goaway()", (s: http2.ServerHttp2Session) => s.goaway(), false],
    [
      "close() and then goaway() with last-stream-id 2^31-1",
      (s: http2.ServerHttp2Session) => (s.close(), s.goaway(NO_ERROR, MAX_ID)),
      true,
    ],
    [
      "goaway() with last-stream-id 2^31-1 and then close()",
      (s: http2.ServerHttp2Session) => (s.goaway(NO_ERROR, MAX_ID), s.close()),
      true,
    ],
    [
      "goaway() and then goaway() with last-stream-id 2^31-1",
      (s: http2.ServerHttp2Session) => (s.goaway(), s.goaway(NO_ERROR, MAX_ID)),
      false,
    ],
    [
      "goaway() with last-stream-id 2^31-1 and then goaway()",
      (s: http2.ServerHttp2Session) => (s.goaway(NO_ERROR, MAX_ID), s.goaway()),
      false,
    ],
  ] as const) {
    test(`ignores a request in the same read as the PING whose listener calls ${name}`, async () => {
      const { c, firstRequest, waitSessionClosed, stop } = await shuttingDownSession(
        session => session.once("ping", () => shutdown(session)),
        "duplexPair",
      );
      try {
        c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
        await firstRequest;
        c.send(Buffer.concat([ping(0x41), get(3)]));
        await c.waitForGoaway();
        if (closes) {
          await expectGracefulCloseCompletes(c, waitSessionClosed);
        } else {
          await pingBarrier(c);
          c.sendFrame(FrameType.DATA, 0x1, 1, Buffer.from("body"));
          await expectAnswered(c, 1);
        }
        assert.deepStrictEqual(framesOn(c, 3), []);
      } finally {
        stop();
      }
    });
  }

  test("serves a request in the same read as the PING whose listener calls goaway() with last-stream-id 2^31-1", async () => {
    const { c, seen, firstRequest, stop } = await shuttingDownSession(
      session => session.once("ping", () => session.goaway(NO_ERROR, MAX_ID)),
      "duplexPair",
    );
    try {
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
      await firstRequest;
      c.send(Buffer.concat([ping(0x41), get(3)]));
      assert.deepStrictEqual(goawayFields(await c.waitForGoaway()), {
        lastStreamId: MAX_ID,
        errorCode: ErrorCode.NO_ERROR,
      });
      await expectAnswered(c, 3);

      // The GOAWAY is on the wire now, so a request in a later read is ignored.
      c.send(get(5));
      await pingBarrier(c);
      assert.deepStrictEqual({ seen, on5: framesOn(c, 5) }, { seen: [1, 3], on5: [] });
    } finally {
      stop();
    }
  });

  test("in the read of a goaway() with last-stream-id 3, serves request 3 and ignores request 5", async () => {
    const { c, firstRequest, stop } = await shuttingDownSession(
      session => session.once("ping", () => session.goaway(NO_ERROR, 3)),
      "duplexPair",
    );
    try {
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
      await firstRequest;
      c.send(Buffer.concat([ping(0x41), get(3), get(5)]));
      assert.deepStrictEqual(goawayFields(await c.waitForGoaway()), { lastStreamId: 3, errorCode: ErrorCode.NO_ERROR });
      await expectAnswered(c, 3);
      await pingBarrier(c);
      assert.deepStrictEqual(framesOn(c, 5), []);
    } finally {
      stop();
    }
  });

  // Request 3 arrives behind request 5, so its id is not new.
  test("in the read of a goaway() with last-stream-id 3, ignores request 3 behind request 5", async () => {
    const { c, firstRequest, stop } = await shuttingDownSession(
      session => session.once("ping", () => session.goaway(NO_ERROR, 3)),
      "duplexPair",
    );
    try {
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
      await firstRequest;
      c.send(Buffer.concat([ping(0x41), get(5), get(3)]));
      assert.deepStrictEqual(goawayFields(await c.waitForGoaway()), { lastStreamId: 3, errorCode: ErrorCode.NO_ERROR });
      await pingBarrier(c);
      assert.deepStrictEqual(framesOn(c, 3, 5), []);
    } finally {
      stop();
    }
  });

  // The client's GOAWAY(NO_ERROR) makes the server call close() inside the read that carries it.
  test("ignores requests on unused lower ids in the read of the client's GOAWAY", async () => {
    const { c, seen, firstRequest, waitSessionClosed, stop } = await shuttingDownSession(() => {}, "duplexPair");
    try {
      c.sendFrame(FrameType.HEADERS, 0x4, 7, requestHeaderBlock("POST"));
      await firstRequest;
      c.send(Buffer.concat([encodeFrame(FrameType.GOAWAY, 0, 0, Buffer.alloc(8)), get(1), get(3), get(5)]));
      assert.deepStrictEqual(goawayFields(await c.waitForGoaway()), { lastStreamId: 7, errorCode: ErrorCode.NO_ERROR });

      await expectGracefulCloseCompletes(c, waitSessionClosed, 7);
      assert.deepStrictEqual({ seen, lower: framesOn(c, 1, 3, 5) }, { seen: [7], lower: [] });
    } finally {
      stop();
    }
  });

  // settings() makes bun write the GOAWAY inside the listener. The client answers it from inside
  // that write, so request 3 reaches the server while it is still in the read of the PING.
  test("ignores a request that re-enters the read in which goaway() with last-stream-id 2^31-1 was written", async () => {
    nested.count = 0;
    const { c, seen, firstRequest, stop } = await shuttingDownSession(
      session =>
        session.once("ping", () => {
          session.goaway(NO_ERROR, MAX_ID);
          session.settings({});
        }),
      "reentrant",
    );
    try {
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
      await firstRequest;
      assert.strictEqual(nested.count, 0);
      // The predicate runs inside the client's 'data' callback.
      const goaway = c.waitFor(f => {
        if (f.type !== FrameType.GOAWAY) return false;
        c.send(get(3));
        return true;
      });
      c.send(ping(0x41));
      assert.deepStrictEqual(goawayFields(await goaway), { lastStreamId: MAX_ID, errorCode: ErrorCode.NO_ERROR });
      assert.strictEqual(nested.count, 1);
      await pingBarrier(c);
      assert.deepStrictEqual({ seen, on3: framesOn(c, 3) }, { seen: [1], on3: [] });
    } finally {
      stop();
    }
  });

  // goaway() does not close the session. The last-stream-id it names does not matter: 2^31-1 is
  // the first GOAWAY of the two-step shutdown of §6.8, and a request in a later read is ignored.
  for (const [name, shutdown, lastStreamId] of [
    ["its default last-stream-id", (s: http2.ServerHttp2Session) => s.goaway(), 1],
    ["last-stream-id 2^31-1", (s: http2.ServerHttp2Session) => s.goaway(NO_ERROR, MAX_ID), MAX_ID],
  ] as const) {
    test(`ignores a request that arrives after goaway() with ${name}`, async () => {
      const { c, seen, session, stop } = await shuttingDownSession(shutdown);
      try {
        c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
        assert.deepStrictEqual(goawayFields(await c.waitForGoaway()), { lastStreamId, errorCode: ErrorCode.NO_ERROR });
        c.send(get(3));
        await pingBarrier(c);
        assert.deepStrictEqual(
          { seen, on3: framesOn(c, 3), lastProcStreamID: session().state.lastProcStreamID },
          { seen: [1], on3: [], lastProcStreamID: 1 },
        );

        // The session stays open: request 1 still gets its response.
        c.sendFrame(FrameType.DATA, 0x1, 1, Buffer.from("body"));
        await expectAnswered(c, 1);
      } finally {
        stop();
      }
    });
  }

  test("keeps HPACK and the connection window in sync with the frames of an ignored request", async () => {
    const { c, seen, waitSessionClosed, stop } = await shuttingDownSession(session => session.close());
    try {
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
      await c.waitForGoaway();

      // Request 3's block inserts `x-bun-sync: 1` into the HPACK dynamic table from its
      // CONTINUATION half. Its body is more than half of the 65535-byte connection window.
      const insert = Buffer.concat([Buffer.from([0x40]), hpackLiteral("x-bun-sync"), hpackLiteral("1")]);
      const body = encodeFrame(FrameType.DATA, 0, 3, Buffer.alloc(16384, "a"));
      const windowUpdate = Buffer.alloc(4);
      windowUpdate.writeUInt32BE(1000, 0);
      const priority = Buffer.alloc(5);
      priority.writeUInt8(16, 4);
      const cancel = Buffer.alloc(4);
      cancel.writeUInt32BE(ErrorCode.CANCEL, 0);
      c.send(
        Buffer.concat([
          encodeFrame(FrameType.HEADERS, 0, 3, requestHeaderBlock("POST")),
          encodeFrame(FrameType.CONTINUATION, 0x4 /* END_HEADERS */, 3, insert),
          body,
          body,
          body,
        ]),
      );
      const update = await c.waitFor(f => isErrorGoaway(f) || (f.type === FrameType.WINDOW_UPDATE && f.streamId === 0));
      assert.strictEqual(update.type, FrameType.WINDOW_UPDATE);

      // The trailers of request 1 are 0xbe: indexed field 62, the entry that request 3's block
      // inserted. If that block had not been decoded, they are a COMPRESSION_ERROR and request 1
      // gets no response.
      c.send(
        Buffer.concat([
          encodeFrame(FrameType.WINDOW_UPDATE, 0, 3, windowUpdate),
          encodeFrame(FrameType.PRIORITY, 0, 3, priority),
          encodeFrame(FrameType.RST_STREAM, 0, 3, cancel),
          encodeFrame(FrameType.HEADERS, 0x5, 1, Buffer.from([0xbe])),
        ]),
      );
      await expectAnswered(c, 1);
      await c.waitClosed();
      await waitSessionClosed();
      assert.deepStrictEqual({ seen, on3: framesOn(c, 3) }, { seen: [1], on3: [] });
    } finally {
      stop();
    }
  });

  test("ignores a DATA frame of an ignored request that arrives in one read or in two", async () => {
    const { c, seen, stop } = await shuttingDownSession(session => session.close(), "duplexPair");
    try {
      c.sendFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST"));
      await c.waitForGoaway();
      c.sendFrame(FrameType.HEADERS, 0x4, 3, requestHeaderBlock("POST"));
      const data = encodeFrame(FrameType.DATA, 0, 3, Buffer.alloc(1024, "a"));
      c.send(data);
      c.send(data.subarray(0, 512));
      c.send(data.subarray(512));
      await pingBarrier(c);
      assert.deepStrictEqual({ seen, on3: framesOn(c, 3) }, { seen: [1], on3: [] });
    } finally {
      stop();
    }
  });

  // node's onSessionHeaders: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L373-L381
  test("refuses a request whose header block completes after close()", async () => {
    // setImmediate: close() runs after the read that carries both HEADERS frames below.
    const { c, seen, waitSessionClosed, stop } = await shuttingDownSession(
      session => setImmediate(() => session.close()),
      "duplexPair",
    );
    try {
      c.send(
        Buffer.concat([
          encodeFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST")),
          encodeFrame(FrameType.HEADERS, 0x1 /* END_STREAM, no END_HEADERS */, 3, requestHeaderBlock("GET")),
        ]),
      );
      // Last-stream-id 3: the server opened request 3 before close() ran. Only REFUSED_STREAM
      // tells the client that it can send the request again.
      assert.deepStrictEqual(goawayFields(await c.waitForGoaway()), { lastStreamId: 3, errorCode: ErrorCode.NO_ERROR });
      const rest = Buffer.concat([Buffer.from([0x40]), hpackLiteral("x-bun-sync"), hpackLiteral("1")]);
      c.sendFrame(FrameType.CONTINUATION, 0x4 /* END_HEADERS */, 3, rest);
      const rst = await c.waitFor(f => isErrorGoaway(f) || (f.type === FrameType.RST_STREAM && f.streamId === 3));
      assert.deepStrictEqual(
        { type: rst.type, code: rst.payload.readUInt32BE(0) },
        { type: FrameType.RST_STREAM, code: ErrorCode.REFUSED_STREAM },
      );

      await expectGracefulCloseCompletes(c, waitSessionClosed);
      assert.deepStrictEqual({ seen, on3: framesOn(c, 3) }, { seen: [1], on3: [rst] });
    } finally {
      stop();
    }
  });
});
