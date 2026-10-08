/**
 * A body that never left the process must not read as written.
 *
 * The peer in these tests never opens the flow-control window, so a 1 MB body stops after one
 * window (65535 bytes) and the rest waits in the sender's queue. Then the stream ends. Every
 * write callback of the dropped body gets an error, 'finish' does not fire, and
 * `pipeline()` / `finished()` reject. A request that has no stream id yet follows the same rule.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-dropped-write.test.ts
 *   node --test test/js/node/http2/node-http2-dropped-write.test.ts
 */
import assert from "node:assert";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import { Duplex, Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { describe, test } from "node:test";

const { NGHTTP2_NO_ERROR, NGHTTP2_INTERNAL_ERROR, NGHTTP2_REFUSED_STREAM, NGHTTP2_CANCEL } = http2.constants;
const FRAME = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PING: 6, GOAWAY: 7, WINDOW_UPDATE: 8 };
const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
// The initial flow-control window of a stream and of a connection (RFC 9113 section 6.9.2).
const WINDOW = 65535;
const MB = Buffer.alloc(1 << 20, 97);
const isBun = typeof process.versions.bun === "string";

function frame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)) {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header[3] = type;
  header[4] = flags;
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}
function uint32(...values: number[]) {
  const buffer = Buffer.alloc(4 * values.length);
  values.forEach((value, i) => buffer.writeUInt32BE(value, 4 * i));
  return buffer;
}
// HPACK "literal header field never indexed, new name": no table state on either side.
function headerBlock(headers: [string, string][]) {
  return Buffer.concat(
    headers.map(([name, value]) =>
      Buffer.concat([
        Buffer.from([0x10, name.length]),
        Buffer.from(name),
        Buffer.from([value.length]),
        Buffer.from(value),
      ]),
    ),
  );
}
/** Calls `onFrame` for each whole frame that `socket` receives after the first `skip` bytes. */
function readFrames(
  socket: net.Socket,
  skip: number,
  onFrame: (type: number, flags: number, streamId: number, payload: Buffer) => void,
) {
  let buffered = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    if (skip > 0) {
      if (buffered.length < skip) return;
      buffered = buffered.subarray(skip);
      skip = 0;
    }
    while (buffered.length >= 9) {
      const length = buffered.readUIntBE(0, 3);
      if (buffered.length < 9 + length) break;
      const payload = buffered.subarray(9, 9 + length);
      const [type, flags, streamId] = [buffered[3], buffered[4], buffered.readUInt32BE(5) & 0x7fffffff];
      buffered = buffered.subarray(9 + length);
      onFrame(type, flags, streamId, payload);
    }
  });
}
function windowUpdates(streamId: number, increment: number) {
  const payload = uint32(increment);
  return Buffer.concat([frame(FRAME.WINDOW_UPDATE, 0, 0, payload), frame(FRAME.WINDOW_UPDATE, 0, streamId, payload)]);
}
function listen(server: net.Server): Promise<number> {
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
}
/** Resolves on 'close'. Unlike `events.once`, an 'error' event does not reject it. */
function closeOf(stream: http2.Http2Stream) {
  return new Promise<void>(resolve => stream.once("close", () => resolve()));
}
/** Event-loop turns. A cancelled write calls back at most two turns after 'close'. */
async function turns(count: number) {
  for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve));
}
const codeOf = (error: unknown) => (error ? ((error as NodeJS.ErrnoException).code ?? (error as Error).message) : "ok");

interface RawPeer {
  port: number;
  /** Resolves when the peer holds one full window of DATA: the sender cannot send more. */
  windowFull: Promise<{ socket: net.Socket; streamId: number }>;
  /** Resolves with the size of the request body when the request ends. */
  bodyEnd: Promise<number>;
  close(): void;
}
/**
 * A raw h2c server. It accepts every request. With `grant` it opens the window as the body
 * arrives and answers 200 when the request ends. Without it the body stops after one window.
 * `onHeaders` answers a request with frames of its own.
 */
