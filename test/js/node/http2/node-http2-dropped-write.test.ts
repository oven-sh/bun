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
import { Duplex, Readable, duplexPair } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { describe, test } from "node:test";

const { NGHTTP2_NO_ERROR, NGHTTP2_INTERNAL_ERROR, NGHTTP2_FLOW_CONTROL_ERROR, NGHTTP2_REFUSED_STREAM, NGHTTP2_CANCEL } =
  http2.constants;
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
 * With `grantConnection` only the window of the stream stays closed. `onHeaders` answers a
 * request with frames of its own. `onData` sees the size of the body so far.
 */
async function rawServer({
  grant = false,
  grantConnection = false,
  settings = Buffer.alloc(0),
  onHeaders = undefined as undefined | ((socket: net.Socket, streamId: number) => void),
  onData = undefined as undefined | ((socket: net.Socket, streamId: number, received: number) => void),
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
        onData?.(socket, streamId, received);
        if (!grant) {
          if (grantConnection && payload.length > 0) {
            socket.write(frame(FRAME.WINDOW_UPDATE, 0, 0, uint32(payload.length)));
          }
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

  // The error of the stream is not fixed here. After session.destroy() node gives the stream no
  // error and Bun gives it ERR_HTTP2_STREAM_CANCEL. After a reset the socket chooses the code.
  // The writes that waited in the Writable carry the error of the stream in every case.
  const waysWithAnyStreamError: [string, (context: Context) => void][] = [
    ["session.destroy()", ({ session }) => session.destroy()],
    ["the peer resets the connection", ({ socket }) => socket.resetAndDestroy()],
  ];
  for (const [name, act] of waysWithAnyStreamError) {
    test(name, async () => {
      const { said, events, errored } = await dropQueuedWrites(connectOverTcp, act);
      assert.deepStrictEqual(said, ["ECANCELED", errored, errored]);
      assert.deepStrictEqual(events, errored === "ECANCELED" ? [] : [errored]);
    });
  }

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

  // The last DATA frame of the second request has no payload, but it waits in the queue behind
  // the body that the first request could not send. The flush at the end of end() sends it, and
  // nothing else finishes a request that still has trailers to send.
  test("a request with trailers finishes when its last DATA frame leaves the queue", async () => {
    const peer = await rawServer({ grantConnection: true });
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      await once(session, "connect");
      const stalled = session.request({ ":method": "POST", ":path": "/" });
      stalled.on("error", () => {});
      stalled.write(MB);
      await peer.windowFull;

      const request = session.request({ ":method": "POST", ":path": "/" }, { waitForTrailers: true });
      request.on("error", () => {});
      const events: string[] = [];
      const { promise: both, resolve } = Promise.withResolvers<void>();
      for (const name of ["finish", "wantTrailers"]) {
        request.on(name, () => {
          if (events.push(name) === 2) resolve();
        });
      }
      request.end();
      await both;
      request.sendTrailers({ "x-trailer": "1" });
      assert.deepStrictEqual(events.sort(), ["finish", "wantTrailers"]);
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // The second bug in #40358: the peer raises the window of the stream, a part of the queued
  // write leaves, and then the stream dies with the rest still queued.
  test("a write that left in part fails when the peer resets the stream", async () => {
    const LATER = 49122;
    const { promise: partLeft, resolve } = Promise.withResolvers<void>();
    const peer = await rawServer({
      onData: (_socket, _streamId, received) => void (received === WINDOW + LATER && resolve()),
    });
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      await once(session, "connect");
      const stream = session.request({ ":method": "POST", ":path": "/" });
      const events: string[] = [];
      stream.on("error", error => events.push(codeOf(error)));
      stream.on("finish", () => events.push("finish"));
      stream.on("drain", () => events.push("drain"));
      const said = new Promise<string>(resolve =>
        stream.write(MB.subarray(0, 512 * 1024), error => resolve(codeOf(error))),
      );
      const { socket, streamId } = await peer.windowFull;
      // SETTINGS_INITIAL_WINDOW_SIZE = 1 MB opens the stream. The connection gets LATER bytes.
      const raisedWindow = frame(FRAME.SETTINGS, 0, 0, Buffer.from([0, 4, 0, 0x10, 0, 0]));
      socket.write(Buffer.concat([raisedWindow, frame(FRAME.WINDOW_UPDATE, 0, 0, uint32(LATER))]));
      await partLeft;
      socket.write(frame(FRAME.RST_STREAM, 0, streamId, uint32(NGHTTP2_FLOW_CONTROL_ERROR)));
      assert.strictEqual(await said, "ECANCELED");
      assert.deepStrictEqual(events, ["ERR_HTTP2_STREAM_ERROR"]);
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // RFC 9113 section 8.1: a server that has sent its complete response can stop the request
  // "without error" with RST_STREAM(NO_ERROR). gRPC servers do. node keeps such a stream open,
  // and the rest of its body never calls back. Bun destroys the stream at the reset, so an
  // error for the write in flight would reach its writer before the response is read. That
  // write completes with no error, as it did before.
  test("the peer stops the upload with RST_STREAM(NO_ERROR)", { skip: !isBun }, async () => {
    const { said, events, errored } = await dropQueuedWrites(connectOverTcp, ({ socket }) =>
      socket.write(
        Buffer.concat([
          frame(FRAME.HEADERS, 0x5, 1, headerBlock([[":status", "200"]])),
          frame(FRAME.RST_STREAM, 0, 1, uint32(NGHTTP2_NO_ERROR)),
        ]),
      ),
    );
    assert.deepStrictEqual(
      { said, events, errored },
      { said: ["ok", "ERR_STREAM_DESTROYED", "ERR_STREAM_DESTROYED"], events: [], errored: "ok" },
    );
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
   * response arrives. Without it the response body stops after one window. With
   * `grantConnection` only the window of that one stream stays closed. `settings` is the
   * payload of its SETTINGS frame.
   */
  const requestHeaders = (method: string, path: string) =>
    headerBlock([
      [":method", method],
      [":scheme", "http"],
      [":path", path],
      [":authority", "localhost"],
    ]);
  async function rawRequest(
    port: number,
    { method = "GET", path = "/", grant = false, grantConnection = false, settings = Buffer.alloc(0) } = {},
  ) {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    const { promise: windowFull, resolve: full } = Promise.withResolvers<void>();
    const { promise: responded, resolve: gotHeaders } = Promise.withResolvers<void>();
    const { promise: bodyEnd, resolve: ended } = Promise.withResolvers<number>();
    const pings: (() => void)[] = [];
    let received = 0;
    readFrames(socket, 0, (type, flags, streamId, payload) => {
      if (type === FRAME.SETTINGS && !(flags & 1)) socket.write(frame(FRAME.SETTINGS, 1, 0));
      else if (type === FRAME.PING && flags & 1) pings.shift()?.();
      else if (type === FRAME.HEADERS) {
        gotHeaders();
        if (flags & 1) ended(received);
      } else if (type === FRAME.DATA) {
        received += payload.length;
        if (grant && payload.length > 0) socket.write(windowUpdates(streamId, payload.length));
        if (grantConnection && payload.length > 0)
          socket.write(frame(FRAME.WINDOW_UPDATE, 0, 0, uint32(payload.length)));
        if (!grant && received === WINDOW) full();
        if (flags & 1) ended(received);
      }
    });
    await once(socket, "connect");
    const request = frame(FRAME.HEADERS, 0x5, 1, requestHeaders(method, path));
    socket.write(Buffer.concat([PREFACE, frame(FRAME.SETTINGS, 0, 0, settings), request]));
    /** One PING round trip: the server has handled everything that this client sent before. */
    const ping = () =>
      new Promise<void>(resolve => {
        pings.push(resolve);
        socket.write(frame(FRAME.PING, 0, 0, Buffer.alloc(8)));
      });
    return { socket, windowFull, responded, bodyEnd, ping };
  }
  const leaves: [string, (socket: net.Socket) => void][] = [
    ["cancels the stream", socket => socket.write(frame(FRAME.RST_STREAM, 0, 1, uint32(NGHTTP2_CANCEL)))],
    ["destroys its session", socket => socket.end(frame(FRAME.GOAWAY, 0, 0, uint32(0, NGHTTP2_NO_ERROR)))],
    ["resets the connection", socket => socket.resetAndDestroy()],
  ];
  type Say = (answer: string) => void;
  // [name, how the server answers, the code it hears for each way of leaving]. `null` is the
  // error of the stream after a connection reset: the socket chooses its code.
  const answers: [string, (stream: http2.ServerHttp2Stream, say: Say) => void, (string | null)[]][] = [
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
      ["ECANCELED", "ECANCELED", null],
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
      ["ERR_STREAM_PREMATURE_CLOSE", "ERR_STREAM_PREMATURE_CLOSE", null],
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
      ["ERR_STREAM_PREMATURE_CLOSE", "ERR_STREAM_PREMATURE_CLOSE", null],
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
          if (codes[way] === null) assert.notStrictEqual(await said, "ok");
          else assert.strictEqual(await said, codes[way]);
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

  // The END_STREAM frame of the second response has no payload, but it waits in the queue
  // behind the body that the first response could not send. In the request handler the session
  // is in the middle of a read. In a later turn the flush at the end of end() sends the frame.
  const turnsOfEnd: [string, (end: () => void) => void][] = [
    ["in the request handler", end => end()],
    ["in a later turn", end => void setImmediate(end)],
  ];
  for (const [name, run] of turnsOfEnd) {
    test(`a response that ends ${name} finishes behind the queued body of another stream`, async () => {
      const events: string[] = [];
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      const server = http2.createServer();
      server.on("sessionError", () => {});
      server.on("stream", (stream: http2.ServerHttp2Stream, headers) => {
        stream.on("error", () => {});
        stream.respond({ ":status": 200 });
        if (headers[":path"] === "/stalled") return void stream.write(MB);
        stream.on("finish", () => events.push("finish"));
        stream.on("close", () => resolve());
        run(() => stream.end());
      });
      const port = await listen(server);
      const { socket, windowFull, bodyEnd } = await rawRequest(port, { path: "/stalled", grantConnection: true });
      try {
        await windowFull;
        socket.write(frame(FRAME.HEADERS, 0x5, 3, requestHeaders("GET", "/")));
        assert.strictEqual(await bodyEnd, WINDOW);
        await closed;
        assert.deepStrictEqual(events, ["finish"]);
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

  // A corked write is still in flight when the file response starts, so the session holds
  // writes of two writers for one stream. node does not support this order of calls.
  describe("cork(); write(); respondWithFile()", { skip: !isBun }, () => {
    test("behind a closed window, both writes complete and the response ends", async () => {
      const events: string[] = [];
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      const server = http2.createServer();
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", error => events.push(`error:${codeOf(error)}`));
        stream.on("close", () => resolve());
        stream.cork();
        stream.write("x", error => events.push(`write:${codeOf(error)}`));
        stream.respondWithFile(file, {}, { length: 100 });
      });
      const port = await listen(server);
      // SETTINGS_INITIAL_WINDOW_SIZE = 0: the write and the chunk of the file wait in the queue.
      const noWindow = Buffer.from([0, 4, 0, 0, 0, 0]);
      const { socket, responded, bodyEnd, ping } = await rawRequest(port, { settings: noWindow });
      try {
        await responded;
        // The server reads the file after it sends the HEADERS frame. Three round trips give
        // the chunk time to join the write in the queue.
        for (let i = 0; i < 3; i++) await ping();
        socket.write(windowUpdates(1, WINDOW));
        assert.strictEqual(await bodyEnd, 101);
        await closed;
        assert.deepStrictEqual(events, ["write:ok"]);
      } finally {
        socket.destroy();
        server.close();
      }
    });

    test("over a JS stream, the write that left and the queued chunk of the file both complete", async () => {
      const errors: string[] = [];
      const { promise: wrote, resolve } = Promise.withResolvers<string>();
      const server = http2.createServer();
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", error => errors.push(codeOf(error)));
        stream.cork();
        stream.write("x", error => resolve(codeOf(error)));
        // With the write in front of it, the file is two bytes larger than the window.
        stream.respondWithFile(file, {}, { length: WINDOW + 1 });
      });
      const [clientSide, serverSide] = duplexPair();
      server.emit("connection", serverSide);
      const session = http2.connect("http://localhost", { createConnection: () => clientSide });
      try {
        session.on("error", () => {});
        const request = session.request();
        let received = 0;
        request.on("data", (chunk: Buffer) => (received += chunk.length));
        request.end();
        await once(request, "end");
        assert.deepStrictEqual(
          { received, wrote: await wrote, errors },
          { received: WINDOW + 2, wrote: "ok", errors: [] },
        );
      } finally {
        session.destroy();
        server.close();
      }
    });
  });

  // The client reads nothing, so the response of stream 1 holds the socket of the server under
  // backpressure, and the empty END_STREAM frame of stream 3 waits behind it. close() must not
  // finish the response, or reset the stream, before that frame has left. node does not read
  // the request of stream 3 while its socket is blocked.
  test("end() then close() behind socket backpressure finishes after END_STREAM leaves", { skip: !isBun }, async () => {
    const events: string[] = [];
    const { promise: stalled, resolve: isStalled } = Promise.withResolvers<void>();
    const { promise: answered, resolve: hasAnswered } = Promise.withResolvers<void>();
    const { promise: closed, resolve: hasClosed } = Promise.withResolvers<void>();
    const server = http2.createServer({ maxSessionMemory: 1000 });
    server.on("sessionError", () => {});
    server.on("stream", (stream: http2.ServerHttp2Stream, headers) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      if (headers[":path"] === "/stalled") {
        stream.write(Buffer.alloc(24 << 20, 97));
        return isStalled();
      }
      stream.on("finish", () => events.push("finish"));
      stream.on("close", () => hasClosed());
      stream.end();
      stream.close();
      hasAnswered();
    });
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    try {
      await once(socket, "connect");
      socket.pause();
      // Every flow-control window is open: only the socket holds the response of stream 1.
      const MAX = 0x7fffffff;
      socket.write(
        Buffer.concat([
          PREFACE,
          frame(FRAME.SETTINGS, 0, 0, Buffer.concat([Buffer.from([0, 4]), uint32(MAX)])),
          frame(FRAME.WINDOW_UPDATE, 0, 0, uint32(MAX - WINDOW)),
          frame(FRAME.HEADERS, 0x5, 1, requestHeaders("GET", "/stalled")),
        ]),
      );
      await stalled;
      await turns(2);
      socket.write(frame(FRAME.HEADERS, 0x5, 3, requestHeaders("GET", "/")));
      await answered;
      await turns(3);
      assert.deepStrictEqual(events, []);

      const names = { [FRAME.DATA]: "DATA", [FRAME.HEADERS]: "HEADERS", [FRAME.RST_STREAM]: "RST_STREAM" };
      const wire: string[] = [];
      const { promise: ended, resolve: hasEnded } = Promise.withResolvers<void>();
      readFrames(socket, 0, (type, flags, streamId) => {
        if (streamId !== 3) return;
        wire.push(names[type] + (flags & 1 ? "+END_STREAM" : ""));
        if (flags & 1 || type === FRAME.RST_STREAM) hasEnded();
      });
      socket.resume();
      await ended;
      await closed;
      assert.deepStrictEqual(
        { wire: wire.slice(0, 2), events },
        { wire: ["HEADERS", "DATA+END_STREAM"], events: ["finish"] },
      );
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
