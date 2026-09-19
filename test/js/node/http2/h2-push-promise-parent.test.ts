// A node:http2 client and the parent stream of a PUSH_PROMISE. A raw byte-level HTTP/2 server
// drives the client, so each case controls which frames share a socket read.
//
// These cases are not in h2-conformance.test.ts, because that file also holds cases that count
// live stream objects after a GC, and those fail now and then on a debug build (#42357).

import { describe, expect, mock, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");

const FrameType = {
  DATA: 0x0,
  HEADERS: 0x1,
  RST_STREAM: 0x3,
  SETTINGS: 0x4,
  PUSH_PROMISE: 0x5,
  PING: 0x6,
} as const;

const ErrorCode = {
  CANCEL: 0x8,
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

describe("PUSH_PROMISE and the state of its parent stream (RFC 9113 §6.6)", () => {
  // RFC 9113 §6.6: an endpoint that reset a stream still has to handle a PUSH_PROMISE the peer
  // created on it before the reset arrived. nghttp2_session_on_push_promise_received refuses the
  // promised stream with RST_STREAM(CANCEL) when the associated stream is gone or closing:
  // https://github.com/nodejs/node/blob/v26.3.0/deps/nghttp2/lib/nghttp2_session.c#L4613-L4627
  const serverSettings = Buffer.concat([
    encodeFrame(FrameType.SETTINGS, 0, 0),
    encodeFrame(FrameType.SETTINGS, 0x1 /* ACK */, 0),
  ]);
  /** Response HEADERS on stream 1: [:status 200]. */
  const responseHeaders = (flags: number) => encodeFrame(FrameType.HEADERS, flags, 1, Buffer.from([0x88]));
  /** PUSH_PROMISE on stream 1 reserving stream 2, then the whole pushed response on stream 2. */
  function pushOnStream1(): Buffer {
    const promised = Buffer.alloc(4);
    promised.writeUInt32BE(2, 0);
    // [:method GET, :scheme http, :path /, :authority localhost]
    const block = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01]), hpackLiteral("localhost")]);
    return Buffer.concat([
      encodeFrame(FrameType.PUSH_PROMISE, 0x4 /* END_HEADERS */, 1, Buffer.concat([promised, block])),
      encodeFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 2, Buffer.from([0x88])),
      encodeFrame(FrameType.DATA, 0x1 /* END_STREAM */, 2, Buffer.from("pushed")),
    ]);
  }
  /**
   * Sends one request (stream 1, a GET unless `startRequest` makes another) to a raw server.
   * `serve` writes the server's frames once the request HEADERS arrived. Two PING round trips
   * with an event loop turn between them end the exchange, so a frame the client sends from
   * nextTick or setImmediate in reply is counted too.
   */
  async function pushExchange(
    onResponse: (req: http2.ClientHttp2Stream) => void,
    serve: (raw: RawH2Server) => void | Promise<void>,
    startRequest = (client: http2.ClientHttp2Session) => client.request({ ":path": "/" }),
  ) {
    const raw = await RawH2Server.listen();
    const client = http2.connect(`http://127.0.0.1:${raw.port}`);
    client.on("error", () => {});
    const onStream = mock((pushed: http2.ClientHttp2Stream) => {
      pushed.on("error", () => {});
    });
    client.on("stream", onStream);
    try {
      const req = startRequest(client);
      req.on("error", () => {});
      req.once("response", () => onResponse(req));
      await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
      await serve(raw);
      for (const payload of ["ping-one", "ping-two"]) {
        raw.sendFrame(FrameType.PING, 0, 0, Buffer.from(payload));
        await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0 && f.payload.toString() === payload);
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      return {
        pushedStreams: onStream.mock.calls.length,
        resetsOnStream2: raw.frames
          .filter(f => f.type === FrameType.RST_STREAM && f.streamId === 2)
          .map(f => f.payload.readUInt32BE(0)),
      };
    } finally {
      client.destroy();
      raw.close();
    }
  }
  // One write: the client parses the PUSH_PROMISE in the read that delivered the response.
  const pushInSameReadAsResponse = (raw: RawH2Server) => {
    raw.socket!.write(
      Buffer.concat([
        serverSettings,
        responseHeaders(0x4 /* END_HEADERS */),
        pushOnStream1(),
        encodeFrame(FrameType.DATA, 0x1 /* END_STREAM */, 1, Buffer.from("body")),
      ]),
    );
  };

  // close(NGHTTP2_CANCEL) is left out. Inside a read node holds that RST_STREAM back until the
  // read ends, so nghttp2 does not see the stream as closing and node surfaces the push:
  // https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L2513-L2524
  test.each([
    ["destroy()", (req: http2.ClientHttp2Stream) => req.destroy()],
    ["close()", (req: http2.ClientHttp2Stream) => req.close()],
  ])(
    "a PUSH_PROMISE read together with the response is refused once the 'response' listener called %s",
    async (_, closeRequest) => {
      // The request is closed in JS only: its RST_STREAM leaves after the rest of the read is parsed.
      expect(await pushExchange(closeRequest, pushInSameReadAsResponse)).toEqual({
        pushedStreams: 0,
        resetsOnStream2: [ErrorCode.CANCEL],
      });
    },
  );

  test("a PUSH_PROMISE on a request stream that stays open surfaces the pushed stream", async () => {
    expect(await pushExchange(() => {}, pushInSameReadAsResponse)).toEqual({
      pushedStreams: 1,
      resetsOnStream2: [],
    });
  });

  // The parent stays open for the server: no END_STREAM on stream 1.
  const pushOnOpenParent = (raw: RawH2Server) => {
    raw.socket!.write(Buffer.concat([serverSettings, responseHeaders(0x4 /* END_HEADERS */), pushOnStream1()]));
  };

  // A 200000-byte body exceeds the 65535-byte initial window and the raw server never opens it,
  // so the request's writable cannot finish. node's closeStream submits the RST_STREAM at once
  // when user code had not ended the writable, and waits for 'finish' when it had:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L2033-L2040
  const blockedBody = Buffer.alloc(200_000, "a");
  test.each([
    ["refused", "write()", { pushedStreams: 0, resetsOnStream2: [ErrorCode.CANCEL] }],
    ["surfaced", "end()", { pushedStreams: 1, resetsOnStream2: [] }],
  ] as const)(
    "a PUSH_PROMISE is %s once close() ran on a request whose blocked body came from %s",
    async (_, how, expected) => {
      const result = await pushExchange(
        req => req.close(),
        pushOnOpenParent,
        client => {
          const req = client.request({ ":path": "/", ":method": "POST" });
          if (how === "write()") req.write(blockedBody);
          else req.end(blockedBody);
          return req;
        },
      );
      expect(result).toEqual(expected);
    },
  );

  // node refuses these three as well. In each the parser already released the parent (the
  // `!stream` arm of the same nghttp2 check), and the client surfaces the pushed stream until
  // the server's frame order is fixed (#43479): test-http2-respond-file-push.js gets its
  // PUSH_PROMISE after the parent's END_STREAM.
  test.todo(
    "a PUSH_PROMISE is refused once close() ran on a request with no body that user code had not ended",
    async () => {
      // close() ends the writable, 'finish' follows before the next frame is parsed, and the
      // RST_STREAM that waited for it releases the parent.
      const result = await pushExchange(
        req => req.close(),
        pushOnOpenParent,
        client => client.request({ ":path": "/", ":method": "POST" }),
      );
      expect(result).toEqual({ pushedStreams: 0, resetsOnStream2: [ErrorCode.CANCEL] });
    },
  );

  test.todo("a PUSH_PROMISE that arrives after the client reset its request stream is refused", async () => {
    const result = await pushExchange(
      req => req.close(http2.constants.NGHTTP2_CANCEL),
      async raw => {
        raw.socket!.write(Buffer.concat([serverSettings, responseHeaders(0x4 /* END_HEADERS */)]));
        const rst = await raw.waitFor(f => f.type === FrameType.RST_STREAM && f.streamId === 1);
        expect(rst.payload.readUInt32BE(0)).toBe(ErrorCode.CANCEL);
        raw.socket!.write(pushOnStream1());
      },
    );
    expect(result).toEqual({ pushedStreams: 0, resetsOnStream2: [ErrorCode.CANCEL] });
  });

  test.todo("a PUSH_PROMISE on a request stream that already completed is refused", async () => {
    const result = await pushExchange(
      () => {},
      raw => {
        raw.socket!.write(
          Buffer.concat([serverSettings, responseHeaders(0x5 /* END_STREAM | END_HEADERS */), pushOnStream1()]),
        );
      },
    );
    expect(result).toEqual({ pushedStreams: 0, resetsOnStream2: [ErrorCode.CANCEL] });
  });
});
