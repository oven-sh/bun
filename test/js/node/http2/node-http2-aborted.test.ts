/**
 * Http2Stream 'aborted' contract (https://nodejs.org/api/http2.html#event-aborted):
 * "The 'aborted' event will only be emitted if the Http2Stream writable side has not been ended."
 *
 * Most cases send a body larger than the peer's flow-control window. The raw peer takes one
 * window and then leaves, so the rest of the body (and END_STREAM, after end()) is still queued.
 *   write(body), then the peer leaves  -> 'aborted', stream.aborted === true
 *   end(body), then the peer leaves    -> no 'aborted', stream.aborted === false
 * A file response, a pushed stream on the client and the server stream of a HEAD request count
 * as ended: node ends their writable side when it creates them.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-aborted.test.ts
 *   node --test test/js/node/http2/node-http2-aborted.test.ts
 */
import assert from "node:assert";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import { duplexPair, type Duplex } from "node:stream";
import { finished } from "node:stream/promises";
import { describe, test } from "node:test";

const INITIAL_WINDOW = 65535;
const MAX_WINDOW = 2 ** 31 - 1;
const BODY = Buffer.alloc(INITIAL_WINDOW * 4, "a");
const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
const F = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PUSH_PROMISE: 5, PING: 6, GOAWAY: 7, WINDOW_UPDATE: 8 };
const END_STREAM = 0x1;
const END_HEADERS = 0x4;
const SETTINGS_INITIAL_WINDOW_SIZE = 4;
const { NGHTTP2_NO_ERROR, NGHTTP2_PROTOCOL_ERROR, NGHTTP2_INTERNAL_ERROR, NGHTTP2_CANCEL } = http2.constants;

// A case that passes under node and not yet under Bun. `bun test --todo` runs it.
const todoInBun = (reason: string) => ({ todo: process.versions.bun !== undefined && reason });

function frame(type: number, flags: number, streamId: number, payload = Buffer.alloc(0)) {
  const b = Buffer.alloc(9 + payload.length);
  b.writeUIntBE(payload.length, 0, 3);
  b[3] = type;
  b[4] = flags;
  b.writeUInt32BE(streamId, 5);
  payload.copy(b, 9);
  return b;
}

function u32(...values: number[]) {
  const b = Buffer.alloc(4 * values.length);
  values.forEach((value, i) => b.writeUInt32BE(value, 4 * i));
  return b;
}

// The header block of a request: HPACK "literal header field never indexed, new name".
function requestBlock(method: string) {
  const headers = [
    [":method", method],
    [":scheme", "http"],
    [":path", "/"],
    [":authority", "localhost"],
  ];
  const block = headers.flatMap(([k, v]) => [
    Buffer.from([0x10, k.length]),
    Buffer.from(k),
    Buffer.from([v.length]),
    Buffer.from(v),
  ]);
  return Buffer.concat(block);
}

const request = (streamId: number, method: string, flags: number) =>
  frame(F.HEADERS, flags | END_HEADERS, streamId, requestBlock(method));

const pushPromise = (streamId: number, promisedId: number) =>
  frame(F.PUSH_PROMISE, END_HEADERS, streamId, Buffer.concat([u32(promisedId), requestBlock("GET")]));

// A HEADERS frame for a response: ":status: 200" is entry 8 of the HPACK static table.
const response = (streamId: number) => frame(F.HEADERS, END_HEADERS, streamId, Buffer.from([0x88]));

const rstStream = (streamId: number, code: number = NGHTTP2_CANCEL) => frame(F.RST_STREAM, 0, streamId, u32(code));

type Frame = { type: number; streamId: number; payload: Buffer };

type RawPeer = {
  isServer: boolean;
  // The flow-control window this endpoint grants to the connection and to each stream.
  window?: number;
  onFrame?: (frame: Frame, socket: Duplex) => void;
};

/**
 * One raw h2c endpoint on `socket`. It answers SETTINGS and never sends WINDOW_UPDATE for a stream.
 * The returned promise settles with the id of the stream that sent DATA, once the node:http2 side
 * under test cannot send more of its body:
 *   - window INITIAL_WINDOW: a full window of DATA arrived. Flow control holds the rest.
 *   - window MAX_WINDOW: this endpoint stops reading at the first DATA frame. The socket holds the rest.
 */
