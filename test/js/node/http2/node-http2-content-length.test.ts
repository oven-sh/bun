/**
 * RFC 9113 section 8.1.1 in node:http2: a message is malformed when its content-length differs
 * from the total of its DATA. The receiver resets the stream with PROTOCOL_ERROR.
 *
 * A raw socket is the peer, so a message is exactly the frames that the test writes.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-content-length.test.ts
 *   node --test test/js/node/http2/node-http2-content-length.test.ts
 */
import assert from "node:assert";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { Duplex } from "node:stream";
import { describe, test } from "node:test";

const { NGHTTP2_NO_ERROR, NGHTTP2_PROTOCOL_ERROR, NGHTTP2_INTERNAL_ERROR, NGHTTP2_CANCEL, NGHTTP2_ENHANCE_YOUR_CALM } =
  http2.constants;
const isBun = typeof Bun !== "undefined";

const DATA = 0;
const HEADERS = 1;
const RST_STREAM = 3;
const SETTINGS = 4;
const PUSH_PROMISE = 5;
const PING = 6;
const GOAWAY = 7;
const END_STREAM = 0x1;
const ACK = 0x1;
const END_HEADERS = 0x4;
const PADDED = 0x8;

type Frame = { type: number; flags: number; streamId: number; payload: Buffer };

function frame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header[3] = type;
  header[4] = flags;
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}
const headers = (block: Buffer, flags = 0, streamId = 1) => frame(HEADERS, END_HEADERS | flags, streamId, block);
const data = (body: string, flags = 0, streamId = 1) => frame(DATA, flags, streamId, Buffer.from(body));
/** The payload of a PADDED DATA frame: the pad length, the data, the padding. */
const padded = (body: string, padding: number) =>
  Buffer.concat([Buffer.from([padding]), Buffer.from(body), Buffer.alloc(padding)]);

// HPACK that leaves the dynamic table alone. A string is a 7-bit length, then its bytes.
const literal = (text: string) => Buffer.concat([Buffer.from([text.length]), Buffer.from(text, "latin1")]);
// "Literal header field without indexing" with the name from the static table: 8 is :status, 28 is
// content-length.
const status = (code: number) => Buffer.concat([Buffer.from([0x08]), literal(String(code))]);
const contentLength = (length: number) => Buffer.concat([Buffer.from([0x0f, 0x0d]), literal(String(length))]);
const ok = (length: number) => Buffer.concat([status(200), contentLength(length)]);
const TRAILERS = Buffer.concat([Buffer.from([0x00]), literal("x-trailer"), literal("1")]);
// A request block: POST, :scheme http, :path /, :authority localhost, content-length 5.
const POST_WITH_LENGTH_5 = Buffer.concat([
  Buffer.from([0x83, 0x86, 0x84, 0x01]),
  literal("localhost"),
  contentLength(5),
]);
/** PUSH_PROMISE on stream 1 for stream 2: `method`, then :scheme http, :path / and :authority. */
const promise = (method: string) =>
  frame(
    PUSH_PROMISE,
    END_HEADERS,
    1,
    Buffer.concat([
      Buffer.from([0, 0, 0, 2, 0x02]),
      literal(method),
      Buffer.from([0x86, 0x84, 0x01]),
      literal("localhost"),
    ]),
  );

/** One end of a raw HTTP/2 connection. It records the frames of the peer and sends what the test writes. */
class RawEnd {
  frames: Frame[] = [];
  #socket: net.Socket | undefined;
  #buffered = Buffer.alloc(0);
  /** Bytes of the client preface that are still to come. */
  #preface: number;
  #waiters: { matches: (received: Frame) => boolean; resolve: (received: Frame) => void }[] = [];
  #pings = 0;

  constructor(preface: number) {
    this.#preface = preface;
  }

  attach(socket: net.Socket) {
    this.#socket = socket;
    socket.setNoDelay(true);
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => this.#receive(chunk));
  }