async function rawServer({
  grant = false,
  settings = Buffer.alloc(0),
  onHeaders = undefined as undefined | ((socket: net.Socket, streamId: number) => void),
} = {}): Promise<RawPeer> {
  const { promise: windowFull, resolve: full } = Promise.withResolvers<{ socket: net.Socket; streamId: number }>();
  const { promise: bodyEnd, resolve: ended } = Promise.withResolvers<number>();
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.write(frame(FRAME.SETTINGS, 0, 0, settings));
    let received = 0;
    readFrames(socket, PREFACE.length, (type, flags, streamId, payload) => {
      if (type === FRAME.SETTINGS && !(flags & 1)) socket.write(frame(FRAME.SETTINGS, 1, 0));
      else if (type === FRAME.PING && !(flags & 1)) socket.write(frame(FRAME.PING, 1, 0, payload));
      else if (type === FRAME.HEADERS) onHeaders?.(socket, streamId);
      else if (type === FRAME.DATA) {
        received += payload.length;
        if (!grant) {
          if (received === WINDOW) full({ socket, streamId });
          return;
        }
        if (payload.length > 0) socket.write(windowUpdates(streamId, payload.length));
        if (flags & 1) {
          socket.write(frame(FRAME.HEADERS, 0x5, streamId, headerBlock([[":status", "200"]])));
          ended(received);
        }
      }
    });
  });
  const port = await listen(server);
  return {
    port,
    windowFull,
    bodyEnd,
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}
/** A session over a JS stream: it feeds the bytes of a TCP socket to the session from JS. */
function connectOverDuplex(port: number) {
  const socket = net.connect(port, "127.0.0.1");
  const transport = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      socket.write(chunk, callback);
    },
    final(callback) {
      socket.end();
      callback();
    },
  });
  socket.on("data", chunk => transport.push(chunk));
  socket.on("end", () => transport.push(null));
  socket.on("error", () => {});
  socket.on("close", () => transport.destroy());
  return http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => transport });
}
const connectOverTcp = (port: number) => http2.connect(`http://127.0.0.1:${port}`);