function rawPeer(socket: Duplex, { isServer, window = INITIAL_WINDOW, onFrame }: RawPeer): Promise<number> {
  const bodyHeld = Promise.withResolvers<number>();
  let buf = Buffer.alloc(0);
  let prefaceSeen = !isServer;
  let received = 0;
  socket.on("error", () => {});
  // Fail the wait, not the tests that do not wait.
  bodyHeld.promise.catch(() => {});
  socket.on("close", () => bodyHeld.reject(new Error("the socket closed before the body was held")));
  socket.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    if (!prefaceSeen) {
      if (buf.length < PREFACE.length) return;
      prefaceSeen = true;
      buf = buf.subarray(PREFACE.length);
      const settings = window === INITIAL_WINDOW ? [] : [Buffer.from([0, SETTINGS_INITIAL_WINDOW_SIZE]), u32(window)];
      socket.write(frame(F.SETTINGS, 0, 0, Buffer.concat(settings)));
      if (window !== INITIAL_WINDOW) socket.write(frame(F.WINDOW_UPDATE, 0, 0, u32(window - INITIAL_WINDOW)));
    }
    while (buf.length >= 9) {
      const length = buf.readUIntBE(0, 3);
      if (buf.length < 9 + length) break;
      const type = buf[3];
      const flags = buf[4];
      const streamId = buf.readUInt32BE(5) & 0x7fffffff;
      const payload = buf.subarray(9, 9 + length);
      buf = buf.subarray(9 + length);
      if (type === F.SETTINGS && !(flags & 1)) {
        socket.write(frame(F.SETTINGS, 1, 0));
      } else if (type === F.DATA) {
        received += length;
        if (window !== INITIAL_WINDOW) socket.pause();
        if (window !== INITIAL_WINDOW || received === INITIAL_WINDOW) bodyHeld.resolve(streamId);
      }
      onFrame?.({ type, streamId, payload }, socket);
    }
  });
  return bodyHeld.promise;
}

// The ways a peer leaves a stream whose body it did not finish reading. `lastStreamId` is the
// highest stream id of the other side that the peer processed: the GOAWAY must carry it.
const peerLeaves: Record<string, (socket: Duplex, streamId: number, lastStreamId: number) => void> = {
  "RST_STREAM(CANCEL)": (socket, streamId) => socket.write(rstStream(streamId)),
  "GOAWAY(NO_ERROR) and FIN": (socket, _streamId, lastStreamId) =>
    socket.end(frame(F.GOAWAY, 0, 0, u32(lastStreamId, NGHTTP2_NO_ERROR))),
  "FIN": socket => socket.end(),
};

type Outcome = { events: string[]; aborted: boolean };

// Settles with what the stream emitted, and its `aborted` flag, when it closes.
function outcomeOf(stream: http2.Http2Stream, events: string[] = []): Promise<Outcome> {
  const { promise, resolve } = Promise.withResolvers<Outcome>();
  stream.on("aborted", () => events.push("aborted"));
  stream.on("error", (err: NodeJS.ErrnoException) => events.push(`error:${err.code}`));
  stream.on("close", () => {
    events.push("close");
    resolve({ events, aborted: stream.aborted });
  });
  return promise;
}

function listen(server: net.Server): Promise<number> {
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
}

// Connects a raw client to `server` and sends the preface, SETTINGS and `frames`. With `duplex`
// the connection is a stream.duplexPair(), so the session reads and writes through JS streams.
async function rawClient(server: net.Server, frames: Buffer[], duplex = false) {
  const sides: Duplex[] = [];
  if (duplex) {
    sides.push(...duplexPair());
    server.emit("connection", sides[1]);
  } else {
    sides.push(new net.Socket().connect(await listen(server), "127.0.0.1"));
    await once(sides[0], "connect");
  }
  const [socket] = sides;
  const windowExhausted = rawPeer(socket, { isServer: false });
  socket.write(Buffer.concat([PREFACE, frame(F.SETTINGS, 0, 0), ...frames]));
  // Both sides of a pair: node asserts when a pair loses one side with a write in flight.
  return { socket, windowExhausted, close: () => sides.forEach(side => side.destroy()) };
}

type RawSide = { socket: Duplex; bodyHeld: Promise<number> };

