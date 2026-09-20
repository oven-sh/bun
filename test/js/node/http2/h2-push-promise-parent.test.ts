/**
 * A node:http2 client and the parent stream of a PUSH_PROMISE.
 *
 * RFC 9113 §6.6: an endpoint that reset a stream still has to handle a PUSH_PROMISE the peer
 * created on it before the reset arrived. nghttp2_session_on_push_promise_received refuses the
 * promised stream with RST_STREAM(CANCEL) when the parent is CLOSING (its RST_STREAM is submitted)
 * or gone. It decides when the PUSH_PROMISE frame arrives, not when its header block is complete:
 * https://github.com/nodejs/node/blob/v26.3.0/deps/nghttp2/lib/nghttp2_session.c#L4613-L4627
 *
 * A raw byte-level HTTP/2 server drives the client, so each case controls which frames share a
 * socket read. Every expected result is what node v26.3.0 does.
 *
 * These cases are not in h2-conformance.test.ts, because that file also holds cases that count
 * live stream objects after a GC, and those fail now and then on a debug build (#42357).
 *
 * Works with both:
 *   bun bd test test/js/node/http2/h2-push-promise-parent.test.ts
 *   node --test test/js/node/http2/h2-push-promise-parent.test.ts
 */
import assert from "node:assert";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { describe, test } from "node:test";

const { NGHTTP2_CANCEL } = http2.constants;
const isBun = typeof Bun !== "undefined";

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");