describe("client: the stream ends with DATA frames still queued", () => {
  type Context = { session: http2.ClientHttp2Session; stream: http2.ClientHttp2Stream; socket: net.Socket };
  const mine = Object.assign(new Error("mine"), { code: "MINE" });
  // [name, what ends the stream, the code of the two buffered write callbacks, the stream's 'error' events]
  const ways: [string, (context: Context) => void, string, string[]][] = [
    [
      "the peer sends RST_STREAM",
      ({ socket }) => socket.write(frame(FRAME.RST_STREAM, 0, 1, uint32(NGHTTP2_REFUSED_STREAM))),
      "ERR_HTTP2_STREAM_ERROR",
      ["ERR_HTTP2_STREAM_ERROR"],
    ],
    [
      "the peer sends RST_STREAM(CANCEL)",
      ({ socket }) => socket.write(frame(FRAME.RST_STREAM, 0, 1, uint32(NGHTTP2_CANCEL))),
      "ECANCELED",
      [],
    ],
    [
      "the peer sends GOAWAY",
      ({ socket }) => socket.write(frame(FRAME.GOAWAY, 0, 0, uint32(1, NGHTTP2_INTERNAL_ERROR))),
      "ERR_HTTP2_SESSION_ERROR",
      ["ERR_HTTP2_SESSION_ERROR"],
    ],
    ["the peer closes the connection", ({ socket }) => socket.end(), "ECANCELED", []],
    ["the peer resets the connection", ({ socket }) => socket.resetAndDestroy(), "ECONNRESET", ["ECONNRESET"]],
    ["stream.close(NGHTTP2_CANCEL)", ({ stream }) => stream.close(NGHTTP2_CANCEL), "ECANCELED", []],
    ["stream.destroy()", ({ stream }) => stream.destroy(), "ECANCELED", []],
    ["stream.destroy(error)", ({ stream }) => stream.destroy(mine), "MINE", ["MINE"]],
    ["session.destroy(error)", ({ session }) => session.destroy(mine), "MINE", ["MINE"]],
  ];

  /**
   * Holds one write in the session's queue and two behind it in the Writable, ends the stream
   * with `act`, and returns what the three write callbacks and the stream's events said.
   */
  async function dropQueuedWrites(
    connect: (port: number) => http2.ClientHttp2Session,
    act: (context: Context) => void,
  ) {
    const peer = await rawServer();
    const session = connect(peer.port);
    try {
      session.on("error", () => {});
      await once(session, "connect");
      const stream = session.request({ ":method": "POST", ":path": "/" });
      const said: string[] = [];
      const events: string[] = [];
      stream.on("error", error => events.push(codeOf(error)));
      stream.on("finish", () => events.push("finish"));
      stream.on("drain", () => events.push("drain"));
      const closed = closeOf(stream);
      const { promise: allSaid, resolve } = Promise.withResolvers<void>();
      const callback = (index: number) => (error?: Error | null) => {
        said[index] = said[index] === undefined ? codeOf(error) : "twice";
        if (error && index === 0) {
          // The write that was in flight: node's ErrnoException of UV_ECANCELED.
          assert.strictEqual(error.message, "write ECANCELED");
          assert.strictEqual((error as NodeJS.ErrnoException).syscall, "write");
          assert.ok((error as NodeJS.ErrnoException).errno! < 0);
          assert.strictEqual(stream.destroyed, true);
        }
        if (Object.keys(said).length === 3) resolve();
      };
      // The first write goes to the session alone. The other two wait behind it in the Writable.
      stream.write(MB, callback(0));
      const { socket } = await peer.windowFull;
      stream.write(MB, callback(1));
      stream.write(MB, callback(2));
      assert.deepStrictEqual(said, []);

      act({ session, stream, socket });
      await closed;
      await Promise.race([allSaid, turns(10)]);
      await turns(2);
      return { said, events, errored: codeOf(stream.errored) };
    } finally {
      session.destroy();
      peer.close();
    }
  }

  for (const [name, act, code, errors] of ways) {
    test(name, async () => {
      const { said, events } = await dropQueuedWrites(connectOverTcp, act);
      assert.deepStrictEqual({ said, events }, { said: ["ECANCELED", code, code], events: errors });
    });
  }

  // node gives the stream no error here. Bun gives it ERR_HTTP2_STREAM_CANCEL. The writes that
  // waited in the Writable carry the error of the stream in both.
  test("session.destroy()", async () => {
    const { said, events, errored } = await dropQueuedWrites(connectOverTcp, ({ session }) => session.destroy());
    assert.deepStrictEqual(said, ["ECANCELED", errored, errored]);
    assert.deepStrictEqual(events, errored === "ECANCELED" ? [] : [errored]);
  });

  test("the peer sends RST_STREAM to a session over a JS stream", async () => {
    const { said, events } = await dropQueuedWrites(connectOverDuplex, ({ socket }) =>
      socket.write(frame(FRAME.RST_STREAM, 0, 1, uint32(NGHTTP2_REFUSED_STREAM))),
    );
    assert.deepStrictEqual(
      { said, events },
      { said: ["ECANCELED", "ERR_HTTP2_STREAM_ERROR", "ERR_HTTP2_STREAM_ERROR"], events: ["ERR_HTTP2_STREAM_ERROR"] },
    );
  });

  test("three writes in one tick", async () => {
    const peer = await rawServer();
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      await once(session, "connect");
      const stream = session.request({ ":method": "POST", ":path": "/" });
      const said: string[] = [];
      stream.on("error", () => {});
      const { promise: allSaid, resolve } = Promise.withResolvers<void>();
      for (let i = 0; i < 3; i++) {
        stream.write(MB, error => {
          said.push(error ? "failed" : "ok");
          if (said.length === 3) resolve();
        });
      }
      await peer.windowFull;
      assert.deepStrictEqual(said, []);
      const closed = closeOf(stream);
      stream.destroy();
      await closed;
      await Promise.race([allSaid, turns(10)]);
      assert.deepStrictEqual(said, ["failed", "failed", "failed"]);
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // The ways of asking whether an upload arrived, after a reset cut it.
  const asks: [string, (stream: http2.ClientHttp2Stream) => Promise<string>][] = [
    [
      "stream.write(chunk, callback)",
      stream => new Promise(resolve => stream.write(MB, error => resolve(codeOf(error)))),
    ],
    [
      "stream.end(chunk, callback)",
      stream => new Promise(resolve => stream.end(MB, (error?: Error) => resolve(codeOf(error)))),
    ],
    [
      "'finish' or 'close', whichever is first",
      stream =>
        new Promise(resolve => {
          stream.once("finish", () => resolve("ok"));
          stream.once("close", () => resolve("closed"));
          stream.end(MB);
        }),
    ],
    ["pipeline(source, stream)", stream => pipeline(Readable.from([MB]), stream).then(() => "ok", codeOf)],
    ["finished(stream)", stream => (stream.end(MB), finished(stream).then(() => "ok", codeOf))],
  ];
  for (const [name, ask] of asks) {
    test(`${name} fails when the peer resets the connection`, async () => {
      const peer = await rawServer();
      const session = connectOverTcp(peer.port);
      try {
        session.on("error", () => {});
        await once(session, "connect");
        const stream = session.request({ ":method": "POST", ":path": "/" });
        stream.on("error", () => {});
        const answer = ask(stream);
        const { socket } = await peer.windowFull;
        socket.resetAndDestroy();
        assert.notStrictEqual(await answer, "ok");
      } finally {
        session.destroy();
        peer.close();
      }
    });
  }

  test("a write made from 'aborted', after the peer reset the stream, fails", async () => {
    const peer = await rawServer({
      onHeaders: (socket, streamId) => socket.write(frame(FRAME.RST_STREAM, 0, streamId, uint32(NGHTTP2_CANCEL))),
    });
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      await once(session, "connect");
      const stream = session.request({ ":method": "POST", ":path": "/" });
      stream.on("error", () => {});
      const said: string[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();
      stream.once("aborted", () => {
        stream.write("late", error => {
          said.push(codeOf(error));
          resolve();
        });
      });
      await closeOf(stream);
      await Promise.race([promise, turns(10)]);
      await turns(2);
      assert.strictEqual(said.length, 1);
      assert.notStrictEqual(said[0], "ok");
    } finally {
      session.destroy();
      peer.close();
    }
  });

  test("control: queued writes that the peer lets through call back once, with no error", async () => {
    const peer = await rawServer({ grant: true });
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      await once(session, "connect");
      const stream = session.request({ ":method": "POST", ":path": "/" });
      stream.on("error", () => {});
      stream.resume();
      const said: string[] = [];
      const chunk = MB.subarray(0, 3 * WINDOW);
      for (let i = 0; i < 3; i++) stream.write(chunk, error => said.push(codeOf(error)));
      stream.end();
      assert.strictEqual(await peer.bodyEnd, 3 * chunk.length);
      await closeOf(stream);
      assert.deepStrictEqual(said, ["ok", "ok", "ok"]);
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // The chunk is on the wire when destroy() runs: that write is done, not cancelled.
  for (const [name, connect] of [
    ["a TCP socket", connectOverTcp],
    ["a JS stream", connectOverDuplex],
  ] as const) {
    test(`a write that left stays done when destroy() follows in the same tick, over ${name}`, async () => {
      const peer = await rawServer({ grant: true });
      const session = connect(peer.port);
      try {
        session.on("error", () => {});
        await once(session, "connect");
        const stream = session.request({ ":method": "POST", ":path": "/" });
        stream.on("error", () => {});
        const said: string[] = [];
        const closed = closeOf(stream);
        stream.write("chunk", error => said.push(codeOf(error)));
        stream.destroy();
        await closed;
        await turns(4);
        assert.deepStrictEqual(said, ["ok"]);
      } finally {
        session.destroy();
        peer.close();
      }
    });
  }
});

describe("server: the client leaves with DATA frames still queued", () => {
  /**
   * A raw h2c client: one request with no body. With `grant` it opens the window as the
   * response arrives. Without it the response body stops after one window.
   */
  async function rawRequest(port: number, { method = "GET", grant = false } = {}) {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    const { promise: windowFull, resolve: full } = Promise.withResolvers<void>();
    const { promise: bodyEnd, resolve: ended } = Promise.withResolvers<number>();
    let received = 0;
    readFrames(socket, 0, (type, flags, streamId, payload) => {
      if (type === FRAME.SETTINGS && !(flags & 1)) socket.write(frame(FRAME.SETTINGS, 1, 0));
      else if (type === FRAME.HEADERS && flags & 1) ended(received);
      else if (type === FRAME.DATA) {
        received += payload.length;
        if (grant && payload.length > 0) socket.write(windowUpdates(streamId, payload.length));
        if (!grant && received === WINDOW) full();
        if (flags & 1) ended(received);
      }
    });
    await once(socket, "connect");
    const request = headerBlock([
      [":method", method],
      [":scheme", "http"],
      [":path", "/"],
      [":authority", "localhost"],
    ]);
    socket.write(Buffer.concat([PREFACE, frame(FRAME.SETTINGS, 0, 0), frame(FRAME.HEADERS, 0x5, 1, request)]));
    return { socket, windowFull, bodyEnd };
  }
  const leaves: [string, (socket: net.Socket) => void][] = [
    ["cancels the stream", socket => socket.write(frame(FRAME.RST_STREAM, 0, 1, uint32(NGHTTP2_CANCEL)))],
    ["destroys its session", socket => socket.end(frame(FRAME.GOAWAY, 0, 0, uint32(0, NGHTTP2_NO_ERROR)))],
    ["resets the connection", socket => socket.resetAndDestroy()],
  ];
  type Say = (answer: string) => void;
  // [name, how the server answers, the code it hears for each way of leaving]
  const answers: [string, (stream: http2.ServerHttp2Stream, say: Say) => void, string[]][] = [
    [
      "stream.write(chunk, callback)",
      (stream, say) => {
        stream.respond({ ":status": 200 });
        stream.write(MB, error => say(codeOf(error)));
      },
      ["ECANCELED", "ECANCELED", "ECANCELED"],
    ],
    [
      "stream.end(chunk, callback)",
      (stream, say) => {
        stream.respond({ ":status": 200 });
        stream.end(MB, (error?: Error) => say(codeOf(error)));
      },
      ["ECANCELED", "ECANCELED", "ECONNRESET"],
    ],
    [
      "pipeline(source, stream)",
      (stream, say) => {
        stream.respond({ ":status": 200 });
        pipeline(Readable.from([MB]), stream).then(
          () => say("ok"),
          error => say(codeOf(error)),
        );
      },
      ["ERR_STREAM_PREMATURE_CLOSE", "ERR_STREAM_PREMATURE_CLOSE", "ECONNRESET"],
    ],
    [
      "finished(stream)",
      (stream, say) => {
        stream.respond({ ":status": 200 });
        stream.end(MB);
        finished(stream).then(
          () => say("ok"),
          error => say(codeOf(error)),
        );
      },
      ["ERR_STREAM_PREMATURE_CLOSE", "ERR_STREAM_PREMATURE_CLOSE", "ECONNRESET"],
    ],
  ];

  for (const [answerName, answer, codes] of answers) {
    leaves.forEach(([leaveName, leave], way) => {
      test(`${answerName} fails when the client ${leaveName}`, async () => {
        const { promise: said, resolve: say } = Promise.withResolvers<string>();
        const server = http2.createServer();
        server.on("sessionError", () => {});
        server.on("stream", (stream: http2.ServerHttp2Stream) => {
          stream.on("error", () => {});
          answer(stream, say);
        });
        const port = await listen(server);
        const { socket, windowFull } = await rawRequest(port);
        try {
          await windowFull;
          leave(socket);
          assert.strictEqual(await said, codes[way]);
        } finally {
          socket.destroy();
          server.close();
        }
      });
    });
  }

  for (const [leaveName, leave] of leaves) {
    test(`response.write(chunk, callback) fails when the client ${leaveName}`, async () => {
      const { promise: said, resolve: say } = Promise.withResolvers<string>();
      const server = http2.createServer((_request, response) => {
        response.on("error", () => {});
        response.writeHead(200);
        response.write(MB, error => say(codeOf(error)));
      });
      server.on("sessionError", () => {});
      const port = await listen(server);
      const { socket, windowFull } = await rawRequest(port);
      try {
        await windowFull;
        leave(socket);
        assert.strictEqual(await said, "ECANCELED");
      } finally {
        socket.destroy();
        server.close();
      }
    });
  }

  // A file response writes its chunks to the session without the stream's Writable.
  const file = path.join(import.meta.dirname, "node-http2.test.js");
  const fileSize = fs.statSync(file).size;

  test("a file response larger than the window arrives whole when the client reads it", async () => {
    assert.ok(fileSize > 2 * WINDOW);
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("close", () => resolve());
      stream.respondWithFile(file);
    });
    const port = await listen(server);
    const { socket, bodyEnd } = await rawRequest(port, { grant: true });
    try {
      assert.strictEqual(await bodyEnd, fileSize);
      await closed;
    } finally {
      socket.destroy();
      server.close();
    }
  });

  test("a file response closes when the client resets the connection in the middle", async () => {
    const errors: string[] = [];
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    const server = http2.createServer();
    server.on("sessionError", () => {});
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", error => errors.push(codeOf(error)));
      stream.on("close", () => resolve());
      stream.respondWithFile(file);
    });
    const port = await listen(server);
    const { socket, windowFull } = await rawRequest(port);
    try {
      await windowFull;
      socket.resetAndDestroy();
      await closed;
      await turns(4);
      assert.deepStrictEqual(errors, ["ECONNRESET"]);
    } finally {
      socket.destroy();
      server.close();
    }
  });

  // node fails these writes with ERR_STREAM_WRITE_AFTER_END and leaves some of the streams
  // open. Bun completes them with no error, and the response finishes and closes.
  describe("a response that ended on its HEADERS frame still finishes", { skip: !isBun }, () => {
    type Respond = (stream: http2.ServerHttp2Stream, events: string[]) => void;
    const flows: [string, string, Respond, string[]][] = [
      [
        "HEAD: end(chunk, callback), no respond()",
        "HEAD",
        (stream, events) => stream.end("body", () => events.push("end")),
        ["end", "finish"],
      ],
      [
        "HEAD: write(chunk, callback); end()",
        "HEAD",
        (stream, events) => {
          stream.write("body", error => events.push(`write:${codeOf(error)}`));
          stream.end();
        },
        ["finish", "write:ok"],
      ],
      [
        "cork(); write(chunk, callback); respond({ endStream: true })",
        "GET",
        (stream, events) => {
          stream.cork();
          stream.write("body", error => events.push(`write:${codeOf(error)}`));
          stream.respond({ ":status": 200 }, { endStream: true });
        },
        ["finish", "write:ok"],
      ],
      [
        "cork(); write(chunk, callback); respond(204); uncork()",
        "GET",
        (stream, events) => {
          stream.cork();
          stream.write("body", error => events.push(`write:${codeOf(error)}`));
          stream.respond({ ":status": 204 });
          stream.uncork();
        },
        ["finish", "write:ok"],
      ],
    ];
    for (const [name, method, respond, expected] of flows) {
      test(name, async () => {
        const events: string[] = [];
        const { promise: closed, resolve } = Promise.withResolvers<void>();
        const server = http2.createServer();
        server.on("stream", (stream: http2.ServerHttp2Stream) => {
          stream.on("error", error => events.push(`error:${codeOf(error)}`));
          stream.on("finish", () => events.push("finish"));
          stream.on("close", () => resolve());
          stream.resume();
          respond(stream, events);
        });
        const port = await listen(server);
        const { socket, bodyEnd } = await rawRequest(port, { method });
        try {
          assert.strictEqual(await bodyEnd, 0);
          await closed;
          assert.deepStrictEqual(events.sort(), expected);
        } finally {
          socket.destroy();
          server.close();
        }
      });
    }
  });
});