// A node:http2 client of a raw server. `run` gets the client and the raw side of its connection.
async function connect<T>(
  peer: Omit<RawPeer, "isServer">,
  run: (client: http2.ClientHttp2Session, raw: Promise<RawSide>) => Promise<T>,
) {
  const raw = Promise.withResolvers<RawSide>();
  const sockets: net.Socket[] = [];
  const server = net.createServer(socket => {
    sockets.push(socket);
    raw.resolve({ socket, bodyHeld: rawPeer(socket, { isServer: true, ...peer }) });
  });
  const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
  try {
    return await run(client, raw.promise);
  } finally {
    for (const socket of sockets) socket.destroy();
    client.destroy();
    server.close();
  }
}

describe("ServerHttp2Stream 'aborted'", () => {
  type Raw = { socket: Duplex; windowExhausted: Promise<number>; outcomes: Promise<Outcome>[] };

  // One raw client sends `frames`. `respond` gets each stream they open. `peer` runs once every
  // stream is delivered, with the raw socket and the outcome of each stream in order of arrival.
  async function serve<T>(
    frames: Buffer[],
    respond: (stream: http2.ServerHttp2Stream, events: string[]) => void,
    peer: (raw: Raw) => Promise<T>,
    duplex = false,
  ) {
    const count = frames.filter(f => f[3] === F.HEADERS).length;
    const outcomes: Promise<Outcome>[] = [];
    const delivered = Promise.withResolvers<void>();
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      const events: string[] = [];
      outcomes.push(outcomeOf(stream, events));
      respond(stream, events);
      if (outcomes.length === count) delivered.resolve();
    });
    const { socket, windowExhausted, close } = await rawClient(server, frames, duplex);
    try {
      await delivered.promise;
      return await peer({ socket, windowExhausted, outcomes });
    } finally {
      close();
      server.close();
    }
  }

  // A GET whose response the peer leaves after one window.
  function leftAfterOneWindow(how: string, respond: (stream: http2.ServerHttp2Stream) => void, duplex = false) {
    const leave = async ({ socket, windowExhausted, outcomes }: Raw) => {
      peerLeaves[how](socket, await windowExhausted, 0);
      return await outcomes[0];
    };
    return serve([request(1, "GET", END_STREAM)], respond, leave, duplex);
  }

  const respond = (stream: http2.ServerHttp2Stream, options?: http2.ServerStreamResponseOptions) =>
    stream.respond({ ":status": 200 }, options);

  const emitted = { events: ["aborted", "close"], aborted: true };
  const notEmitted = { events: ["close"], aborted: false };

  const respondOpen = (stream: http2.ServerHttp2Stream) => {
    respond(stream);
    stream.write(BODY);
  };
  const respondEnded = (stream: http2.ServerHttp2Stream) => {
    respond(stream);
    stream.end(BODY);
  };

  for (const how of Object.keys(peerLeaves)) {
    test(`write(body), then ${how}: emitted`, async () => {
      assert.deepStrictEqual(await leftAfterOneWindow(how, respondOpen), emitted);
    });

    test(`end(body), then ${how}: not emitted`, async () => {
      assert.deepStrictEqual(await leftAfterOneWindow(how, respondEnded), notEmitted);
    });
  }

  // The session reads and writes through JS streams: its socket is one side of a stream.duplexPair().
  test("write(body), then RST_STREAM(CANCEL) over a Duplex: emitted", async () => {
    assert.deepStrictEqual(await leftAfterOneWindow("RST_STREAM(CANCEL)", respondOpen, true), emitted);
  });

  test("end(body), then RST_STREAM(CANCEL) over a Duplex: not emitted", async () => {
    assert.deepStrictEqual(await leftAfterOneWindow("RST_STREAM(CANCEL)", respondEnded, true), notEmitted);
  });

  // node keeps a stream that was reset with NO_ERROR open until its writable side finishes.
  test("write(body), then RST_STREAM(NO_ERROR): emitted", async () => {
    const first = Promise.withResolvers<string>();
    const event = await serve(
      [request(1, "GET", END_STREAM)],
      stream => {
        for (const event of ["aborted", "close"]) stream.once(event, () => first.resolve(event));
        respond(stream);
        stream.write(BODY);
      },
      async ({ socket, windowExhausted }) => {
        socket.write(rstStream(await windowExhausted, NGHTTP2_NO_ERROR));
        return await first.promise;
      },
    );
    assert.strictEqual(event, "aborted");
  });

  // Other ways to end the writable side while the body is still queued.
  const ended: [string, string, (stream: http2.ServerHttp2Stream) => void][] = [
    [
      "write(body) and end()",
      "FIN",
      stream => {
        respond(stream);
        stream.write(BODY);
        stream.end();
      },
    ],
    [
      "end(body) with waitForTrailers",
      "RST_STREAM(CANCEL)",
      stream => {
        respond(stream, { waitForTrailers: true });
        stream.end(BODY);
      },
    ],
    // Any file larger than the window: this runtime's own executable.
    ["respondWithFile()", "RST_STREAM(CANCEL)", stream => stream.respondWithFile(process.execPath)],
    [
      "respondWithFD()",
      "FIN",
      stream => {
        const fd = fs.openSync(process.execPath, "r");
        stream.on("close", () => fs.closeSync(fd));
        stream.respondWithFD(fd);
      },
    ],
  ];
  for (const [name, how, respondEnded] of ended) {
    test(`${name}, then ${how}: not emitted`, async () => {
      assert.deepStrictEqual(await leftAfterOneWindow(how, respondEnded), notEmitted);
    });
  }

  // A closed socket drops the queued write. Its callback runs once every stream has its decision.
  test("write(body, () => end()), then FIN: emitted", async () => {
    const callback = Promise.withResolvers<void>();
    const calls: { aborted: boolean }[] = [];
    const outcome = await leftAfterOneWindow("FIN", stream => {
      respond(stream);
      stream.write(BODY, () => {
        calls.push({ aborted: stream.aborted });
        stream.end();
        callback.resolve();
      });
    });
    await callback.promise;
    assert.deepStrictEqual({ outcome, calls }, { outcome: emitted, calls: [{ aborted: true }] });
  });

  test("two streams whose dropped writes end each other, then FIN: emitted on both", async () => {
    const streams: http2.ServerHttp2Stream[] = [];
    const callbacks = Promise.withResolvers<void>();
    const calls: { aborted: boolean }[] = [];
    const outcomes = await serve(
      [request(1, "GET", END_STREAM), request(3, "GET", END_STREAM)],
      stream => {
        if (streams.push(stream) < 2) return;
        const [first, second] = streams;
        const endTheOther = (own: http2.ServerHttp2Stream, other: http2.ServerHttp2Stream) => () => {
          calls.push({ aborted: own.aborted });
          other.end();
          if (calls.length === 2) callbacks.resolve();
        };
        respond(first);
        respond(second);
        first.write(BODY, endTheOther(first, second));
        second.write(BODY, endTheOther(second, first));
      },
      async ({ socket, windowExhausted, outcomes }) => {
        await windowExhausted;
        socket.end();
        return await Promise.all(outcomes);
      },
    );
    await callbacks.promise;
    assert.deepStrictEqual(
      { outcomes, calls },
      { outcomes: [emitted, emitted], calls: [{ aborted: true }, { aborted: true }] },
    );
  });

  test("write(body, () => session.destroy()), then FIN: emitted", async () => {
    const sessionClosed = Promise.withResolvers<boolean>();
    const outcome = await serve(
      [request(1, "GET", END_STREAM)],
      stream => {
        const session = stream.session!;
        session.on("close", () => sessionClosed.resolve(stream.destroyed));
        respond(stream);
        stream.write(BODY, () => session.destroy());
      },
      async ({ socket, windowExhausted, outcomes }) => {
        await windowExhausted;
        socket.end();
        // A stream that its session leaves behind never closes.
        assert.strictEqual(await sessionClosed.promise, true);
        return await outcomes[0];
      },
    );
    assert.deepStrictEqual(outcome, emitted);
  });

  test("write(body, () => end()), then RST_STREAM(INTERNAL_ERROR): emitted", async () => {
    const outcome = await serve(
      [request(1, "GET", END_STREAM)],
      stream => {
        respond(stream);
        stream.write(BODY, () => stream.end());
      },
      async ({ socket, windowExhausted, outcomes }) => {
        socket.write(rstStream(await windowExhausted, NGHTTP2_INTERNAL_ERROR));
        return await outcomes[0];
      },
    );
    assert.deepStrictEqual(outcome, { events: ["aborted", "error:ERR_HTTP2_STREAM_ERROR", "close"], aborted: true });
  });

  test("close(CANCEL), then a crossing RST_STREAM(CANCEL): emitted once", async () => {
    const outcome = await serve(
      [request(1, "POST", 0)],
      stream => {
        respond(stream);
        stream.write(BODY);
        stream.on("data", () => stream.close(NGHTTP2_CANCEL));
      },
      async ({ socket, windowExhausted, outcomes }) => {
        await windowExhausted;
        // One segment: the reset is parsed right after the DATA frame whose listener closes.
        socket.write(Buffer.concat([frame(F.DATA, 0, 1, Buffer.from("x")), rstStream(1)]));
        return await outcomes[0];
      },
    );
    assert.deepStrictEqual(outcome, emitted);
  });

  // node decides before it ends the readable side. Ending it can run listeners that call end().
  test("destroy() that flushes a chunk to a 'data' listener that calls end(): emitted", async () => {
    const streams: http2.ServerHttp2Stream[] = [];
    const chunks: string[] = [];
    const outcome = await serve(
      // The second request arrives once both chunks of the first one are buffered.
      [
        request(1, "POST", 0),
        frame(F.DATA, 0, 1, Buffer.from("a")),
        frame(F.DATA, 0, 1, Buffer.from("b")),
        request(3, "GET", END_STREAM),
      ],
      stream => {
        respond(stream);
        streams.push(stream);
      },
      ({ outcomes }) => {
        const [stream] = streams;
        // destroy() hands the second chunk to this listener.
        stream.on("data", (chunk: Buffer) => (chunks.push(`${chunk}`) === 1 ? stream.destroy() : stream.end()));
        return outcomes[0];
      },
    );
    assert.deepStrictEqual({ outcome, chunks }, { outcome: emitted, chunks: ["a", "b"] });
  });

  for (const code of [NGHTTP2_NO_ERROR, NGHTTP2_CANCEL]) {
    test(`close(${code}) with a 'readable' listener that calls end() at the end of input: emitted`, async () => {
      const outcome = await serve(
        [request(1, "POST", 0), frame(F.DATA, 0, 1, Buffer.from("a"))],
        stream => {
          respond(stream);
          stream.on("readable", () => {
            if (stream.read() === null) stream.end();
            else stream.close(code);
          });
        },
        ({ outcomes }) => outcomes[0],
      );
      assert.deepStrictEqual(outcome, emitted);
    });
  }

  // node ends the writable side of a HEAD request's stream when it creates the stream.
  test("HEAD, then RST_STREAM(CANCEL) before respond(): not emitted", async () => {
    const outcome = await serve(
      [request(1, "HEAD", END_STREAM)],
      () => {},
      async ({ socket, outcomes }) => {
        socket.write(rstStream(1));
        return await outcomes[0];
      },
    );
    assert.deepStrictEqual(outcome, notEmitted);
  });

  test("HEAD, then close() before respond(): not emitted", async () => {
    const outcome = await serve(
      [request(1, "HEAD", END_STREAM)],
      stream => stream.close(),
      ({ outcomes }) => outcomes[0],
    );
    assert.deepStrictEqual(outcome, notEmitted);
  });

  // END_STREAM leaves on the HEADERS frame, and the request is already complete.
  for (const [name, status, options] of [
    ["respond(204)", 204, undefined],
    ["respond(200, { endStream: true })", 200, { endStream: true }],
  ] as const) {
    test(`a request body that ended, then ${name}: not emitted`, async () => {
      const outcome = await serve(
        [request(1, "POST", 0), frame(F.DATA, END_STREAM, 1, Buffer.from("x"))],
        (stream, events) => {
          stream.on("finish", () => events.push("finish"));
          stream.resume();
          stream.on("end", () => stream.respond({ ":status": status }, options));
        },
        ({ outcomes }) => outcomes[0],
      );
      assert.deepStrictEqual(outcome, { events: ["finish", "close"], aborted: false });
    });
  }
});

