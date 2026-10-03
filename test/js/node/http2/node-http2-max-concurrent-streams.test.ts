// Works with both:
// - bun bd test test/js/node/http2/node-http2-max-concurrent-streams.test.ts
// - node --test test/js/node/http2/node-http2-max-concurrent-streams.test.ts
import assert from "node:assert";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import { Duplex } from "node:stream";
import { describe, test } from "node:test";
import tls from "node:tls";
import { format } from "node:util";

const keys = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
const tlsCert = {
  cert: fs.readFileSync(path.join(keys, "agent1-cert.pem"), "utf8"),
  key: fs.readFileSync(path.join(keys, "agent1-key.pem"), "utf8"),
};
const bunOnly = { skip: typeof Bun === "undefined" };

/** `test.each` of bun:test: one test for each row, and the row is the argument list of `body`. */
function each(rows: readonly unknown[], options: { skip?: boolean } = {}) {
  return (name: string, body: (...row: any[]) => unknown) => {
    for (const row of rows) {
      const args = Array.isArray(row) ? row : [row];
      const used = name.match(/%[sd]/g)?.length ?? 0;
      test(format(name, ...args.slice(0, used)), options, () => body(...args));
    }
  };
}

/** `describe.each` of bun:test. */
function describeEach(rows: readonly unknown[]) {
  return (name: string, body: (...row: any[]) => void) => {
    for (const row of rows) {
      const args = Array.isArray(row) ? row : [row];
      const used = name.match(/%[sd]/g)?.length ?? 0;
      describe(format(name, ...args.slice(0, used)), () => body(...args));
    }
  };
}

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
const DATA = 0x0;
const HEADERS = 0x1;
const PRIORITY = 0x2;
const RST_STREAM = 0x3;
const SETTINGS = 0x4;
const PING = 0x6;
const GOAWAY = 0x7;
const WINDOW_UPDATE = 0x8;
const CONTINUATION = 0x9;
const END_STREAM = 0x1;
const END_HEADERS = 0x4;
const ACK = 0x1;
const REFUSED_STREAM = http2.constants.NGHTTP2_REFUSED_STREAM;
const CANCEL = http2.constants.NGHTTP2_CANCEL;
const NO_ERROR = http2.constants.NGHTTP2_NO_ERROR;
const PROTOCOL_ERROR = http2.constants.NGHTTP2_PROTOCOL_ERROR;
const INTERNAL_ERROR = http2.constants.NGHTTP2_INTERNAL_ERROR;
const ENHANCE_YOUR_CALM = http2.constants.NGHTTP2_ENHANCE_YOUR_CALM;

type Frame = { type: number; flags: number; streamId: number; payload: Buffer };

function frame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header.writeUInt8(type, 3);
  header.writeUInt8(flags, 4);
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

// :method GET or POST, :scheme http, :path /, and a literal :authority. No dynamic table entry.
function requestBlock(method: "GET" | "POST"): Buffer {
  const authority = Buffer.from("localhost", "latin1");
  return Buffer.concat([Buffer.from([method === "POST" ? 0x83 : 0x82, 0x86, 0x84, 0x01, authority.length]), authority]);
}

/** An HPACK string literal without Huffman coding. */
function literal(text: string): Buffer {
  return Buffer.concat([Buffer.from([text.length]), Buffer.from(text, "latin1")]);
}

/** A complete request. */
const get = (streamId: number) => frame(HEADERS, END_STREAM | END_HEADERS, streamId, requestBlock("GET"));
/** A request whose body stays open. */
const upload = (streamId: number) => frame(HEADERS, END_HEADERS, streamId, requestBlock("POST"));
const endOfBody = (streamId: number) => frame(DATA, END_STREAM, streamId);
const cancel = (streamId: number) => frame(RST_STREAM, 0, streamId, u32(CANCEL));

/** A raw HTTP/2 client. It has no timers: a wait ends with a frame or with the end of the connection. */
class RawClient {
  frames: Frame[] = [];
  closed = false;
  #buffered = Buffer.alloc(0);
  #waiters: Array<{ matches: (f: Frame) => boolean; resolve: (f: Frame | null) => void }> = [];
  #opened = new Set<number>();

