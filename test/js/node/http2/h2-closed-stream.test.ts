// Frames on a closed stream (RFC 9113 §5.1), checked on the wire: a raw client against
// http2.createServer(), and a raw server against http2.connect(). nghttp2 discards these frames
// and sends nothing back. The cases that node passes too are in node-http2-client-close.test.ts.

import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
const FrameType = {
  DATA: 0,
  HEADERS: 1,
  RST_STREAM: 3,
  SETTINGS: 4,
  PUSH_PROMISE: 5,
  PING: 6,
  GOAWAY: 7,
  WINDOW_UPDATE: 8,
};
const ErrorCode = { PROTOCOL_ERROR: 1, CANCEL: 8, COMPRESSION_ERROR: 9, ENHANCE_YOUR_CALM: 11 };

type Frame = { length: number; type: number; flags: number; streamId: number; payload: Buffer };

function encodeFrame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header.writeUInt8(type, 3);
  header.writeUInt8(flags, 4);
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}
const goawayErrorCode = (f: Frame) => f.payload.readUInt32BE(4);
/** A request header block: ":method", ":scheme: http", ":path: /" and ":authority: localhost". */
function requestHeaderBlock(method: "GET" | "POST"): Buffer {
  const authority = Buffer.from("localhost");
  return Buffer.concat([Buffer.from([method === "POST" ? 0x83 : 0x82, 0x86, 0x84, 0x01, authority.length]), authority]);
}

/** One raw HTTP/2 connection in either role. It sends what the test writes and parses what arrives. */
class Raw {
  frames: Frame[] = [];
  socket!: net.Socket;
  #server: net.Server | undefined;
  #buffered = Buffer.alloc(0);
  #prefaceLeft: number;
  #waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];

  private constructor(prefaceLeft: number) {
    this.#prefaceLeft = prefaceLeft;
  }

  /** A raw client that has sent the preface and an empty SETTINGS frame. */
  static async connect(port: number): Promise<Raw> {
    const raw = new Raw(0);
    raw.#attach(net.connect(port, "127.0.0.1"));
    await once(raw.socket, "connect");
    raw.send(PREFACE, encodeFrame(FrameType.SETTINGS, 0, 0));
    return raw;
  }