describe("Http2ServerRequest 'aborted'", () => {
  // The compat request forwards the event of its stream.
  // `leave`: the raw client resets the stream after one window of the response.
  async function serve(
    frames: Buffer[],
    handler: (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse, events: string[]) => void,
    { leave }: { leave: boolean },
  ) {
    const outcome = Promise.withResolvers<Outcome>();
    const server = http2.createServer((req, res) => {
      const events: string[] = [];
      req.on("aborted", () => events.push("aborted"));
      req.on("close", () => outcome.resolve({ events, aborted: req.aborted }));
      handler(req, res, events);
    });
    const { socket, windowExhausted, close } = await rawClient(server, frames);
    try {
      if (leave) socket.write(rstStream(await windowExhausted));
      return await outcome.promise;
    } finally {
      close();
      server.close();
    }
  }

  test("res.write(body), then RST_STREAM(CANCEL): emitted", async () => {
    const outcome = await serve([request(1, "GET", END_STREAM)], (_req, res) => res.write(BODY), {
      leave: true,
    });
    assert.deepStrictEqual(outcome, { events: ["aborted"], aborted: true });
  });

  test("res.end(body), then RST_STREAM(CANCEL): not emitted", async () => {
    const outcome = await serve([request(1, "GET", END_STREAM)], (_req, res) => res.end(BODY), {
      leave: true,
    });
    assert.deepStrictEqual(outcome, { events: [], aborted: false });
  });

  test("a request body that ended, then a 204: not emitted", async () => {
    const outcome = await serve(
      [request(1, "POST", 0), frame(F.DATA, END_STREAM, 1, Buffer.from("x"))],
      (req, res, events) => {
        req.resume();
        req.on("end", () => {
          res.writeHead(204);
          res.end(() => events.push("end callback"));
        });
      },
      { leave: false },
    );
    assert.deepStrictEqual(outcome, { events: ["end callback"], aborted: false });
  });
});