  #receive(chunk: Buffer) {
    const skipped = Math.min(this.#preface, chunk.length);
    this.#preface -= skipped;
    let buffered = Buffer.concat([this.#buffered, chunk.subarray(skipped)]);
    while (buffered.length >= 9) {
      const length = buffered.readUIntBE(0, 3);
      if (buffered.length < 9 + length) break;
      const received = {
        type: buffered[3],
        flags: buffered[4],
        streamId: buffered.readUInt32BE(5) & 0x7fffffff,
        payload: buffered.subarray(9, 9 + length),
      };
      buffered = buffered.subarray(9 + length);
      if (received.type === SETTINGS && (received.flags & ACK) === 0) this.write(frame(SETTINGS, ACK, 0));
      this.frames.push(received);
      this.#waiters = this.#waiters.filter(waiter => {
        if (!waiter.matches(received)) return true;
        waiter.resolve(received);
        return false;
      });
    }
    this.#buffered = buffered;
  }

  /** The first frame of the peer that matches, now or later. */
  waitFor(what: string, matches: (received: Frame) => boolean): Promise<Frame> {
    const seen = this.frames.find(matches);
    if (seen) return Promise.resolve(seen);
    const { promise, resolve, reject } = Promise.withResolvers<Frame>();
    this.#waiters.push({ matches, resolve });
    const deadline = setTimeout(() => reject(new Error(`the peer did not send ${what}`)), 4000);
    return promise.finally(() => clearTimeout(deadline));
  }
  request(streamId: number): Promise<Frame> {
    return this.waitFor(`a request on stream ${streamId}`, f => f.type === HEADERS && f.streamId === streamId);
  }
  reset(streamId: number): Promise<Frame> {
    return this.waitFor(`RST_STREAM on stream ${streamId}`, f => f.type === RST_STREAM && f.streamId === streamId);
  }
  /** The code of each RST_STREAM that the peer has sent for the stream. */
  resetCodes(streamId: number): number[] {
    return this.frames
      .filter(f => f.type === RST_STREAM && f.streamId === streamId)
      .map(f => f.payload.readUInt32BE(0));
  }

  /** Resolves when the peer has read every frame that was written before this call. */
  async roundTrip() {
    const opaque = Buffer.alloc(8);
    opaque.writeUInt32BE(++this.#pings, 4);
    this.write(frame(PING, 0, 0, opaque));
    await this.waitFor("a PING ACK", f => f.type === PING && (f.flags & ACK) !== 0 && f.payload.equals(opaque));
  }

  write(bytes: Buffer) {
    this.#socket!.write(bytes);
  }

  close() {
    this.#socket?.destroy();
  }
}

/** A raw server for one node:http2 client. */
class RawServer extends RawEnd {
  #server = net.createServer();

  static async listen(): Promise<RawServer> {
    const raw = new RawServer(24);
    raw.#server.on("connection", socket => {
      raw.attach(socket);
      raw.write(frame(SETTINGS, 0, 0));
    });
    raw.#server.listen(0, "127.0.0.1");
    await once(raw.#server, "listening");
    return raw;
  }

  get url(): string {
    return `http://127.0.0.1:${(this.#server.address() as net.AddressInfo).port}`;
  }

  close() {
    super.close();
    this.#server.close();
  }
}