describe("client: the request ends before its HEADERS frame is sent", () => {
  type Context = { session: http2.ClientHttp2Session; request: http2.ClientHttp2Stream; abort: AbortController };
  const ways: [string, (context: Context) => void][] = [
    ["request.destroy()", ({ request }) => request.destroy()],
    ["session.destroy()", ({ session }) => session.destroy()],
    ["an AbortSignal", ({ abort }) => abort.abort()],
  ];
  /** Writes `chunk`, ends the request with `act`, and returns the events of the request in order. */
  async function writeAndEnd(request: http2.ClientHttp2Stream, chunk: string | Buffer, act: () => void) {
    const events: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    request.on("error", () => {});
    request.on("finish", () => events.push("finish"));
    request.on("close", () => events.push("close"));
    request.resume();
    const closed = closeOf(request);
    request.write(chunk, error => {
      events.push(`write:${codeOf(error)}`);
      resolve();
    });
    act();
    await closed;
    await Promise.race([promise, turns(10)]);
    await turns(2);
    return events;
  }

  // The session is still connecting: the request has no stream id (`pending`) and is corked.
  // The Writable holds the write and fails it before 'close'.
  const pendingCodes = ["ERR_STREAM_DESTROYED", "ERR_HTTP2_STREAM_CANCEL", "ABORT_ERR"];
  ways.forEach(([name, act], way) => {
    test(`${name} while the session connects`, async () => {
      const peer = await rawServer();
      const session = connectOverTcp(peer.port);
      try {
        session.on("error", () => {});
        const abort = new AbortController();
        const request = session.request({ ":method": "POST", ":path": "/" }, { signal: abort.signal });
        assert.strictEqual(request.pending, true);
        const events = await writeAndEnd(request, "chunk", () => act({ session, request, abort }));
        assert.deepStrictEqual(events, [`write:${pendingCodes[way]}`, "close"]);
      } finally {
        session.destroy();
        peer.close();
      }
    });
  });

  test("the server is down", async () => {
    const down = net.createServer();
    const port = await listen(down);
    await new Promise(resolve => down.close(resolve));
    const session = connectOverTcp(port);
    try {
      session.on("error", () => {});
      const request = session.request({ ":method": "POST", ":path": "/" });
      assert.strictEqual(request.pending, true);
      assert.deepStrictEqual(await writeAndEnd(request, "chunk", () => {}), ["write:ERR_HTTP2_STREAM_CANCEL", "close"]);
    } finally {
      session.destroy();
    }
  });

  test("request() on a destroyed session", async () => {
    const peer = await rawServer();
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      session.destroy();
      const request = session.request({ ":method": "POST", ":path": "/" });
      assert.deepStrictEqual(await writeAndEnd(request, "chunk", () => {}), [
        "write:ERR_HTTP2_INVALID_SESSION",
        "close",
      ]);
    } finally {
      peer.close();
    }
  });

  test("the request stays corked until it has an id, and its writes leave together", async () => {
    const peer = await rawServer({ grant: true });
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      const request = session.request({ ":method": "POST", ":path": "/" });
      request.on("error", () => {});
      request.resume();
      const said: string[] = [];
      request.write("one", error => said.push(codeOf(error)));
      await new Promise(resolve => process.nextTick(resolve));
      assert.deepStrictEqual([request.pending, request.writableCorked, request.writableLength], [true, 1, 3]);
      request.write("two", error => said.push(codeOf(error)));
      await once(request, "ready");
      assert.strictEqual(request.writableCorked, 0);
      request.end();
      assert.strictEqual(await peer.bodyEnd, 6);
      await closeOf(request);
      assert.deepStrictEqual(said, ["ok", "ok"]);
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // close() sends its RST_STREAM when the request gets its id: the body that was queued a
  // moment before is dropped. node cancels the write before 'close', Bun after it.
  test("request.close() with a body larger than the window while the session connects", async () => {
    const peer = await rawServer();
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      const request = session.request({ ":method": "POST", ":path": "/" });
      assert.strictEqual(request.pending, true);
      const events = await writeAndEnd(request, MB, () => request.close());
      assert.deepStrictEqual(events.sort(), ["close", "write:ECANCELED"]);
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // SETTINGS_MAX_CONCURRENT_STREAMS is 1: the second request waits for the first one to close.
  // node gives it an id at once and cancels its write one turn after 'close'.
  for (const [name, act] of [ways[0], ways[2]]) {
    test(`${name} while the request waits behind the peer's stream limit`, async () => {
      const peer = await rawServer({ settings: Buffer.from([0, 3, 0, 0, 0, 1]) });
      const session = connectOverTcp(peer.port);
      try {
        session.on("error", () => {});
        await once(session, "remoteSettings");
        session.request({ ":method": "POST", ":path": "/" }).on("error", () => {});
        const abort = new AbortController();
        const request = session.request({ ":method": "POST", ":path": "/" }, { signal: abort.signal });
        const events = await writeAndEnd(request, "chunk", () => turns(1).then(() => act({ session, request, abort })));
        assert.deepStrictEqual(events, ["close", "write:ECANCELED"]);
      } finally {
        session.destroy();
        peer.close();
      }
    });
  }

  test("control: the write callback gets no error when the request is sent", async () => {
    const peer = await rawServer({ grant: true });
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      const request = session.request({ ":method": "POST", ":path": "/" });
      request.on("error", () => {});
      assert.strictEqual(request.pending, true);
      const said = await new Promise<string>(resolve => request.write("chunk", error => resolve(codeOf(error))));
      assert.strictEqual(said, "ok");
    } finally {
      session.destroy();
      peer.close();
    }
  });
});