describe("ClientHttp2Stream 'aborted'", () => {
  // The client sends a request with a body. Once the raw server holds the rest of the body, `how`
  // says what leaves the request. With MAX_WINDOW the raw server answers the request first, so
  // the client has the window when it gets the response and sends the body then.
  async function upload(
    how: string,
    send: (req: http2.ClientHttp2Stream) => void,
    { method = "POST", window = INITIAL_WINDOW } = {},
  ) {
    const answered = window === MAX_WINDOW;
    const onFrame = ({ type, streamId }: Frame, socket: Duplex) =>
      void (answered && type === F.HEADERS && socket.write(response(streamId)));
    return await connect({ window, onFrame }, async (client, raw) => {
      const controller = new AbortController();
      const req = client.request({ ":method": method, ":path": "/" }, { endStream: false, signal: controller.signal });
      const outcome = outcomeOf(req);
      if (answered) req.on("response", () => send(req));
      else send(req);
      const { socket, bodyHeld } = await raw;
      const streamId = await bodyHeld;
      if (how === "signal.abort()") controller.abort();
      else if (how === "session.destroy()") client.destroy();
      else peerLeaves[how](socket, streamId, streamId);
      return await outcome;
    });
  }

  // Only the local abort destroys the stream with an error.
  const error = (how: string) => (how === "signal.abort()" ? ["error:ABORT_ERR"] : []);

  for (const how of [...Object.keys(peerLeaves), "signal.abort()"]) {
    test(`write(body), then ${how}: emitted`, async () => {
      assert.deepStrictEqual(await upload(how, req => req.write(BODY)), {
        events: ["aborted", ...error(how), "close"],
        aborted: true,
      });
    });

    test(`end(body), then ${how}: not emitted`, async () => {
      assert.deepStrictEqual(await upload(how, req => req.end(BODY)), {
        events: [...error(how), "close"],
        aborted: false,
      });
    });
  }

  // Only the server's stream of a HEAD request starts with its writable side ended.
  test("HEAD with endStream: false and write(body), then RST_STREAM(CANCEL): emitted", async () => {
    const outcome = await upload("RST_STREAM(CANCEL)", req => req.write(BODY), { method: "HEAD" });
    assert.deepStrictEqual(outcome, { events: ["aborted", "close"], aborted: true });
  });

  // The abort drops the queued write. Its callback runs once the stream has its decision.
  test("write(body, () => end()), then signal.abort(): emitted", async () => {
    const callback = Promise.withResolvers<void>();
    const calls: { aborted: boolean }[] = [];
    const outcome = await upload("signal.abort()", req => {
      req.write(BODY, () => {
        calls.push({ aborted: req.aborted });
        req.end();
        callback.resolve();
      });
    });
    await callback.promise;
    assert.deepStrictEqual(
      { outcome, calls },
      { outcome: { events: ["aborted", "error:ABORT_ERR", "close"], aborted: true }, calls: [{ aborted: true }] },
    );
  });

  test(
    "write(body, () => end()), then session.destroy(): emitted",
    todoInBun("session.destroy() decides one tick after the callback of the dropped write (#42717)"),
    async () => {
      const { events, aborted } = await upload("session.destroy()", req => req.write(BODY, () => req.end()));
      assert.deepStrictEqual({ emitted: events.includes("aborted"), aborted }, { emitted: true, aborted: true });
    },
  );

  test("end(body), then signal.abort(): finished() rejects with the abort error", async () => {
    let settled: Promise<string | undefined> | undefined;
    await upload("signal.abort()", req => {
      req.end(BODY);
      settled = finished(req).then(
        () => "finished",
        (err: NodeJS.ErrnoException) => err.code,
      );
    });
    assert.strictEqual(await settled, "ABORT_ERR");
  });

  test("request() from an 'aborted' listener after signal.abort() with 12 MiB queued: sent", async () => {
    const retried = Promise.withResolvers<number>();
    const onFrame = ({ type, streamId }: Frame) =>
      void (type === F.HEADERS && streamId !== 1 && retried.resolve(streamId));
    const streamId = await connect({ onFrame }, async (client, raw) => {
      const controller = new AbortController();
      const req = client.request({ ":method": "POST", ":path": "/" }, { signal: controller.signal });
      req.on("error", () => {});
      req.on("aborted", () => client.request({ ":path": "/retry" }).on("error", retried.reject));
      req.write(Buffer.alloc(12 * 1024 * 1024, "a"));
      const { bodyHeld } = await raw;
      await bodyHeld;
      controller.abort();
      return await retried.promise;
    });
    assert.strictEqual(streamId, 3);
  });

  describe("a body that the socket holds", () => {
    // Larger than the send buffer and the receive buffer of a loopback connection together.
    const body = Buffer.alloc(32 * 1024 * 1024, "a");
    const held = (send: (req: http2.ClientHttp2Stream) => void) =>
      upload("signal.abort()", send, { window: MAX_WINDOW });

    test("write(body), then signal.abort(): emitted", async () => {
      assert.deepStrictEqual(await held(req => req.write(body)), {
        events: ["aborted", "error:ABORT_ERR", "close"],
        aborted: true,
      });
    });

    test("write(body) and end(), then signal.abort(): not emitted", async () => {
      const outcome = await held(req => {
        req.write(body);
        req.end();
      });
      assert.deepStrictEqual(outcome, { events: ["error:ABORT_ERR", "close"], aborted: false });
    });

    test(
      "write(body, () => end()), then signal.abort(): emitted",
      todoInBun("a write completes when the socket buffers it, so end() runs before the abort"),
      async () => {
        const outcome = await held(req => req.write(body, () => req.end()));
        assert.deepStrictEqual(outcome, { events: ["aborted", "error:ABORT_ERR", "close"], aborted: true });
      },
    );
  });

  describe("waitForTrailers", () => {
    // The request has its id, so end(chunk) hands the chunk over at once.
    async function endChunk(onWantTrailers: (req: http2.ClientHttp2Stream, controller: AbortController) => void) {
      return await connect({}, async client => {
        const controller = new AbortController();
        const options = { waitForTrailers: true, signal: controller.signal };
        const req = client.request({ ":method": "POST", ":path": "/" }, options);
        const outcome = outcomeOf(req);
        req.on("wantTrailers", () => onWantTrailers(req, controller));
        await once(req, "ready");
        req.end("x");
        return await outcome;
      });
    }

    test("end(chunk), then close() from 'wantTrailers': not emitted", async () => {
      assert.deepStrictEqual(await endChunk(req => req.close()), { events: ["close"], aborted: false });
    });

    test("end(chunk), then destroy(err) from 'wantTrailers' and signal.abort(): not emitted", async () => {
      const outcome = await endChunk((req, controller) => {
        req.destroy(Object.assign(new Error("stop"), { code: "E_STOP" }));
        // The stream is destroyed, and its reset is not sent yet.
        process.nextTick(() => controller.abort());
      });
      assert.deepStrictEqual(outcome, { events: ["error:E_STOP", "close"], aborted: false });
    });
  });

  // node ends the writable side of a request that has no body before it submits the request.
  describe("a request that nghttp2 refuses", () => {
    // A server resets these requests with PROTOCOL_ERROR. Bun's client does not send them.
    const refuse = ({ type, streamId }: Frame, socket: Duplex) =>
      void (type === F.HEADERS && socket.write(rstStream(streamId, NGHTTP2_PROTOCOL_ERROR)));
    const refused = (headers: http2.OutgoingHttpHeaders) =>
      connect({ onFrame: refuse }, client => outcomeOf(client.request(headers)));

    test("GET with a space in :path: not emitted", async () => {
      assert.deepStrictEqual(await refused({ ":path": "/a b" }), {
        events: ["error:ERR_HTTP2_STREAM_ERROR", "close"],
        aborted: false,
      });
    });

    test("GET with content-length: not emitted", async () => {
      assert.deepStrictEqual(await refused({ ":path": "/", "content-length": "1" }), {
        events: ["error:ERR_HTTP2_STREAM_ERROR", "close"],
        aborted: false,
      });
    });

    test("POST with a space in :path: emitted", async () => {
      assert.deepStrictEqual(await refused({ ":method": "POST", ":path": "/a b" }), {
        events: ["aborted", "error:ERR_HTTP2_STREAM_ERROR", "close"],
        aborted: true,
      });
    });

    test("GET when no stream id is left: not emitted", async () => {
      const outcome = await connect({}, async client => {
        await once(client, "connect");
        // The next request takes the last id. @types/node does not declare the method.
        (client as unknown as { setNextStreamID(id: number): void }).setNextStreamID(2 ** 31 - 1);
        client.request({ ":path": "/" }).on("error", () => {});
        return await outcomeOf(client.request({ ":path": "/" }));
      });
      assert.deepStrictEqual(outcome, { events: ["error:ERR_HTTP2_OUT_OF_STREAMS", "close"], aborted: false });
    });
  });
});