/** A raw client of a node:http2 server. It starts the server. */
async function rawClient(server: net.Server): Promise<RawEnd> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const raw = new RawEnd(0);
  const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  raw.attach(socket);
  await once(socket, "connect");
  raw.write(Buffer.concat([Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"), frame(SETTINGS, 0, 0)]));
  // The ACK of the server's SETTINGS goes out here, and not in the middle of a frame of the test.
  await raw.waitFor("SETTINGS", f => f.type === SETTINGS && (f.flags & ACK) === 0);
  return raw;
}

type Outcome = { events: string[]; body: string; rstCode: number | undefined; wireRst: number[] };
/**
 * Sends a DATA frame with END_STREAM on stream 1 in two writes, `first` bytes of its payload in
 * the first one. The second write follows when the client has acted on the first: it delivered
 * those bytes, or it reset the stream.
 */
type SendSplit = (payload: Buffer, first: number, clientHas: "delivered" | "reset", flags?: number) => Promise<void>;
type Reply = Buffer[] | ((raw: RawServer, sendSplit: SendSplit) => Promise<void>);
type Request = { method?: string; pushed?: boolean; rawHeaders?: string[] };

/**
 * Sends one request and answers it with `reply`. Reports what the request saw (with `pushed`:
 * what the stream pushed on it saw) and the code of each RST_STREAM that the client sent for it.
 */
async function exchange(reply: Reply, { method = "GET", pushed = false, rawHeaders }: Request = {}): Promise<Outcome> {
  const raw = await RawServer.listen();
  const client = http2.connect(raw.url);
  client.on("error", () => {});
  try {
    const events: string[] = [];
    let body = "";
    const closed = Promise.withResolvers<http2.ClientHttp2Stream>();
    const firstData = Promise.withResolvers<void>();
    const observe = (stream: http2.ClientHttp2Stream) => {
      stream.on(pushed ? "push" : "response", responseHeaders => events.push(`response ${responseHeaders[":status"]}`));
      stream.on("data", chunk => {
        body += chunk;
        firstData.resolve();
      });
      stream.on("end", () => events.push("end"));
      stream.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code}`));
      stream.on("close", () => closed.resolve(stream));
    };
    const isConnect = method === "CONNECT" || rawHeaders?.includes("CONNECT");
    const req = client.request(
      rawHeaders ??
        (isConnect ? { ":method": method, ":authority": "localhost:443" } : { ":method": method, ":path": "/" }),
    );
    if (pushed) {
      req.on("error", () => {});
      client.on("stream", observe);
    } else {
      observe(req);
      // A CONNECT request stays open. End it when the response has ended.
      if (isConnect) req.on("end", () => req.end());
    }
    await raw.request(1);
    if (Array.isArray(reply)) {
      raw.write(Buffer.concat(reply));
    } else {
      await reply(raw, async (payload, first, clientHas, flags = END_STREAM) => {
        const bytes = frame(DATA, flags, 1, payload);
        raw.write(bytes.subarray(0, 9 + first));
        if (clientHas === "reset") await raw.reset(1);
        else await Promise.race([firstData.promise, closed.promise]);
        raw.write(bytes.subarray(9 + first));
      });
    }
    const stream = await closed.promise;
    // Every frame that the client sent for the stream is in when the ACK arrives.
    await raw.roundTrip();
    const codes = raw.resetCodes(pushed ? 2 : 1);
    // Bun sends the reset of a pushed stream twice. That fault is older than this rule, so a
    // pushed stream reports each code once.
    return { events, body, rstCode: stream.rstCode, wireRst: pushed ? [...new Set(codes)] : codes };
  } finally {
    client.destroy();
    raw.close();
  }
}

// Two rejected streams end a session with this option. @types/node declares it for servers only.
const TWO_REJECTIONS = { maxSessionRejectedStreams: 2 } as http2.ClientSessionOptions;

/** Resolves on 'close'. Unlike events.once(), an 'error' event before that does not reject it. */
const closeOf = (emitter: { once(event: "close", listener: () => void): unknown }) =>
  new Promise<void>(resolve => emitter.once("close", () => resolve()));

/** The stream failed with PROTOCOL_ERROR after `events`, with `body` delivered before that. */
const reset = (events: string[], body: string): Outcome => ({
  events: [...events, "error ERR_HTTP2_STREAM_ERROR"],
  body,
  rstCode: NGHTTP2_PROTOCOL_ERROR,
  wireRst: [NGHTTP2_PROTOCOL_ERROR],
});
const delivered = (code: number, body: string): Outcome => ({
  events: [`response ${code}`, "end"],
  body,
  rstCode: NGHTTP2_NO_ERROR,
  wireRst: [],
});
function row(name: string, reply: Reply, expected: Outcome, request?: Request) {
  test(name, async () => assert.deepStrictEqual(await exchange(reply, request), expected));
}

describe("a response whose DATA does not add up to its content-length is a stream PROTOCOL_ERROR", () => {
  row("a shorter body", [headers(ok(5)), data("xy", END_STREAM)], reset(["response 200"], "xy"));
  row("a content-length and END_STREAM on the HEADERS frame", [headers(ok(5), END_STREAM)], reset([], ""));
  row(
    "a shorter body, then trailers",
    [headers(ok(5)), data("xy"), headers(TRAILERS, END_STREAM)],
    reset(["response 200"], "xy"),
  );
  row(
    "a shorter body in a DATA frame that arrives in two reads",
    async (raw, sendSplit) => {
      raw.write(headers(ok(5)));
      await sendSplit(Buffer.from("xyz"), 1, "delivered");
    },
    reset(["response 200"], "xyz"),
  );
  row(
    "a shorter body in a padded DATA frame as long as the content-length",
    [headers(ok(5)), frame(DATA, END_STREAM | PADDED, 1, padded("xy", 2))],
    reset(["response 200"], "xy"),
  );
  row(
    "the final response after a 1xx block",
    [headers(status(103)), headers(ok(5)), data("xy", END_STREAM)],
    reset(["response 200"], "xy"),
  );
  row(
    "a content-length that only the trailers declare",
    [headers(status(200)), data("xy"), headers(contentLength(5), END_STREAM)],
    reset(["response 200"], "xy"),
  );
  row(
    "a pushed response",
    [promise("GET"), headers(ok(5), 0, 2), data("xy", END_STREAM, 2)],
    reset(["response 200"], "xy"),
    { pushed: true },
  );
});

describe("a response whose DATA adds up to its content-length is delivered", () => {
  row("one DATA frame", [headers(ok(5)), data("hello", END_STREAM)], delivered(200, "hello"));
  row("two DATA frames", [headers(ok(5)), data("he"), data("llo", END_STREAM)], delivered(200, "hello"));
  row(
    "a DATA frame that arrives in two reads",
    async (raw, sendSplit) => {
      raw.write(headers(ok(5)));
      await sendSplit(Buffer.from("hello"), 2, "delivered");
    },
    delivered(200, "hello"),
  );
  row(
    "a padded DATA frame",
    [headers(ok(5)), frame(DATA, END_STREAM | PADDED, 1, padded("hello", 7))],
    delivered(200, "hello"),
  );
  row(
    "a padded DATA frame that arrives in two reads",
    async (raw, sendSplit) => {
      raw.write(headers(ok(5)));
      await sendSplit(padded("hello", 7), 3, "delivered", END_STREAM | PADDED);
    },
    delivered(200, "hello"),
  );
  row("trailers", [headers(ok(5)), data("hello"), headers(TRAILERS, END_STREAM)], delivered(200, "hello"));
  row("no content-length", [headers(status(200)), data("hello", END_STREAM)], delivered(200, "hello"));
  row("content-length 0 and END_STREAM on the HEADERS frame", [headers(ok(0), END_STREAM)], delivered(200, ""));
  row(
    "the final response after a 1xx block",
    [headers(status(103)), headers(ok(5)), data("hello", END_STREAM)],
    delivered(200, "hello"),
  );
  row(
    "a content-length that only the trailers declare",
    [headers(status(200)), data("xy"), headers(contentLength(2), END_STREAM)],
    delivered(200, "xy"),
  );
  row(
    "a pushed response",
    [promise("GET"), headers(ok(5), 0, 2), data("hello", END_STREAM, 2)],
    delivered(200, "hello"),
    { pushed: true },
  );
});

describe("a response that has no body by definition is not held to the content-length it declares", () => {
  row("a response to HEAD", [headers(ok(1234), END_STREAM)], delivered(200, ""), { method: "HEAD" });
  row(
    "a response to HEAD that the raw header form of request() sent",
    [headers(ok(1234), END_STREAM)],
    delivered(200, ""),
    {
      rawHeaders: [":method", "HEAD", ":path", "/", ":scheme", "http", ":authority", "localhost"],
    },
  );
  row("a pushed response to HEAD", [promise("HEAD"), headers(ok(1234), END_STREAM, 2)], delivered(200, ""), {
    pushed: true,
  });
  row("a 304", [headers(Buffer.concat([status(304), contentLength(1234)]), END_STREAM)], delivered(304, ""));
  row(
    "a 204 that ends on a DATA frame of padding only",
    [headers(status(204)), frame(DATA, END_STREAM | PADDED, 1, padded("", 4))],
    delivered(204, ""),
  );
});

describe("the DATA of a CONNECT response is a tunnel", () => {
  row(
    "a content-length in the response does not bind it",
    [headers(ok(5)), data("hello world", END_STREAM)],
    delivered(200, "hello world"),
    { method: "CONNECT" },
  );
  row(
    "a content-length in the trailers does not bind it",
    [headers(status(200)), data("hello"), headers(contentLength(9), END_STREAM)],
    delivered(200, "hello"),
    { method: "CONNECT" },
  );
  row(
    "a CONNECT that the raw header form of request() sent",
    [headers(ok(5)), data("hello world", END_STREAM)],
    delivered(200, "hello world"),
    { rawHeaders: [":method", "CONNECT", ":authority", "localhost:443"] },
  );
});

// node fails these streams: nghttp2 takes each of these fields as a malformed header. Bun accepts
// them, as it did before, and does not hold the message to them.
describe("a content-length that node rejects and Bun accepts", { skip: !isBun }, () => {
  row(
    "on a 1xx block: it does not bind the final response",
    [headers(Buffer.concat([status(103), contentLength(7)])), headers(ok(5)), data("hello", END_STREAM)],
    delivered(200, "hello"),
  );
  row(
    "other than 0 on a 204",
    [headers(Buffer.concat([status(204), contentLength(7)]), END_STREAM)],
    delivered(204, ""),
  );
  row(
    "in the trailers when the header section has one: the first one binds",
    [headers(ok(5)), data("hello"), headers(contentLength(7), END_STREAM)],
    delivered(200, "hello"),
  );
});

// DATA past the declared length. nghttp2 drops the frame and resets the stream, and so does Bun.
// node v26.3.0 then destroys the session: its OnInvalidFrame (src/node_http2.cc) takes the
// NGHTTP2_ERR_PROTO that nghttp2 1.69 reports for this frame as a session error. The stream fails
// with ERR_HTTP2_ERROR and rstCode 2 there. node v24.11.0 resets the stream only. node skips
// this block.
describe("DATA past the content-length is not delivered and resets the stream", { skip: !isBun }, () => {
  row("one DATA frame", [headers(ok(5)), data("toolong", END_STREAM)], reset(["response 200"], ""));
  row(
    "a second DATA frame, by one byte",
    [headers(ok(5)), data("hello"), data("!", END_STREAM)],
    reset(["response 200"], "hello"),
  );
  row(
    "a DATA frame that arrives in two reads is refused at its header",
    async (raw, sendSplit) => {
      raw.write(headers(ok(5)));
      await sendSplit(Buffer.from("toolong"), 3, "reset");
    },
    reset(["response 200"], ""),
  );
  row("DATA on a response to HEAD", [headers(ok(5)), data("hello", END_STREAM)], reset(["response 200"], ""), {
    method: "HEAD",
  });
  row("DATA on a 204", [headers(status(204)), data("hello", END_STREAM)], reset(["response 204"], ""));
  row("DATA on a 304", [headers(status(304)), data("hello", END_STREAM)], reset(["response 304"], ""));

  test("the frames behind the refused one are not delivered, and the session goes on", async () => {
    const raw = await RawServer.listen();
    const client = http2.connect(raw.url);
    client.on("error", () => {});
    try {
      const req = client.request({ ":path": "/" });
      const errors: (string | undefined)[] = [];
      let body = "";
      req.on("error", (err: NodeJS.ErrnoException) => errors.push(err.code));
      req.on("data", chunk => (body += chunk));
      const closed = closeOf(req);
      await raw.request(1);
      raw.write(headers(ok(5)));
      // The refused frame arrives in two reads, and more of the body follows it.
      const refused = data("toolong");
      raw.write(refused.subarray(0, 12));
      await raw.reset(1);
      raw.write(Buffer.concat([refused.subarray(12), data("more"), data("end", END_STREAM)]));
      await closed;
      await raw.roundTrip();
      assert.deepStrictEqual(
        { errors, body, rstCode: req.rstCode, firstReset: raw.resetCodes(1)[0] },
        {
          errors: ["ERR_HTTP2_STREAM_ERROR"],
          body: "",
          rstCode: NGHTTP2_PROTOCOL_ERROR,
          firstReset: NGHTTP2_PROTOCOL_ERROR,
        },
      );

      const next = client.request({ ":path": "/" });
      let nextBody = "";
      next.on("data", chunk => (nextBody += chunk));
      await raw.request(3);
      raw.write(Buffer.concat([headers(ok(2), 0, 3), data("ok", END_STREAM, 3)]));
      await once(next, "end");
      assert.strictEqual(nextBody, "ok");
    } finally {
      client.destroy();
      raw.close();
    }
  });

  test("a stream with no 'error' listener does not get the excess either", async () => {
    const raw = await RawServer.listen();
    const client = http2.connect(raw.url);
    client.on("error", () => {});
    try {
      const req = client.request({ ":path": "/" });
      let body = "";
      req.on("data", chunk => (body += chunk));
      await raw.request(1);
      raw.write(Buffer.concat([headers(ok(5)), data("hello"), data("!!", END_STREAM)]));
      await closeOf(req);
      assert.strictEqual(body, "hello");
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

// The same rule on a node:http2 server. The DATA frame that takes a request body past its
// content-length is not delivered, and the stream is reset at that frame. node v26.3.0 destroys
// the session here too: a stream handler gets ERR_HTTP2_ERROR there, and a compat handler gets
// the events below. node skips this block.
describe("DATA past the content-length of a request is not delivered and resets the stream", { skip: !isBun }, () => {
  /**
   * Sends the request, then the DATA that `sendBody` writes. Resolves with the code of the
   * server's RST_STREAM when the handler is done.
   */
  async function overrun(
    server: http2.Http2Server,
    sendBody: (raw: RawEnd) => void | Promise<void>,
    handlerDone: Promise<unknown>,
  ) {
    let raw: RawEnd | undefined;
    try {
      raw = await rawClient(server);
      raw.write(headers(POST_WITH_LENGTH_5));
      await sendBody(raw);
      const rst = await raw.reset(1);
      // The server answers a PING: it read what followed the refused DATA as frames.
      await raw.roundTrip();
      await handlerDone;
      return rst.payload.readUInt32BE(0);
    } finally {
      raw?.close();
      server.close();
    }
  }
  const helloThenExcess = (lastFlags: number) => (raw: RawEnd) =>
    raw.write(Buffer.concat([data("hello"), data("!!", lastFlags)]));

  for (const [name, sendBody, deliveredChunks] of [
    ["one DATA frame", (raw: RawEnd) => raw.write(data("toolong", END_STREAM)), []],
    ["a second DATA frame", helloThenExcess(END_STREAM), ["data hello"]],
    ["a DATA frame without END_STREAM", helloThenExcess(0), ["data hello"]],
    [
      "a DATA frame that arrives in two reads",
      async (raw: RawEnd) => {
        const bytes = data("toolong", END_STREAM);
        raw.write(bytes.subarray(0, 12));
        await raw.reset(1);
        raw.write(bytes.subarray(12));
      },
      [],
    ],
  ] as const) {
    test(`${name}, to a stream handler`, async () => {
      const seen: string[] = [];
      const closed = Promise.withResolvers<number | undefined>();
      const server = http2.createServer();
      server.on("stream", stream => {
        stream.on("data", chunk => seen.push(`data ${chunk}`));
        stream.on("end", () => seen.push("end"));
        stream.on("aborted", () => seen.push("aborted"));
        stream.on("error", (err: NodeJS.ErrnoException) => seen.push(`error ${err.code}`));
        stream.on("close", () => closed.resolve(stream.rstCode));
      });
      const wireRst = await overrun(server, sendBody, closed.promise);
      assert.deepStrictEqual(
        { seen, rstCode: await closed.promise, wireRst },
        {
          seen: [...deliveredChunks, "aborted", "error ERR_HTTP2_STREAM_ERROR"],
          rstCode: NGHTTP2_PROTOCOL_ERROR,
          wireRst: NGHTTP2_PROTOCOL_ERROR,
        },
      );
    });
  }

  test("a second DATA frame, to a compat request handler", async () => {
    const seen: string[] = [];
    const ended = Promise.withResolvers<void>();
    const server = http2.createServer(req => {
      req.on("data", chunk => seen.push(`data ${chunk}`));
      req.on("aborted", () => seen.push("aborted"));
      req.on("close", () => seen.push("close"));
      req.on("end", () => {
        seen.push("end");
        ended.resolve();
      });
    });
    const wireRst = await overrun(server, helloThenExcess(END_STREAM), ended.promise);
    assert.deepStrictEqual(
      { seen, wireRst },
      { seen: ["data hello", "aborted", "close", "end"], wireRst: NGHTTP2_PROTOCOL_ERROR },
    );
  });
});

// A server charges every malformed request block to maxSessionRejectedStreams, and this one too,
// as before. node counts it as an invalid frame only, so node skips this block.
describe("a request that ends on HEADERS short of its content-length", { skip: !isBun }, () => {
  test("uses up maxSessionRejectedStreams", async () => {
    const server = http2.createServer({ maxSessionRejectedStreams: 2 });
    let raw: RawEnd | undefined;
    try {
      raw = await rawClient(server);
      raw.write(
        Buffer.concat([headers(POST_WITH_LENGTH_5, END_STREAM, 1), headers(POST_WITH_LENGTH_5, END_STREAM, 3)]),
      );
      const goaway = await raw.waitFor("GOAWAY", f => f.type === GOAWAY);
      assert.deepStrictEqual(
        { resets: [raw.resetCodes(1), raw.resetCodes(3)], goaway: goaway.payload.readUInt32BE(4) },
        { resets: [[NGHTTP2_PROTOCOL_ERROR], [NGHTTP2_PROTOCOL_ERROR]], goaway: NGHTTP2_ENHANCE_YOUR_CALM },
      );
    } finally {
      raw?.close();
      server.close();
    }
  });
});

describe("a response that the client no longer has a request for is not judged", () => {
  // The response to a HEAD declares the length that a GET would get. Once the request is gone,
  // nothing tells the two apart.
  test("responses to HEAD requests that the caller cancelled", async () => {
    const raw = await RawServer.listen();
    const client = http2.connect(raw.url, TWO_REJECTIONS);
    client.on("error", () => {});
    try {
      const cancels = ["close", "destroy", "abort", "close"] as const;
      for (let i = 0; i < cancels.length; i++) {
        const streamId = 2 * i + 1;
        const abort = new AbortController();
        const req = client.request({ ":method": "HEAD", ":path": "/" }, { signal: abort.signal });
        req.on("error", () => {});
        const closed = closeOf(req);
        await raw.request(streamId);
        if (cancels[i] === "close") req.close(NGHTTP2_CANCEL);
        else if (cancels[i] === "destroy") req.destroy();
        else abort.abort();
        await raw.reset(streamId);
        // The response that was in flight when the reset arrived.
        raw.write(headers(ok(1234), END_STREAM, streamId));
        await raw.roundTrip();
        await closed;
      }
      const offence = (f: Frame) =>
        f.type === GOAWAY || (f.type === RST_STREAM && f.payload.readUInt32BE(0) === NGHTTP2_PROTOCOL_ERROR);
      assert.deepStrictEqual(raw.frames.filter(offence), []);

      const streamId = 2 * cancels.length + 1;
      const req = client.request({ ":path": "/" });
      let body = "";
      req.on("data", chunk => (body += chunk));
      await raw.request(streamId);
      raw.write(Buffer.concat([headers(ok(2), 0, streamId), data("ok", END_STREAM, streamId)]));
      await once(req, "end");
      assert.strictEqual(body, "ok");
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

describe("a response that ends on HEADERS short of its content-length", () => {
  // nghttp2 counts these as invalid frames (maxSessionInvalidFrames), not as rejected streams.
  test("does not use up maxSessionRejectedStreams", async () => {
    const raw = await RawServer.listen();
    const client = http2.connect(raw.url, TWO_REJECTIONS);
    client.on("error", () => {});
    try {
      const codes: (string | undefined)[] = [];
      for (let streamId = 1; streamId <= 7; streamId += 2) {
        const req = client.request({ ":path": "/" });
        req.on("error", (err: NodeJS.ErrnoException) => codes.push(err.code));
        const closed = closeOf(req);
        await raw.request(streamId);
        raw.write(headers(ok(5), END_STREAM, streamId));
        await closed;
      }
      assert.deepStrictEqual(codes, Array(4).fill("ERR_HTTP2_STREAM_ERROR"));

      const req = client.request({ ":path": "/" });
      let body = "";
      req.on("data", chunk => (body += chunk));
      await raw.request(9);
      raw.write(Buffer.concat([headers(ok(2), 0, 9), data("ok", END_STREAM, 9)]));
      await once(req, "end");
      assert.strictEqual(body, "ok");
      assert.deepStrictEqual(
        raw.frames.filter(f => f.type === GOAWAY),
        [],
      );
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

// node's onStreamClose: the code that nghttp2 reports for a stream does not replace the code of
// a close() that came first, and no 'error' follows for it.
describe("a stream that user code closed keeps its code", () => {
  const resetByServer = Buffer.alloc(4);
  resetByServer.writeUInt32BE(NGHTTP2_INTERNAL_ERROR);
  const short = [headers(ok(5)), data("xy", END_STREAM)];
  for (const [name, code, response, errors, judged] of [
    ["when the rest of the response breaks its content-length", NGHTTP2_CANCEL, short, [], true],
    // The 'error' is the one of the code that close() got.
    ["an error code of its own too", NGHTTP2_ENHANCE_YOUR_CALM, short, ["ERR_HTTP2_STREAM_ERROR"], false],
    [
      "when the server then resets the stream",
      NGHTTP2_CANCEL,
      [headers(status(200)), frame(RST_STREAM, 0, 1, resetByServer)],
      [],
      false,
    ],
  ] as const) {
    test(name, async () => {
      const raw = await RawServer.listen();
      const client = http2.connect(raw.url);
      client.on("error", () => {});
      try {
        const req = client.request({ ":path": "/" });
        const seen: (string | undefined)[] = [];
        req.on("error", (err: NodeJS.ErrnoException) => seen.push(err.code));
        req.on("response", () => req.close(code));
        req.resume();
        const closed = closeOf(req);
        await raw.request(1);
        // One write: the client reads the rest of the response behind the HEADERS frame.
        raw.write(Buffer.concat(response));
        await closed;
        await raw.roundTrip();
        assert.deepStrictEqual({ errors: seen, rstCode: req.rstCode }, { errors: [...errors], rstCode: code });
        // The client did read the body behind the close(): it reset the stream for its length.
        if (judged) assert.deepStrictEqual(raw.resetCodes(1), [NGHTTP2_PROTOCOL_ERROR]);
      } finally {
        client.destroy();
        raw.close();
      }
    });
  }

  // The other order: the reset of the peer is first, so its code stands. The session reads from
  // a JS Duplex here. All of one chunk is then parsed in one turn, and the close() runs before
  // the 'error' of the reset is emitted.
  test("a close() after the reset of the peer does not replace the code of the peer", async () => {
    const raw = await RawServer.listen();
    const client = http2.connect(raw.url, {
      createConnection: url => {
        const socket = net.connect(Number(url.port), url.hostname);
        const duplex = new Duplex({
          read() {
            socket.resume();
          },
          write(chunk, encoding, callback) {
            socket.write(chunk, encoding, callback);
          },
          destroy(err, callback) {
            socket.destroy();
            callback(err);
          },
        });
        socket.on("data", chunk => {
          if (!duplex.push(chunk)) socket.pause();
        });
        socket.on("error", () => {});
        socket.on("close", () => duplex.destroy());
        return duplex;
      },
    });
    client.on("error", () => {});
    try {
      const first = client.request({ ":path": "/" });
      const second = client.request({ ":path": "/" });
      const seen: string[] = [];
      first.on("error", (err: NodeJS.ErrnoException) => seen.push(`error ${err.code}`));
      first.on("end", () => seen.push("end"));
      first.resume();
      second.resume();
      second.on("response", () => first.close());
      const closed = closeOf(first);
      await raw.request(3);
      raw.write(
        Buffer.concat([
          headers(status(200)),
          frame(RST_STREAM, 0, 1, resetByServer),
          headers(status(200), END_STREAM, 3),
        ]),
      );
      await closed;
      assert.deepStrictEqual(
        { seen, rstCode: first.rstCode },
        { seen: ["error ERR_HTTP2_STREAM_ERROR"], rstCode: NGHTTP2_INTERNAL_ERROR },
      );
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

if (isBun) {
  const node = Bun.which("node");
  // Alpine's node segfaults at random in files of this kind (see node-http2-client-close.test.ts),
  // and the CI runner fails a file for any new core dump. The other lanes keep the cross-check.
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