  /** A raw server for one connection. */
  static async listen(): Promise<Raw> {
    const raw = new Raw(PREFACE.length);
    raw.#server = net.createServer(socket => raw.#attach(socket));
    raw.#server.listen(0, "127.0.0.1");
    await once(raw.#server, "listening");
    return raw;
  }
  get port(): number {
    return (this.#server!.address() as net.AddressInfo).port;
  }

  #attach(socket: net.Socket) {
    this.socket = socket;
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => {
      this.#buffered = Buffer.concat([this.#buffered, chunk]);
      if (this.#prefaceLeft > 0) {
        if (this.#buffered.length < this.#prefaceLeft) return;
        this.#buffered = this.#buffered.subarray(this.#prefaceLeft);
        this.#prefaceLeft = 0;
      }
      while (this.#buffered.length >= 9) {
        const length = this.#buffered.readUIntBE(0, 3);
        if (this.#buffered.length < 9 + length) break;
        const frame: Frame = {
          length,
          type: this.#buffered.readUInt8(3),
          flags: this.#buffered.readUInt8(4),
          streamId: this.#buffered.readUInt32BE(5) & 0x7fffffff,
          payload: this.#buffered.subarray(9, 9 + length),
        };
        this.#buffered = this.#buffered.subarray(9 + length);
        this.frames.push(frame);
        this.#waiters = this.#waiters.filter(w => !(w.pred(frame) && (w.resolve(frame), true)));
      }
    });
  }

  /** One write, so that the peer gets these bytes in one read. */
  send(...bytes: Buffer[]) {
    this.socket.write(Buffer.concat(bytes));
  }
  sendFrame(type: number, flags: number, streamId: number, payload?: Buffer) {
    this.send(encodeFrame(type, flags, streamId, payload));
  }

  /** The first frame that matches, one that arrived before included. */
  async waitFor(pred: (f: Frame) => boolean, timeoutMs = 2000): Promise<Frame> {
    const existing = this.frames.find(pred);
    if (existing) return existing;
    const { promise, resolve, reject } = Promise.withResolvers<Frame>();
    const timer = setTimeout(() => reject(new Error("timed out waiting for frame")), timeoutMs);
    this.#waiters.push({ pred, resolve });
    return promise.finally(() => clearTimeout(timer));
  }

  close() {
    this.socket?.destroy();
    this.#server?.close();
  }
}

let server: http2.Http2Server;
let port: number;

beforeAll(async () => {
  server = http2.createServer();
  server.on("stream", (stream: http2.ServerHttp2Stream) => {
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

describe("frames on a closed stream (RFC 9113 §5.1)", () => {
  const PING = encodeFrame(FrameType.PING, 0, 0, Buffer.alloc(8, 1));
  const isPingAck = (f: Frame) => f.type === FrameType.PING && (f.flags & 0x1) !== 0;
  const isFatal = (f: Frame) => f.type === FrameType.RST_STREAM || f.type === FrameType.GOAWAY;
  const windowUpdate = (id: number, increment: number) => {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(increment, 0);
    return encodeFrame(FrameType.WINDOW_UPDATE, 0, id, payload);
  };
  const ONE_BYTE = encodeFrame(FrameType.DATA, 0, 1, Buffer.from("x"));
  // A zero increment and an overflow are stream errors on a stream that is still open.
  const WINDOW_UPDATES = [windowUpdate(1, 0), windowUpdate(1, 0x7fffffff)];
  // An empty DATA frame with no END_STREAM counts as an invalid frame on a stream that is open.
  const EMPTY = encodeFrame(FrameType.DATA, 0, 1);
  const floods: [string, Buffer][] = [
    ["DATA", Buffer.concat(Array(2000).fill(ONE_BYTE))],
    ["empty DATA", Buffer.concat(Array(2000).fill(EMPTY))],
    ["WINDOW_UPDATE", Buffer.concat(Array.from({ length: 2000 }, (_, i) => WINDOW_UPDATES[i % 2]))],
  ];

  test.each(floods)("server: %s gets no RST_STREAM", async (_, flood) => {
    const c = await Raw.connect(port);
    try {
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 1 && (f.flags & 0x1) !== 0);
      c.send(flood);
      c.sendFrame(FrameType.HEADERS, 0x5, 3, requestHeaderBlock("GET"));
      c.send(PING);
      await c.waitFor(isPingAck);
      expect(c.frames.filter(isFatal)).toEqual([]);
      expect(c.frames.some(f => f.type === FrameType.HEADERS && f.streamId === 3)).toBe(true);
    } finally {
      c.close();
    }
  });

  // Only a closed stream is exempt from maxSessionInvalidFrames (1,000 by default).
  test("server: empty DATA on a stream id that was never opened ends the session", async () => {
    const server = http2.createServer();
    const sessionError = once(server, "sessionError").then(([err]) => err.code as string);
    server.listen(0);
    await once(server, "listening");
    const c = await Raw.connect((server.address() as net.AddressInfo).port);
    try {
      c.send(Buffer.concat([...Array(1100).fill(EMPTY), PING]));
      const pingAck = c.waitFor(isPingAck).then(() => "PING ACK");
      expect(await Promise.race([sessionError, pingAck])).toBe("ERR_HTTP2_TOO_MANY_INVALID_FRAMES");
    } finally {
      c.close();
      server.close();
    }
  });

  test("server: HEADERS behind the client's RST_STREAM in the same read get no RST_STREAM", async () => {
    const seen: number[] = [];
    const server = http2.createServer();
    server.on("stream", stream => {
      seen.push(stream.id!);
      stream.on("error", () => {});
    });
    server.listen(0);
    await once(server, "listening");
    const c = await Raw.connect((server.address() as net.AddressInfo).port);
    try {
      const cancel = Buffer.alloc(4);
      cancel.writeUInt32BE(ErrorCode.CANCEL, 0);
      c.send(
        Buffer.concat([
          encodeFrame(FrameType.HEADERS, 0x4, 1, requestHeaderBlock("POST")),
          encodeFrame(FrameType.RST_STREAM, 0, 1, cancel),
          encodeFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("POST")),
          PING,
        ]),
      );
      await c.waitFor(isPingAck);
      expect({ fatal: c.frames.filter(isFatal), seen }).toEqual({ fatal: [], seen: [1] });
    } finally {
      c.close();
      server.close();
    }
  });

  /** A server whose stream 1 pushes `pushes` streams, and a raw client connected to it. */
  async function pushingServer(pushes: number, onPush: (push: http2.ServerHttp2Stream) => void) {
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      for (let i = 0; stream.id === 1 && i < pushes; i++) {
        stream.pushStream({ ":path": `/push/${i}` }, (err, push) => {
          if (err) return;
          push.on("error", () => {});
          onPush(push);
        });
      }
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    server.listen(0);
    await once(server, "listening");
    const c = await Raw.connect((server.address() as net.AddressInfo).port);
    return { server, c };
  }
  const rstStream = (id: number, code: number) => {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(code, 0);
    return encodeFrame(FrameType.RST_STREAM, 0, id, payload);
  };
  const fatalFrames = (c: Raw) =>
    c.frames
      .filter(isFatal)
      .map(f =>
        f.type === FrameType.GOAWAY
          ? `GOAWAY code=${goawayErrorCode(f)}`
          : `RST_STREAM ${f.streamId} code=${f.payload.readUInt32BE(0)}`,
      );

  test("server: DATA and WINDOW_UPDATE on a push that the server reset get no reply", async () => {
    const { server, c } = await pushingServer(1, push => {
      push.respond({ ":status": 200 });
      push.close(http2.constants.NGHTTP2_CANCEL);
    });
    try {
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 2);
      c.send(Buffer.concat([encodeFrame(FrameType.DATA, 0, 2, Buffer.from("x")), windowUpdate(2, 0), PING]));
      await c.waitFor(isPingAck);
      // The server can write its own RST_STREAM(CANCEL) twice. It answers the late frames with nothing.
      expect(fatalFrames(c).filter(f => f !== "RST_STREAM 2 code=8")).toEqual([]);
    } finally {
      c.close();
      server.close();
    }
  });

  test("server: RST_STREAM on a push that is open closes it with that code", async () => {
    const closed = Promise.withResolvers<number>();
    const { server, c } = await pushingServer(1, push => {
      push.on("close", () => closed.resolve(push.rstCode));
      push.respond({ ":status": 200 });
    });
    try {
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 2);
      c.send(Buffer.concat([rstStream(2, ErrorCode.CANCEL), PING]));
      expect(await closed.promise).toBe(ErrorCode.CANCEL);
      await c.waitFor(isPingAck);
      expect(fatalFrames(c)).toEqual([]);
    } finally {
      c.close();
      server.close();
    }
  });

  // A stream id is idle until its own side opens it. The ids that the other side used do not count.
  test.each([
    ["an even id that the server never pushed", [1, 3], 0, 2],
    ["an odd id above every request and below a pushed id", [1], 3, 3],
  ])("server: RST_STREAM on %s is a PROTOCOL_ERROR", async (_, requests, pushes, id) => {
    const { server, c } = await pushingServer(pushes, push => {
      push.respond({ ":status": 200 });
      push.end("pushed");
    });
    try {
      for (const request of requests) {
        c.sendFrame(FrameType.HEADERS, 0x5, request, requestHeaderBlock("GET"));
        await c.waitFor(f => f.type === FrameType.DATA && f.streamId === request && (f.flags & 0x1) !== 0);
      }
      expect(c.frames.filter(f => f.type === FrameType.PUSH_PROMISE)).toHaveLength(pushes);
      c.send(Buffer.concat([rstStream(id, ErrorCode.CANCEL), PING]));
      const reply = await c.waitFor(f => f.type === FrameType.GOAWAY || isPingAck(f));
      expect(reply.type === FrameType.GOAWAY ? `GOAWAY code=${goawayErrorCode(reply)}` : "PING ACK").toBe(
        `GOAWAY code=${ErrorCode.PROTOCOL_ERROR}`,
      );
    } finally {
      c.close();
      server.close();
    }
  });

  test("server: DATA still counts toward the connection window", async () => {
    const c = await Raw.connect(port);
    try {
      c.sendFrame(FrameType.HEADERS, 0x5, 1, requestHeaderBlock("GET"));
      await c.waitFor(f => f.type === FrameType.DATA && f.streamId === 1 && (f.flags & 0x1) !== 0);
      // 49,152 bytes: inside the 65,535-byte connection window and past the half of it at which the
      // server sends a WINDOW_UPDATE.
      const large = encodeFrame(FrameType.DATA, 0, 1, Buffer.alloc(16_384));
      c.send(Buffer.concat([large, large, large]));
      const credit = await c.waitFor(f => f.type === FrameType.WINDOW_UPDATE && f.streamId === 0);
      expect(credit.payload.readUInt32BE(0)).toBeGreaterThanOrEqual(32_767);
      expect(c.frames.filter(isFatal)).toEqual([]);
    } finally {
      c.close();
    }
  });

  test.each(floods)("client: %s gets no RST_STREAM, and the session keeps working", async (_, flood) => {
    const raw = await Raw.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    let sessionError: Error | undefined;
    client.on("error", e => (sessionError = e));
    // One request, answered by the raw server with 200 and a body that ends the stream.
    const roundTrip = async (id: number) => {
      const req = client.request({ ":path": "/" });
      req.resume();
      const closed = once(req, "close");
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === id);
      raw.sendFrame(FrameType.HEADERS, 0x4, id, Buffer.from([0x88]));
      raw.sendFrame(FrameType.DATA, 0x1, id, Buffer.from("ok"));
      await closed;
    };
    try {
      await raw.waitFor(f => f.type === FrameType.SETTINGS);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
      await roundTrip(1);
      raw.send(Buffer.concat([flood, PING]));
      await raw.waitFor(isPingAck);
      await roundTrip(3);
      expect(raw.frames.filter(isFatal)).toEqual([]);
      expect(sessionError).toBeUndefined();
    } finally {
      client.destroy();
      raw.close();
    }
  });

  // The engine has no entry for a request stream until the first frame arrives on it. That is
  // not a closed stream: an upload larger than the window needs this WINDOW_UPDATE to finish.
  test("client: WINDOW_UPDATE before any HEADERS or DATA on a request stream is applied", async () => {
    const raw = await Raw.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    try {
      await raw.waitFor(f => f.type === FrameType.SETTINGS);
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
      const body = Buffer.alloc(100_000, "u");
      const req = client.request({ ":method": "POST", ":path": "/" });
      req.on("error", () => {});
      req.end(body);
      const uploaded = () =>
        raw.frames.filter(f => f.type === FrameType.DATA && f.streamId === 1).reduce((n, f) => n + f.length, 0);
      // The 65,535-byte stream and connection windows stop the upload here.
      await raw.waitFor(() => uploaded() === 65_535);
      raw.send(Buffer.concat([windowUpdate(0, 65_535), windowUpdate(1, 65_535)]));
      await raw.waitFor(f => f.type === FrameType.DATA && f.streamId === 1 && (f.flags & 0x1) !== 0);
      expect(uploaded()).toBe(body.length);
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

const RESPONSE_200 = Buffer.from([0x88]); // ":status: 200", static table
const END_STREAM = 0x1;
const END_HEADERS = 0x4;

/** Two PING round trips: what the client wrote before it read the first PING has arrived. */
let pings = 0;
async function twoRoundTrips(raw: Raw) {
  for (let i = 0; i < 2; i++) {
    const payload = Buffer.alloc(8);
    payload.writeUInt32BE(++pings, 4);
    raw.sendFrame(FrameType.PING, 0, 0, payload);
    await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0 && f.payload.equals(payload));
  }
}

describe("frames on a stream that the client closed", () => {
  const { NGHTTP2_CANCEL } = http2.constants;
  const isReset = (id: number) => (f: Frame) => f.type === FrameType.RST_STREAM && f.streamId === id;
  const requestOn = (id: number) => (f: Frame) => f.type === FrameType.HEADERS && f.streamId === id;

  /** A client with the server's SETTINGS, and request stream 1 cancelled and acknowledged as such. */
  async function cancelledRequest(raw: Raw, options: http2.ClientSessionOptions = {}) {
    const client = http2.connect(`http://127.0.0.1:${raw.port}`, options);
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    await raw.waitFor(requestOn(1));
    raw.sendFrame(FrameType.SETTINGS, 0, 0);
    raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
    await twoRoundTrips(raw);
    req.close(NGHTTP2_CANCEL);
    await raw.waitFor(isReset(1));
    return client;
  }

  // A header block on a closed stream is decoded. nghttp2 does the same.
  test("a header block that does not decode is a COMPRESSION_ERROR", async () => {
    const raw = await Raw.listen();
    const client = await cancelledRequest(raw);
    const sessionError = once(client, "error");
    try {
      // 0xff 0x00: index 127 names no entry of the static or the dynamic table.
      raw.sendFrame(FrameType.HEADERS, END_HEADERS | END_STREAM, 1, Buffer.from([0xff, 0x00]));
      const goaway = await raw.waitFor(f => f.type === FrameType.GOAWAY);
      expect(goawayErrorCode(goaway)).toBe(ErrorCode.COMPRESSION_ERROR);
      const [err] = await sessionError;
      expect(err.code).toBe("ERR_HTTP2_ERROR");
    } finally {
      client.destroy();
      raw.close();
    }
  });

  // nghttp2 charges each header block that it ignores to a budget: 10,000, and 330 more per second.
  test("header blocks that use up the budget end the session", async () => {
    const raw = await Raw.listen();
    const client = await cancelledRequest(raw);
    const sessionError = once(client, "error");
    try {
      const late = encodeFrame(FrameType.HEADERS, END_HEADERS, 1, RESPONSE_200);
      raw.send(Buffer.concat(Array(9_000).fill(late)));
      await twoRoundTrips(raw);
      expect(raw.frames.filter(f => f.type === FrameType.GOAWAY)).toEqual([]);
      // The budget gets 330 back per second, so the second burst is well above what is left.
      raw.send(Buffer.concat(Array(30_000).fill(late)));
      const goaway = await raw.waitFor(f => f.type === FrameType.GOAWAY, 10_000);
      expect(goawayErrorCode(goaway)).toBe(ErrorCode.ENHANCE_YOUR_CALM);
      const [err] = await sessionError;
      expect(err.code).toBe("ERR_HTTP2_ERROR");
    } finally {
      client.destroy();
      raw.close();
    }
  });

  // With 1-byte reads a DATA frame starts before its payload is there, which is a path of its own.
  test.skipIf(!fault.available() || isWindows)("DATA that arrives one byte at a time gets no reply", async () => {
    const raw = await Raw.listen();
    const client = await cancelledRequest(raw);
    client.on("error", () => {});
    try {
      fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: -1 });
      raw.send(
        Buffer.concat([
          encodeFrame(FrameType.DATA, 0, 1, Buffer.from("late ")),
          encodeFrame(FrameType.DATA, END_STREAM, 1, Buffer.from("body")),
        ]),
      );
      await twoRoundTrips(raw);
      fault.clear();
      const replies = raw.frames
        .filter(f => [FrameType.RST_STREAM, FrameType.GOAWAY, FrameType.WINDOW_UPDATE].includes(f.type as 3 | 7 | 8))
        .map(f => `type ${f.type} stream ${f.streamId} ${f.payload.readUInt32BE(f.type === FrameType.GOAWAY ? 4 : 0)}`);
      // The client's own reset, which it can write twice.
      expect([...new Set(replies)]).toEqual([`type ${FrameType.RST_STREAM} stream 1 ${ErrorCode.CANCEL}`]);
      const closed = once(client, "close");
      client.close();
      await closed;
    } finally {
      fault.clear();
      client.destroy();
      raw.close();
    }
  });

  test("a late response leaves no stream behind", async () => {
    const raw = await Raw.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`, { maxSessionMemory: 1 });
    client.on("error", () => {});
    try {
      // A stalled upload: all but 20,000 bytes of the 1 MiB session budget sit in the outbound queue.
      const upload = client.request({ ":path": "/", ":method": "POST" });
      upload.on("error", () => {});
      await raw.waitFor(requestOn(1));
      raw.sendFrame(FrameType.SETTINGS, 0, 0);
      raw.sendFrame(FrameType.SETTINGS, 0x1, 0);
      upload.write(Buffer.alloc(65_535 + 1024 * 1024 - 20_000));
      const uploaded = () =>
        raw.frames.filter(f => f.type === FrameType.DATA && f.streamId === 1).reduce((n, f) => n + f.length, 0);
      await raw.waitFor(() => uploaded() === 65_535);

      // 300 cancelled requests, each with a late response. One stream entry is 104 bytes, so
      // entries that stay behind use up the budget and request() is refused.
      const refused = Promise.withResolvers<string>();
      let id = 1;
      for (let batch = 0; batch < 12; batch++) {
        const requests = Array.from({ length: 25 }, () => {
          id += 2;
          return client.request({ ":path": "/" }).on("error", (err: Error) => refused.resolve(err.message));
        });
        const sent = raw.waitFor(requestOn(id), 10_000).then(() => "sent");
        expect(await Promise.race([sent, refused.promise])).toBe("sent");
        for (const req of requests) req.close(NGHTTP2_CANCEL);
        await raw.waitFor(isReset(id), 10_000);
        const late = requests.map((_, i) => encodeFrame(FrameType.HEADERS, END_HEADERS, id - 2 * i, RESPONSE_200));
        raw.send(Buffer.concat(late));
        await twoRoundTrips(raw);
      }
    } finally {
      client.destroy();
      raw.close();
    }
  });
});