const FrameType = {
  DATA: 0x0,
  HEADERS: 0x1,
  RST_STREAM: 0x3,
  SETTINGS: 0x4,
  PUSH_PROMISE: 0x5,
  PING: 0x6,
  CONTINUATION: 0x9,
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
  private closed = false;
  frames: Frame[] = [];
  private waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void; reject: (e: Error) => void }> = [];

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
      socket.on("close", () => {
        s.closed = true;
        for (const w of s.waiters.splice(0)) w.reject(RawH2Server.closedError());
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return s;
  }

  get port(): number {
    return (this.server.address() as net.AddressInfo).port;
  }

  private static closedError() {
    return new Error("the connection closed before the awaited frame arrived");
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

  write(...frames: Buffer[]) {
    this.socket!.write(Buffer.concat(frames));
  }

  /** No deadline here: the test's own timeout is the limit. */
  waitFor(pred: (f: Frame) => boolean): Promise<Frame> {
    const existing = this.frames.find(pred);
    if (existing) return Promise.resolve(existing);
    if (this.closed) return Promise.reject(RawH2Server.closedError());
    const { promise, resolve, reject } = Promise.withResolvers<Frame>();
    this.waiters.push({ pred, resolve, reject });
    return promise;
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

const serverSettings = Buffer.concat([
  encodeFrame(FrameType.SETTINGS, 0, 0),
  encodeFrame(FrameType.SETTINGS, 0x1 /* ACK */, 0),
]);
/** Response HEADERS on stream 1: [:status 200]. */
const responseHeaders = (flags: number) => encodeFrame(FrameType.HEADERS, flags, 1, Buffer.from([0x88]));
const promisedId = Buffer.alloc(4);
promisedId.writeUInt32BE(2, 0);
// The promised request, in two parts: [:method GET, :scheme http, :path /] and [:authority localhost].
const blockHead = Buffer.from([0x82, 0x86, 0x84]);
const blockTail = Buffer.concat([Buffer.from([0x01]), hpackLiteral("localhost")]);
/** PUSH_PROMISE on stream 1 that reserves stream 2, with its whole header block. */
const pushPromise = encodeFrame(
  FrameType.PUSH_PROMISE,
  0x4 /* END_HEADERS */,
  1,
  Buffer.concat([promisedId, blockHead, blockTail]),
);
/** The same promise with its block split: PUSH_PROMISE without END_HEADERS, then CONTINUATION. */
const pushPromiseHead = encodeFrame(FrameType.PUSH_PROMISE, 0, 1, Buffer.concat([promisedId, blockHead]));
const pushPromiseTail = encodeFrame(FrameType.CONTINUATION, 0x4 /* END_HEADERS */, 1, blockTail);
/** The whole pushed response on stream 2. */
const pushedResponse = Buffer.concat([
  encodeFrame(FrameType.HEADERS, 0x4 /* END_HEADERS */, 2, Buffer.from([0x88])),
  encodeFrame(FrameType.DATA, 0x1 /* END_STREAM */, 2, Buffer.from("pushed")),
]);
// A 200000-byte body exceeds the 65535-byte initial window and the raw server never opens it, so
// the request's writable cannot finish.
const blockedBody = Buffer.alloc(200_000, "a");

const refused = { pushedStreams: 0, resetsOnStream2: [NGHTTP2_CANCEL] };
const surfaced = { pushedStreams: 1, resetsOnStream2: [] as number[] };

type Row = {
  /**
   * The request on stream 1. Without it, a GET. With it, a POST: "open" has no body and user code
   * does not end it, "write" and "end" give it the blocked body through write() or end().
   */
  body?: "open" | "write" | "end";
  /** Runs in the 'response' listener, so inside the read that carries `read1`. */
  inResponse?: (req: http2.ClientHttp2Stream, abort: AbortController) => void;
  /** The request gets the signal of the AbortController that `inResponse` receives. */
  signal?: boolean;
  /** Runs after `read1` is parsed to its end and before `read2` is written. */
  betweenReads?: (req: http2.ClientHttp2Stream) => void;
  /** Awaited before `read2` is written. */
  serverWaitsFor?: (f: Frame) => boolean;
  read1: Buffer[];
  read2?: Buffer[];
  expected: typeof refused;
  /** Why Bun does not give node's result yet. */
  todoOnBun?: string;
};

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

async function pushExchange(row: Row) {
  const raw = await RawH2Server.listen();
  const client = http2.connect(`http://127.0.0.1:${raw.port}`);
  client.on("error", () => {});
  let pushedStreams = 0;
  client.on("stream", pushed => {
    pushedStreams++;
    pushed.on("error", () => {});
  });
  try {
    const abort = new AbortController();
    const req = client.request(
      { ":path": "/", ":method": row.body ? "POST" : "GET" },
      row.signal ? { signal: abort.signal } : undefined,
    );
    req.on("error", () => {});
    if (row.body === "write") req.write(blockedBody);
    else if (row.body === "end") req.end(blockedBody);
    const responded = once(req, "response").then(() => row.inResponse?.(req, abort));
    await raw.waitFor(f => f.type === FrameType.HEADERS && f.streamId === 1);
    // One write is one read for the client.
    raw.write(serverSettings, ...row.read1);
    if (row.read2 || row.betweenReads || row.serverWaitsFor) {
      await responded;
      // A turn of the event loop: the read is parsed to its end, and a reset that the client
      // scheduled during it has left.
      await nextTurn();
      if (row.betweenReads) {
        row.betweenReads(req);
        await nextTurn();
      }
      if (row.serverWaitsFor) await raw.waitFor(row.serverWaitsFor);
      if (row.read2) raw.write(...row.read2);
    }
    // Two PING round trips with a turn between them end the exchange, so a frame the client
    // sends from nextTick or setImmediate in reply is counted too.
    for (const payload of ["ping-one", "ping-two"]) {
      raw.write(encodeFrame(FrameType.PING, 0, 0, Buffer.from(payload)));
      await raw.waitFor(f => f.type === FrameType.PING && (f.flags & 0x1) !== 0 && f.payload.toString() === payload);
      await nextTurn();
    }
    return {
      pushedStreams,
      resetsOnStream2: raw.frames
        .filter(f => f.type === FrameType.RST_STREAM && f.streamId === 2)
        .map(f => f.payload.readUInt32BE(0)),
    };
  } finally {
    client.destroy();
    raw.close();
  }
}

const sameRead = [responseHeaders(0x4 /* END_HEADERS */), pushPromise, pushedResponse];
const rows: Record<string, Row> = {
  "destroy()": { inResponse: req => req.destroy(), read1: sameRead, expected: refused },
  "destroy(error)": { inResponse: req => req.destroy(new Error("boom")), read1: sameRead, expected: refused },
  "abort() on the signal of the request": {
    signal: true,
    inResponse: (_, abort) => abort.abort(),
    read1: sameRead,
    expected: refused,
  },
  "close()": { inResponse: req => req.close(), read1: sameRead, expected: refused },
  "nothing, the request stays open": { read1: sameRead, expected: surfaced },
  // node's closeStream submits the RST_STREAM at once when user code had not ended the
  // writable, and waits for 'finish' when it had:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L2033-L2040
  "close() on a request with no body that user code had not ended": {
    body: "open",
    inResponse: req => req.close(),
    read1: sameRead,
    expected: refused,
  },
  "close() while a body from write() is blocked": {
    body: "write",
    inResponse: req => req.close(),
    read1: sameRead,
    expected: refused,
  },
  "close() while a body from end() is blocked": {
    body: "end",
    inResponse: req => req.close(),
    read1: sameRead,
    expected: surfaced,
  },
  // _destroy() submits nothing when close() already ran, so the stream is still not CLOSING.
  "close() while a body from end() is blocked, then destroy()": {
    body: "end",
    inResponse: req => (req.close(), req.destroy()),
    read1: sameRead,
    expected: surfaced,
  },
  // Inside a read node holds the RST_STREAM of close(NGHTTP2_CANCEL) back, so nghttp2 does not
  // see the stream as CLOSING. destroy() flushes it:
  // https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L2513-L2524
  "close(NGHTTP2_CANCEL)": { inResponse: req => req.close(NGHTTP2_CANCEL), read1: sameRead, expected: surfaced },
  "close(NGHTTP2_CANCEL), then destroy()": {
    inResponse: req => (req.close(NGHTTP2_CANCEL), req.destroy()),
    read1: sameRead,
    expected: refused,
  },
  // The answer is fixed when the PUSH_PROMISE frame arrives. Its CONTINUATION comes in a later read.
  "destroy(), and the block of the PUSH_PROMISE ends in a later read": {
    inResponse: req => req.destroy(),
    read1: [responseHeaders(0x4), pushPromiseHead],
    read2: [pushPromiseTail, pushedResponse],
    expected: refused,
  },
  "close() between the PUSH_PROMISE frame and the end of its block": {
    body: "write",
    betweenReads: req => req.close(),
    read1: [responseHeaders(0x4), pushPromiseHead],
    read2: [pushPromiseTail, pushedResponse],
    expected: surfaced,
  },
  "nothing, and the block of the PUSH_PROMISE ends in a later read": {
    read1: [responseHeaders(0x4), pushPromiseHead],
    read2: [pushPromiseTail, pushedResponse],
    expected: surfaced,
  },
  // node refuses these two as well (the `!stream` arm of the same nghttp2 check). The parser has
  // released the parent by then, and the client surfaces the push until the server's frame
  // order is fixed: test-http2-respond-file-push.js gets its PUSH_PROMISE after the parent's
  // END_STREAM.
  "close(NGHTTP2_CANCEL), and the PUSH_PROMISE arrives after the RST_STREAM reached the server": {
    inResponse: req => req.close(NGHTTP2_CANCEL),
    read1: [responseHeaders(0x4)],
    serverWaitsFor: f => f.type === FrameType.RST_STREAM && f.streamId === 1,
    read2: [pushPromise, pushedResponse],
    expected: refused,
    todoOnBun: "a parent that the parser already released is still accepted (#43479)",
  },
  "nothing, and the request already completed": {
    read1: [responseHeaders(0x5 /* END_STREAM | END_HEADERS */), pushPromise, pushedResponse],
    expected: refused,
    todoOnBun: "a parent that the parser already released is still accepted (#43479)",
  },
};

describe("a PUSH_PROMISE, when the 'response' listener of its parent does", () => {
  for (const [name, row] of Object.entries(rows)) {
    test(name, { todo: isBun && row.todoOnBun ? row.todoOnBun : false }, async () => {
      assert.deepStrictEqual(await pushExchange(row), row.expected);
    });
  }
});

if (isBun) {
  const node = Bun.which("node");
  // Alpine's node segfaults at a random point of node-http2-client-close.test.ts (alpine 3.23
  // aarch64), and the CI runner fails a file for any new core dump. The glibc, macOS and Windows
  // lanes keep the cross-check.
  const isMusl =
    process.platform === "linux" &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  describe("Node.js compatibility", () => {
    test("tests should run on node.js", { skip: !node || isMusl }, async () => {
      await using proc = Bun.spawn({
        cmd: [node as string, "--test", import.meta.filename],
        stdout: "inherit",
        stderr: "inherit",
        stdin: "ignore",
      });
      assert.strictEqual(await proc.exited, 0);
    });
  });
}