  socket: net.Socket;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on("error", () => {});
    socket.on("close", () => {
      this.closed = true;
      for (const waiter of this.#waiters.splice(0)) waiter.resolve(null);
    });
    socket.on("data", chunk => {
      this.#buffered = Buffer.concat([this.#buffered, chunk]);
      while (this.#buffered.length >= 9) {
        const length = this.#buffered.readUIntBE(0, 3);
        if (this.#buffered.length < 9 + length) break;
        const received: Frame = {
          type: this.#buffered.readUInt8(3),
          flags: this.#buffered.readUInt8(4),
          streamId: this.#buffered.readUInt32BE(5) & 0x7fffffff,
          payload: Buffer.from(this.#buffered.subarray(9, 9 + length)),
        };
        this.#buffered = this.#buffered.subarray(9 + length);
        this.frames.push(received);
        const index = this.#waiters.findIndex(waiter => waiter.matches(received));
        if (index !== -1) this.#waiters.splice(index, 1)[0].resolve(received);
      }
    });
  }

  static async connect(server: net.Server, secure = false): Promise<RawClient> {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as net.AddressInfo).port;
    const socket = secure
      ? tls.connect({ port, host: "127.0.0.1", ALPNProtocols: ["h2"], rejectUnauthorized: false })
      : net.connect(port, "127.0.0.1");
    await once(socket, secure ? "secureConnect" : "connect");
    const client = new RawClient(socket);
    socket.write(Buffer.concat([PREFACE, frame(SETTINGS, 0, 0)]));
    return client;
  }

  /** Resolves with the first frame that matches, or with null when the connection ended first. */
  waitFor(matches: (f: Frame) => boolean): Promise<Frame | null> {
    const existing = this.frames.find(matches);
    if (existing) return Promise.resolve(existing);
    if (this.closed) return Promise.resolve(null);
    return new Promise(resolve => this.#waiters.push({ matches, resolve }));
  }

  /** One write, so that the server reads the frames in one chunk. */
  send(...frames: Buffer[]) {
    for (const sent of frames) if (sent.readUInt8(3) === HEADERS) this.#opened.add(sent.readUInt32BE(5));
    this.socket.write(Buffer.concat(frames));
  }

  /** Resolves when each request has its response HEADERS or its RST_STREAM, or the session ended. */
  async answers() {
    for (const streamId of this.#opened) {
      await this.waitFor(
        f => f.type === GOAWAY || (f.streamId === streamId && (f.type === HEADERS || f.type === RST_STREAM)),
      );
    }
  }

  get(streamId: number) {
    this.send(get(streamId));
  }

  /** A request whose body stays open. */
  upload(streamId: number) {
    this.send(upload(streamId));
  }

  /** True when the server answered the PING. False when it sent GOAWAY or closed the connection. */
  async ping(tag: number): Promise<boolean> {
    const payload = Buffer.alloc(8);
    payload.writeUInt32BE(tag, 0);
    this.socket.write(frame(PING, 0, 0, payload));
    const answer = await this.waitFor(
      f => f.type === GOAWAY || (f.type === PING && (f.flags & ACK) !== 0 && f.payload.equals(payload)),
    );
    return answer?.type === PING;
  }

  goawayCodes(): number[] {
    return this.frames.filter(f => f.type === GOAWAY).map(f => f.payload.readUInt32BE(4));
  }

  resets(): Array<[number, number]> {
    return this.frames.filter(f => f.type === RST_STREAM).map(f => [f.streamId, f.payload.readUInt32BE(0)]);
  }
}

type Served = { handlers: number[]; sessionError?: string };
type OnStream = (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void;
type OnRequest = (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => void;

const odd = (count: number, first = 1) => Array.from({ length: count }, (_, i) => first + 2 * i);
const refused = (streamIds: number[]) => streamIds.map(streamId => [streamId, REFUSED_STREAM]);

/** Answers and keeps the stream open. */
const hold: OnStream = stream => {
  stream.respond({ ":status": 200 });
  stream.write("hello");
};
/** Answers and ends the response in the same turn. */
const finish: OnStream = stream => {
  stream.respond({ ":status": 200 });
  stream.end("ok");
};

/** The first answer to a request: the response HEADERS or a reset. */
const answered = (streamId: number) => (f: Frame) =>
  f.type === GOAWAY || ((f.type === HEADERS || f.type === RST_STREAM) && f.streamId === streamId);
/** The end of a response. */
const ended = (streamId: number) => (f: Frame) =>
  f.type === GOAWAY ||
  (f.type === RST_STREAM && f.streamId === streamId) ||
  ((f.type === DATA || f.type === HEADERS) && f.streamId === streamId && (f.flags & END_STREAM) !== 0);

/** Records the streams that reach `onStream`, and the error that ends a session. */
function record(
  source: http2.Http2Server | http2.Http2SecureServer | http2.ServerHttp2Session,
  served: Served,
  onStream: OnStream,
) {
  source.on("stream", (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
    served.handlers.push(stream.id!);
    stream.on("error", () => {});
    onStream(stream, headers);
  });
  if ("settings" in source) {
    source.on("error", (err: NodeJS.ErrnoException) => (served.sessionError = err.code));
  } else {
    source.on("sessionError", (err: NodeJS.ErrnoException) => (served.sessionError = err.code));
    source.on("session", session => session.on("error", () => {}));
  }
}

async function withClient<T>(server: net.Server, body: (client: RawClient) => Promise<T>, secure = false) {
  // A session that has ended does not listen to its socket. The reset of the client can still arrive.
  server.on("connection", socket => socket.on("error", () => {}));
  const client = await RawClient.connect(server, secure);
  try {
    return await body(client);
  } finally {
    client.socket.destroy();
    server.close();
  }
}

/** A server of the core API with its `options`, and a raw client on it. */
function withLimit<T>(
  options: http2.ServerOptions,
  onStream: OnStream,
  body: (client: RawClient, served: Served) => Promise<T>,
): Promise<T> {
  const served: Served = { handlers: [] };
  const server = http2.createServer(options);
  record(server, served, onStream);
  return withClient(server, client => body(client, served));
}

/** A server of the compatibility API that records the requests that reach `onRequest`. */
function compatServer(options: http2.ServerOptions, served: Served, onRequest: OnRequest) {
  const server = http2.createServer(options, (req, res) => {
    served.handlers.push(req.stream.id!);
    req.on("error", () => {});
    res.on("error", () => {});
    onRequest(req, res);
  });
  server.on("sessionError", (err: NodeJS.ErrnoException) => (served.sessionError = err.code));
  server.on("session", session => session.on("error", () => {}));
  return server;
}

/** The same as withLimit() with a request listener of the compatibility API. */
function withCompat<T>(
  options: http2.ServerOptions,
  onRequest: OnRequest,
  body: (client: RawClient, served: Served) => Promise<T>,
): Promise<T> {
  const served: Served = { handlers: [] };
  return withClient(compatServer(options, served, onRequest), client => body(client, served));
}

/** What the server did up to now. */
function seen(client: RawClient, served: Served) {
  return {
    handlers: served.handlers,
    answered: [...new Set(client.frames.filter(f => f.type === HEADERS).map(f => f.streamId))].sort((a, b) => a - b),
    resets: client.resets(),
    goaways: client.goawayCodes(),
    sessionError: served.sessionError,
  };
}

/** What the server did, read when it has answered a PING and every request, or ended the connection. */
async function outcome(client: RawClient, served: Served, tag = 1) {
  if (await client.ping(tag)) await client.answers();
  else if (!client.closed) await once(client.socket, "close");
  return seen(client, served);
}

const allServed = (streamIds: number[]) => ({
  handlers: streamIds,
  answered: streamIds,
  resets: [],
  goaways: [],
  sessionError: undefined,
});

/** Opens each request when the response to the request before it has ended. */
async function oneAtATime(client: RawClient, served: Served, count: number) {
  for (const streamId of odd(count)) {
    client.send(get(streamId));
    await client.waitFor(ended(streamId));
  }
  return outcome(client, served);
}

/** Opens `count` complete requests in one write. */
function inOneWrite(count: number) {
  return (client: RawClient, served: Served) => {
    client.send(...odd(count).map(get));
    return outcome(client, served);
  };
}

/** Answers and keeps the stream open, through the compatibility API. */
const holdResponse: OnRequest = (_req, res) => {
  res.writeHead(200);
  res.write("hello");
};

/** A server whose sessions read from a Duplex, so the bytes reach the parser through JS. */
function duplexFed(options: http2.ServerOptions, served: Served, onStream: OnStream) {
  return net.createServer(socket => {
    const duplex = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        socket.write(chunk, callback);
      },
      final(callback) {
        socket.end(callback);
      },
    });
    socket.on("data", chunk => duplex.push(chunk));
    socket.on("end", () => duplex.push(null));
    socket.on("error", () => {});
    record(http2.performServerHandshake(duplex, options), served, onStream);
  });
}

/** Every way to get a server session. Each one answers a request and keeps its stream open. */
const entryPoints: Array<
  [name: string, secure: boolean, listen: (options: http2.ServerOptions, served: Served) => net.Server]
> = [
  [
    "a server of the core API",
    false,
    (options, served) => {
      const server = http2.createServer(options);
      record(server, served, hold);
      return server;
    },
  ],
  ["a server of the compatibility API", false, (options, served) => compatServer(options, served, holdResponse)],
  [
    "a TLS server",
    true,
    (options, served) => {
      const server = http2.createSecureServer({ ...tlsCert, ...options });
      record(server, served, hold);
      return server;
    },
  ],
  ["performServerHandshake() over a Duplex", false, (options, served) => duplexFed(options, served, hold)],
];

const respondThenTrailers: OnStream = stream => {
  stream.respond({ ":status": 200 }, { waitForTrailers: true });
  stream.on("wantTrailers", () => stream.sendTrailers({ "x-checksum": "1" }));
  stream.end("ok");
};
const headersOnly: OnStream = stream => stream.respond({ ":status": 200 }, { endStream: true });
const endResponse: OnRequest = (_req, res) => {
  res.writeHead(200);
  res.end("ok");
};

// A request over the SETTINGS_MAX_CONCURRENT_STREAMS that the server advertised gets
// RST_STREAM(REFUSED_STREAM) and no 'stream' event (RFC 9113 5.1.2). A stream uses one slot of the
// limit from its HEADERS until both sides ended it or one side reset it. These tests pin every
// order in which a slot is taken and given back. None of them reaches a budget. Every expectation
// is what node v26.3.0 does. A test that says "Bun only" has no counterpart in node.
describe("the slots of SETTINGS_MAX_CONCURRENT_STREAMS", () => {
  const one = { settings: { maxConcurrentStreams: 1 } };

  test("limit 0 refuses every stream", async () => {
    const result = await withLimit({ settings: { maxConcurrentStreams: 0 } }, finish, inOneWrite(2));
    assert.deepStrictEqual(result, {
      handlers: [],
      answered: [],
      resets: refused([1, 3]),
      goaways: [],
      sessionError: undefined,
    });
  });

  test("requests in one write are refused while the first response waits for a later turn", async () => {
    const later: OnStream = (stream, headers) => void setImmediate(finish, stream, headers);
    const result = await withLimit(one, later, async (client, served) => {
      client.send(...odd(3).map(get));
      await client.waitFor(ended(1));
      return outcome(client, served);
    });
    assert.deepStrictEqual(result, {
      handlers: [1],
      answered: [1],
      resets: refused([3, 5]),
      goaways: [],
      sessionError: undefined,
    });
  });

  each(entryPoints)("requests over the limit in one write are refused by %s", async (_, secure, listen) => {
    const served: Served = { handlers: [] };
    const server = listen({ settings: { maxConcurrentStreams: 2 } }, served);
    assert.deepStrictEqual(await withClient(server, client => inOneWrite(5)(client, served), secure), {
      handlers: [1, 3],
      answered: [1, 3],
      resets: refused([5, 7, 9]),
      goaways: [],
      sessionError: undefined,
    });
  });

  describe("a slot is free again", () => {
    test("after both sides ended the stream", async () => {
      assert.deepStrictEqual(
        await withLimit(one, finish, (client, served) => oneAtATime(client, served, 5)),
        allServed(odd(5)),
      );
    });

    test("after a response that is only HEADERS", async () => {
      assert.deepStrictEqual(
        await withLimit(one, headersOnly, (client, served) => oneAtATime(client, served, 4)),
        allServed(odd(4)),
      );
    });

    test("after sendTrailers()", async () => {
      assert.deepStrictEqual(
        await withLimit(one, respondThenTrailers, (client, served) => oneAtATime(client, served, 4)),
        allServed(odd(4)),
      );
    });

    test("after res.end() of the compatibility API", async () => {
      assert.deepStrictEqual(
        await withCompat(one, endResponse, (client, served) => oneAtATime(client, served, 4)),
        allServed(odd(4)),
      );
    });

    // The body is larger than the stream window of the peer, so its end waits in the queue of
    // the session for a WINDOW_UPDATE.
    test("after the end of a response that waited for the window of the peer", async () => {
      const body = Buffer.alloc(100_000, "a");
      const large: OnStream = stream => {
        stream.respond({ ":status": 200 });
        stream.end(body);
      };
      const result = await withLimit(one, large, async (client, served) => {
        const received = (streamId: number) =>
          client.frames.reduce((n, f) => (f.type === DATA && f.streamId === streamId ? n + f.payload.length : n), 0);
        for (const streamId of odd(3)) {
          client.send(get(streamId));
          await client.waitFor(f => f.type === GOAWAY || received(streamId) >= 65_535);
          client.send(frame(WINDOW_UPDATE, 0, 0, u32(1 << 20)), frame(WINDOW_UPDATE, 0, streamId, u32(1 << 20)));
          await client.waitFor(ended(streamId));
        }
        return outcome(client, served);
      });
      assert.deepStrictEqual(result, allServed(odd(3)));
    });

    // The response ends first. The request ends in the same write as the next request.
    test("after the request ended, in one write with the next request", async () => {
      const answerAtOnce: OnStream = (stream, headers) => {
        stream.resume();
        finish(stream, headers);
      };
      const result = await withLimit(one, answerAtOnce, async (client, served) => {
        client.send(upload(1));
        for (const streamId of odd(4)) {
          await client.waitFor(ended(streamId));
          client.send(endOfBody(streamId), upload(streamId + 2));
        }
        await client.waitFor(ended(9));
        return outcome(client, served);
      });
      assert.deepStrictEqual(result, allServed(odd(5)));
    });

    // The server has answered and still writes when the reset arrives.
    function resetThenNextRequest(code: number, count: number) {
      return async (client: RawClient, served: Served) => {
        client.send(upload(1));
        for (const streamId of odd(count - 1)) {
          await client.waitFor(answered(streamId));
          client.send(frame(RST_STREAM, 0, streamId, u32(code)), upload(streamId + 2));
        }
        await client.waitFor(answered(2 * count - 1));
        return outcome(client, served);
      };
    }

    each([
      ["CANCEL", CANCEL],
      ["NO_ERROR", http2.constants.NGHTTP2_NO_ERROR],
      ["INTERNAL_ERROR", http2.constants.NGHTTP2_INTERNAL_ERROR],
      ["REFUSED_STREAM", REFUSED_STREAM],
    ])("after RST_STREAM(%s) from the peer, in one write with the next request", async (_, code) => {
      assert.deepStrictEqual(await withLimit(one, hold, resetThenNextRequest(code, 5)), allServed(odd(5)));
    });

    // Bun answers the reset of these streams with a reset of its own. Node does not.
    const withoutOwnResets = ({ resets, ...rest }: Awaited<ReturnType<typeof outcome>>) => ({
      ...rest,
      resets: resets.filter(([, code]) => code !== CANCEL),
    });

    test("after the peer reset a stream that waits for trailers, in one write with the next request", async () => {
      const waitForTrailers: OnStream = stream => {
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        stream.write("hello");
      };
      const result = await withLimit(one, waitForTrailers, resetThenNextRequest(CANCEL, 9));
      assert.deepStrictEqual(withoutOwnResets(result), allServed(odd(9)));
    });

    test("after the peer reset a request of the compatibility API, in one write with the next request", async () => {
      const result = await withCompat(one, holdResponse, resetThenNextRequest(CANCEL, 9));
      assert.deepStrictEqual(withoutOwnResets(result), allServed(odd(9)));
    });

    each([
      ["CANCEL", CANCEL],
      ["NO_ERROR", http2.constants.NGHTTP2_NO_ERROR],
    ])("after the server reset the stream with close(%s)", async (_, code) => {
      const reset: OnStream = stream => {
        stream.respond({ ":status": 200 });
        stream.close(code);
      };
      const result = await withLimit(one, reset, async (client, served) => {
        for (const streamId of odd(4)) {
          client.send(upload(streamId));
          await client.waitFor(f => f.type === GOAWAY || (f.type === RST_STREAM && f.streamId === streamId));
        }
        return outcome(client, served);
      });
      // The destroy that follows close() can write the RST_STREAM a second time.
      const resets = [...new Set(result.resets.map(([streamId, rstCode]) => `${streamId}:${rstCode}`))];
      assert.deepStrictEqual(
        { ...result, resets },
        {
          ...allServed(odd(4)),
          resets: odd(4).map(streamId => `${streamId}:${code}`),
        },
      );
    });

    // Bun only: these calls fail in Bun and the stream emits 'error'. Node accepts the first two,
    // throws for the third and resets the stream for the fourth.
    each(
      [
        ["a weight out of range", {}, (stream: any) => stream.respond({ ":status": 200 }, { weight: 0 })],
        ["a parent out of range", {}, (stream: any) => stream.respond({ ":status": 200 }, { parent: -1 })],
        ["options that are not an object", {}, (stream: any) => stream.respond({ ":status": 200 }, 1)],
        [
          "a header block over maxSendHeaderBlockLength",
          { maxSendHeaderBlockLength: 100 },
          (stream: any) => stream.respond({ ":status": 200, "x-large": Buffer.alloc(400, "a").toString() }),
        ],
      ],
      bunOnly,
    )("after respond() failed for %s", async (_, options, failingRespond) => {
      const failFirst: OnStream = (stream, headers) => {
        if (stream.id === 1) failingRespond(stream);
        else hold(stream, headers);
      };
      const result = await withLimit({ ...one, ...options }, failFirst, async (client, served) => {
        client.send(upload(1));
        await client.ping(1);
        client.send(upload(3));
        return { handlers: served.handlers, next: (await client.waitFor(answered(3)))?.type };
      });
      assert.deepStrictEqual(result, { handlers: [1, 3], next: HEADERS });
    });
  });

  // The limit of a session that starts with no limit, set before the first request arrives.
  each([
    [
      "session.settings() in the 'session' event",
      (server: http2.Http2Server) => {
        server.on("session", session => session.settings({ maxConcurrentStreams: 2 }));
      },
    ],
    [
      "server.updateSettings() before the connection",
      (server: http2.Http2Server) => {
        server.updateSettings({ maxConcurrentStreams: 2 });
      },
    ],
  ])("%s sets the limit for the first request", async (_, setLimit) => {
    const served: Served = { handlers: [] };
    const server = http2.createServer();
    setLimit(server);
    record(server, served, hold);
    const result = await withClient(server, client => inOneWrite(4)(client, served));
    assert.deepStrictEqual(result, {
      handlers: [1, 3],
      answered: [1, 3],
      resets: refused([5, 7]),
      goaways: [],
      sessionError: undefined,
    });
  });

  describe("session.settings()", () => {
    each([
      ["lowers", 100, 2, [1, 3], [5, 7, 9, 11]],
      ["raises", 1, 3, [1, 3, 5], [7]],
    ])("in a handler %s the limit for the next request of the same write", async (_, initial, next, served, over) => {
      const change: OnStream = (stream, headers) => {
        if (stream.id === 1) stream.session!.settings({ maxConcurrentStreams: next });
        hold(stream, headers);
      };
      const result = await withLimit(
        { settings: { maxConcurrentStreams: initial } },
        change,
        inOneWrite(served.length + over.length),
      );
      assert.deepStrictEqual(result, {
        handlers: served,
        answered: served,
        resets: refused(over),
        goaways: [],
        sessionError: undefined,
      });
    });

    test("keeps the open streams when it lowers the limit below their number", async () => {
      const lower: OnStream = (stream, headers) => {
        if (stream.id === 5) stream.session!.settings({ maxConcurrentStreams: 1 });
        hold(stream, headers);
      };
      const result = await withLimit({ settings: { maxConcurrentStreams: 5 } }, lower, async (client, served) => {
        client.send(upload(1), upload(3), upload(5), upload(7));
        await client.ping(1);
        client.send(cancel(1), cancel(3), upload(9));
        await client.ping(2);
        client.send(cancel(5), upload(11));
        return outcome(client, served, 3);
      });
      assert.deepStrictEqual(result, {
        handlers: [1, 3, 5, 11],
        answered: [1, 3, 5, 11],
        resets: refused([7, 9]),
        goaways: [],
        sessionError: undefined,
      });
    });
  });

  test("a trailer block on the one open stream is not a new stream", async () => {
    const trailers: number[] = [];
    const answerAfterBody: OnStream = (stream, headers) => {
      stream.on("trailers", () => trailers.push(stream.id!));
      stream.on("end", () => finish(stream, headers));
      stream.resume();
    };
    const result = await withLimit(one, answerAfterBody, async (client, served) => {
      const field = Buffer.concat([Buffer.from([0x00]), literal("x-checksum"), literal("1")]);
      client.send(
        upload(1),
        frame(DATA, 0, 1, Buffer.from("body")),
        frame(HEADERS, END_STREAM | END_HEADERS, 1, field),
      );
      await client.waitFor(ended(1));
      client.send(get(3));
      await client.waitFor(ended(3));
      return outcome(client, served);
    });
    assert.deepStrictEqual({ ...result, trailers }, { ...allServed([1, 3]), trailers: [1] });
  });

  // RFC 9113 5.1.2: a stream that the server pushed counts against the limit of the client.
  test("a pushed stream does not use a slot", async () => {
    const push: OnStream = (stream, headers) => {
      if (stream.id === 1) {
        for (let i = 0; i < 3; i++) {
          stream.pushStream({ ":path": `/pushed${i}` }, (err, pushed) => {
            if (err) return;
            pushed.on("error", () => {});
            hold(pushed, headers);
          });
        }
      }
      hold(stream, headers);
    };
    const result = await withLimit({ settings: { maxConcurrentStreams: 2 } }, push, async (client, served) => {
      client.send(get(1));
      await client.waitFor(answered(1));
      client.send(get(3), get(5));
      return outcome(client, served);
    });
    assert.deepStrictEqual(result, {
      handlers: [1, 3],
      answered: [1, 2, 3, 4, 6],
      resets: refused([5]),
      goaways: [],
      sessionError: undefined,
    });
  });

  // RFC 9113 4.3: the block of a refused stream changes the HPACK table of the connection.
  test("a field that a refused block added to the HPACK table is known to the next request", async () => {
    const fields: (string | string[] | undefined)[] = [];
    const recordField: OnStream = (stream, headers) => {
      fields.push(headers["x-bun-sync"]);
      hold(stream, headers);
    };
    const result = await withLimit(one, recordField, async (client, served) => {
      client.send(get(1));
      await client.waitFor(answered(1));
      // The refused block adds `x-bun-sync: 1` from its CONTINUATION frame. 0xbe is that entry.
      const insert = Buffer.concat([Buffer.from([0x40]), literal("x-bun-sync"), literal("1")]);
      client.send(
        frame(HEADERS, END_STREAM, 3, requestBlock("GET")),
        frame(CONTINUATION, END_HEADERS, 3, insert),
        cancel(1),
        frame(HEADERS, END_STREAM | END_HEADERS, 5, Buffer.concat([requestBlock("GET"), Buffer.from([0xbe])])),
      );
      return outcome(client, served);
    });
    assert.deepStrictEqual(
      { ...result, fields },
      {
        handlers: [1, 5],
        answered: [1, 5],
        resets: refused([3]),
        goaways: [],
        sessionError: undefined,
        fields: [undefined, "1"],
      },
    );
  });

  // A client that has not read the refusal keeps sending on the stream. A refused stream has
  // existed (RFC 9113 5.1), so these frames do not end the session, and they get no answer.
  test("the frames that follow a refused request in the same write get no answer", async () => {
    const result = await withLimit(one, hold, async (client, served) => {
      client.send(get(1));
      await client.waitFor(answered(1));
      const priority = Buffer.alloc(5);
      priority.writeUInt8(16, 4);
      client.send(
        upload(3),
        frame(DATA, 0, 3, Buffer.from("hello")),
        frame(WINDOW_UPDATE, 0, 3, u32(1000)),
        frame(PRIORITY, 0, 3, priority),
        cancel(3),
        cancel(1),
        get(5),
      );
      return outcome(client, served);
    });
    assert.deepStrictEqual(result, {
      handlers: [1, 5],
      answered: [1, 5],
      resets: refused([3]),
      goaways: [],
      sessionError: undefined,
    });
  });
});