// node ends the writable side of a pushed stream on the client when it creates the stream.
describe("pushed ClientHttp2Stream 'aborted'", () => {
  type Pushed = { client: http2.ClientHttp2Stream; server: http2.ServerHttp2Stream; events: string[] };

  // A server pushes one stream with a body that the client does not read, so END_STREAM cannot
  // get to the client. `act` runs once both ends have their side of the stream.
  async function push<T>(act: (pushed: Pushed) => T | Promise<T>) {
    const events: string[] = [];
    const serverSide = Promise.withResolvers<http2.ServerHttp2Stream>();
    const clientSide = Promise.withResolvers<http2.ClientHttp2Stream>();
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.pushStream({ ":path": "/pushed" }, (err, pushed) => {
        if (err) return serverSide.reject(err);
        pushed.on("error", () => {});
        pushed.respond({ ":status": 200 });
        pushed.write(BODY);
        serverSide.resolve(pushed);
      });
      stream.respond({ ":status": 200 });
      stream.write("main");
    });
    const client = http2.connect(`http://127.0.0.1:${await listen(server)}`);
    try {
      client.on("stream", pushed => {
        pushed.on("aborted", () => events.push("aborted"));
        pushed.on("error", (err: NodeJS.ErrnoException) => events.push(`error:${err.code}`));
        pushed.on("close", () => events.push("close"));
        clientSide.resolve(pushed);
      });
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      req.resume();
      return await act({ client: await clientSide.promise, server: await serverSide.promise, events });
    } finally {
      client.destroy();
      server.close();
    }
  }

  test("RST_STREAM(CANCEL) from the server: not emitted", async () => {
    const outcome = await push(async pushed => {
      const closed = once(pushed.client, "close");
      pushed.server.close(NGHTTP2_CANCEL);
      await closed;
      return { events: pushed.events, aborted: pushed.client.aborted };
    });
    assert.deepStrictEqual(outcome, { events: ["close"], aborted: false });
  });

  test("close(CANCEL) on the client: not emitted, one RST_STREAM", async () => {
    const resets: number[] = [];
    const pinged = Promise.withResolvers<void>();
    const onFrame = ({ type, streamId, payload }: Frame, socket: Duplex) => {
      // The raw server promises stream 2 and starts its response.
      if (type === F.HEADERS) socket.write(Buffer.concat([pushPromise(streamId, 2), response(2)]));
      else if (type === F.RST_STREAM) resets.push(payload.readUInt32BE(0));
      else if (type === F.PING) pinged.resolve();
    };
    const outcome = await connect({ onFrame }, async client => {
      client.request({ ":path": "/" }).on("error", () => {});
      const [pushed] = (await once(client, "stream")) as [http2.ClientHttp2Stream];
      const events: string[] = [];
      pushed.on("aborted", () => events.push("aborted"));
      const closed = once(pushed, "close");
      pushed.close(NGHTTP2_CANCEL);
      await closed;
      // This PING leaves after every reset that close() and the destroy of the stream queued.
      setImmediate(() => client.ping(() => {}));
      await pinged.promise;
      return { events, aborted: pushed.aborted, resets };
    });
    assert.deepStrictEqual(outcome, { events: [], aborted: false, resets: [NGHTTP2_CANCEL] });
  });
});
