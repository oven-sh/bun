/**
 * A body that never left the process must not read as written.
 *
 * The peer in these tests never opens the flow-control window, so a 1 MB body stops after one
 * window (65535 bytes) and the rest waits in the sender's queue. Then the stream ends. The write
 * in flight fails with `write ECANCELED` one turn after the teardown, 'finish' does not fire,
 * and `pipeline()` / `finished()` reject. A request that has no stream id yet follows the same
 * rule. This is what node v26.3.0 does. node 26.10 and newer complete the write in `_destroy`
 * with the destroy error (nodejs/node#66016), so 47 of these tests do not pass there.
 *
 * One result is Bun's own: when the client closes its connection, the write in flight of a
 * server stream completes with no error. The rows for it expect a value for each runtime.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-dropped-write.test.ts
 *   node --test test/js/node/http2/node-http2-dropped-write.test.ts   (node v26.3.0)
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import diagnosticsChannel from "node:diagnostics_channel";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import { Duplex, Readable, duplexPair } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { describe, test } from "node:test";
import { promisify } from "node:util";

const { NGHTTP2_NO_ERROR, NGHTTP2_INTERNAL_ERROR, NGHTTP2_FLOW_CONTROL_ERROR, NGHTTP2_REFUSED_STREAM, NGHTTP2_CANCEL } =
  http2.constants;
const FRAME = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PING: 6, GOAWAY: 7, WINDOW_UPDATE: 8 };
const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
// The initial flow-control window of a stream and of a connection (RFC 9113 section 6.9.2).
const WINDOW = 65535;
const MB = Buffer.alloc(1 << 20, 97);
const isBun = typeof process.versions.bun === "string";
/**
 * The most that a loopback socket can hold when its peer does not read: the send buffer of the
 * sender plus the receive buffer of the peer. Linux gives both limits. The other systems have no
 * such file, and 22 MiB is above their defaults.
 */
function unreadSocketLimit() {
  try {
    const limit = (name: string) =>
      Number(fs.readFileSync(`/proc/sys/net/ipv4/${name}`, "utf8").trim().split(/\s+/)[2]);
    return limit("tcp_rmem") + limit("tcp_wmem");
  } catch {
    return 22 << 20;
  }
}
// A body that such a socket cannot take. The tests that block a socket with it run in Bun only,
// and not where the socket takes every body (Windows) or where the limits ask for more than 64 MiB.
const BIG_SIZE = unreadSocketLimit() + (2 << 20);
const blocksSocket = isBun && process.platform !== "win32" && BIG_SIZE <= 64 << 20;
const BIG = Buffer.alloc(blocksSocket ? BIG_SIZE : 0, 97);

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
/**
 * Runs `script` in a child of this runtime and returns the JSON that it prints. An exception that
 * reaches 'uncaughtException' fails the test that is running, so those exchanges run in a child.
 * A child that does not end is killed, and that fails the test that made it.
 */
async function inChild(script: string) {
  const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" };
  const options = { env, timeout: 45_000, killSignal: "SIGKILL" as const };
  const { stdout } = await promisify(execFile)(process.execPath, ["-e", script], options);
  return JSON.parse(stdout);
}
// A child of a debug build starts slowly: its test gets more than the default 5 seconds.
const childTest = { timeout: 60_000 };
/**
 * The start of a script for `inChild`. `finish(last)` prints the events and ends the child. The
 * child also ends by itself, so that a missing callback fails the test with the events it has:
 * twenty turns after `afterClose()`, and at a deadline.
 */
const CHILD_PRELUDE = `
  const http2 = require("node:http2");
  const net = require("node:net");
  const frame = (type, flags, id, payload = Buffer.alloc(0)) => {
    const header = Buffer.alloc(9);
    header.writeUIntBE(payload.length, 0, 3);
    header[3] = type;
    header[4] = flags;
    header.writeUInt32BE(id, 5);
    return Buffer.concat([header, payload]);
  };
  const events = [];
  const finish = last => {
    events.push(last);
    console.log(JSON.stringify(events));
    process.exit(0);
  };
  process.on("uncaughtException", error => events.push("uncaught:" + (error.code || error.message)));
  // A cancelled write calls back at most two turns after 'close'.
  const afterClose = (turns = 20) => (turns > 0 ? setImmediate(afterClose, turns - 1) : finish("write:never"));
  setTimeout(finish, 20000, "deadline");
`;
/**
 * A script for `inChild`: a raw peer resets the request with `code` when it holds one window of
 * the body. `prepare` is the code that sets the request up. The script prints what reached
 * 'uncaughtException' and then what the write callback got.
 */
const resetUploadScript = (code: number, prepare: string) => `${CHILD_PRELUDE}
  const server = net.createServer(socket => {
    socket.on("error", () => {});
    socket.write(frame(4, 0, 0));
    let received = 0;
    socket.on("data", chunk => {
      received += chunk.length;
      if (received <= ${WINDOW}) return;
      received = -Infinity;
      socket.write(Buffer.concat([frame(4, 1, 0), frame(3, 0, 1, Buffer.from([0, 0, 0, ${code}]))]));
    });
  });
  server.listen(0, "127.0.0.1", () => {
    const session = http2.connect("http://127.0.0.1:" + server.address().port);
    session.on("error", () => {});
    const request = session.request({ ":method": "POST", ":path": "/" });
    ${prepare}
    request.on("close", () => afterClose());
    request.write(Buffer.alloc(1 << 20, 97), error => finish("write:" + (error ? error.code : "ok")));
  });
`;
/** The same for a response: a raw client resets its request when it holds one window of the body. */
const resetDownloadScript = (code: number, prepare: string) => `${CHILD_PRELUDE}
  const field = (name, value) =>
    Buffer.concat([Buffer.from([0x10, name.length]), Buffer.from(name), Buffer.from([value.length]), Buffer.from(value)]);
  const server = http2.createServer();
  server.on("sessionError", () => {});
  server.on("stream", stream => {
    ${prepare}
    stream.on("close", () => afterClose());
    stream.respond({ ":status": 200 });
    stream.write(Buffer.alloc(1 << 20, 97), error => finish("write:" + (error ? error.code : "ok")));
  });
  server.listen(0, "127.0.0.1", () => {
    const socket = net.connect(server.address().port, "127.0.0.1");
    socket.on("error", () => {});
    socket.on("connect", () => {
      const headers = [field(":method", "GET"), field(":scheme", "http"), field(":path", "/"), field(":authority", "a")];
      const request = frame(1, 5, 1, Buffer.concat(headers));
      socket.write(Buffer.concat([Buffer.from("PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n"), frame(4, 0, 0), request]));
    });
    let received = 0;
    socket.on("data", chunk => {
      received += chunk.length;
      if (received <= ${WINDOW}) return;
      received = -Infinity;
      socket.write(Buffer.concat([frame(4, 1, 0), frame(3, 0, 1, Buffer.from([0, 0, 0, ${code}]))]));
    });
  });
`;
// In the child, an 'aborted' listener that throws, and an 'error' listener that records.
const throwingAbortedListener = (stream: string) => `
  ${stream}.on("error", error => events.push("error:" + (error.code || error.message)));
  ${stream}.on("aborted", () => {
    throw new Error("thrown by the listener");
  });
`;

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
  type Context = {
    session: http2.ClientHttp2Session;
    stream: http2.ClientHttp2Stream;
    socket: net.Socket;
    abort: AbortController;
  };
  const mine = Object.assign(new Error("mine"), { code: "MINE" });
  // A server that refuses an upload answers, ends its side and resets the stream with NO_ERROR.
  const answerEarly = ({ stream, socket }: Context) => {
    const status = frame(FRAME.HEADERS, 0x4, 1, headerBlock([[":status", "413"]]));
    socket.write(Buffer.concat([status, frame(FRAME.DATA, 0x1, 1, Buffer.from("too large"))]));
    stream.once("end", () => socket.write(frame(FRAME.RST_STREAM, 0, 1, uint32(NGHTTP2_NO_ERROR))));
    stream.resume();
  };
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
    ["the AbortSignal of the request", ({ abort }) => abort.abort(), "ABORT_ERR", ["ABORT_ERR"]],
    ["an early response and then RST_STREAM(NO_ERROR) from the peer", answerEarly, "ECANCELED", []],
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
      const abort = new AbortController();
      const stream = session.request({ ":method": "POST", ":path": "/" }, { signal: abort.signal });
      const said: string[] = [];
      const events: string[] = [];
      stream.on("error", error => events.push(codeOf(error)));
      stream.on("finish", () => events.push("finish"));
      stream.on("drain", () => events.push("drain"));
      const closed = closeOf(stream);
      let saidAtClose = -1;
      stream.once("close", () => (saidAtClose = Object.keys(said).length));
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

      act({ session, stream, socket, abort });
      await closed;
      await Promise.race([allSaid, turns(10)]);
      await turns(2);
      return { said, events, saidAtClose, errored: codeOf(stream.errored) };
    } finally {
      session.destroy();
      peer.close();
    }
  }

  for (const [name, act, code, errors] of ways) {
    test(name, async () => {
      const { said, events, saidAtClose } = await dropQueuedWrites(connectOverTcp, act);
      // The callbacks come after 'close', except after a close() of this side.
      const atClose = name.startsWith("stream.close") ? 3 : 0;
      assert.deepStrictEqual(
        { said, events, saidAtClose },
        { said: ["ECANCELED", code, code], events: errors, saidAtClose: atClose },
      );
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
          said.push(codeOf(error));
          if (said.length === 3) resolve();
        });
      }
      await peer.windowFull;
      assert.deepStrictEqual(said, []);
      const closed = closeOf(stream);
      stream.destroy();
      await closed;
      await Promise.race([allSaid, turns(10)]);
      assert.deepStrictEqual(said, ["ECANCELED", "ECANCELED", "ECANCELED"]);
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // The first request is stalled on its window, with the rest of its body in the queue of the
  // session. In Bun the last DATA frame of the second request, which has no payload, waits
  // behind that body today (#43422 ends that wait). The flush at the end of end() sends it, and
  // nothing else finishes a request that still has trailers to send.
  test("a request with trailers finishes while another request is stalled on its window", async () => {
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

  // The ways of asking whether an upload arrived, after a reset cut it.
  // [name, how to ask, the answer]. `null` is the code of the error of the stream: the socket
  // chooses it after a reset.
  const asks: [string, (stream: http2.ClientHttp2Stream) => Promise<string>, string | null][] = [
    [
      "stream.write(chunk, callback)",
      stream => new Promise(resolve => stream.write(MB, error => resolve(codeOf(error)))),
      "ECANCELED",
    ],
    [
      "stream.end(chunk, callback)",
      stream => new Promise(resolve => stream.end(MB, (error?: Error) => resolve(codeOf(error)))),
      null,
    ],
    [
      "'finish' or 'close', whichever is first",
      stream =>
        new Promise(resolve => {
          stream.once("finish", () => resolve("ok"));
          stream.once("close", () => resolve("closed"));
          stream.end(MB);
        }),
      "closed",
    ],
    ["pipeline(source, stream)", stream => pipeline(Readable.from([MB]), stream).then(() => "ok", codeOf), null],
    ["finished(stream)", stream => (stream.end(MB), finished(stream).then(() => "ok", codeOf)), null],
  ];
  for (const [name, ask, expected] of asks) {
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
        const said = await answer;
        assert.notStrictEqual(stream.errored, null);
        assert.strictEqual(said, expected ?? codeOf(stream.errored));
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
      assert.deepStrictEqual(said, ["ECANCELED"]);
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

  // A chunk that fits in the window leaves before the reset, so that write is done (Bun sends it
  // from the teardown: the request is still corked in this tick). A chunk that does not fit is
  // cancelled.
  for (const [name, connect] of [
    ["a TCP socket", connectOverTcp],
    ["a JS stream", connectOverDuplex],
  ] as const) {
    for (const [how, error] of [
      ["destroy()", undefined],
      ["destroy(error)", mine],
    ] as const) {
      for (const [chunk, expected] of [
        ["chunk", "ok"],
        [MB, "ECANCELED"],
      ] as const) {
        const what = expected === "ok" ? "that left stays done" : "larger than the window is cancelled";
        test(`a write ${what} when ${how} follows in the same tick, over ${name}`, async () => {
          const peer = await rawServer();
          const session = connect(peer.port);
          try {
            session.on("error", () => {});
            await once(session, "connect");
            const stream = session.request({ ":method": "POST", ":path": "/" });
            stream.on("error", () => {});
            const said: string[] = [];
            const { promise: called, resolve } = Promise.withResolvers<void>();
            const closed = closeOf(stream);
            stream.write(chunk, error => {
              said.push(codeOf(error));
              resolve();
            });
            stream.destroy(error);
            await closed;
            await called;
            await turns(2);
            assert.deepStrictEqual(said, [expected]);
          } finally {
            session.destroy();
            peer.close();
          }
        });
      }
    }
  }

  // The two writes are still corked when the reset comes, and they reach the session together.
  for (const [name, code, errors] of [
    ["NGHTTP2_REFUSED_STREAM", NGHTTP2_REFUSED_STREAM, ["ERR_HTTP2_STREAM_ERROR"]],
    ["NGHTTP2_CANCEL", NGHTTP2_CANCEL, []],
  ] as const) {
    test(`two corked writes are cancelled when the peer sends RST_STREAM(${name})`, async () => {
      const peer = await rawServer({
        onHeaders: (socket, streamId) => socket.write(frame(FRAME.RST_STREAM, 0, streamId, uint32(code))),
      });
      const session = connectOverTcp(peer.port);
      try {
        session.on("error", () => {});
        await once(session, "connect");
        const stream = session.request({ ":method": "POST", ":path": "/" });
        const events: string[] = [];
        stream.on("error", error => events.push(`error:${codeOf(error)}`));
        stream.on("close", () => events.push("close"));
        const { promise: bothSaid, resolve } = Promise.withResolvers<void>();
        stream.cork();
        stream.write(MB, error => events.push(`first:${codeOf(error)}`));
        stream.write(MB, error => (events.push(`second:${codeOf(error)}`), resolve()));
        await closeOf(stream);
        await Promise.race([bothSaid, turns(10)]);
        const expected = [...errors.map(code => `error:${code}`), "close", "first:ECANCELED", "second:ECANCELED"];
        assert.deepStrictEqual(events, expected);
      } finally {
        session.destroy();
        peer.close();
      }
    });
  }

  // Over a JS stream the server answers inside the write call of the request. The 'response'
  // listener destroys the request there, while the write call is still on the stack.
  for (const [name, error, expected] of [
    ["destroy(error)", mine, ["error:MINE", "close", "write:ECANCELED", "late:MINE", "end:MINE"]],
    ["destroy()", undefined, ["close", "write:ECANCELED", "late:ECANCELED", "end:ECANCELED"]],
  ] as const) {
    test(`the write in flight is cancelled when ${name} runs inside the write call`, async () => {
      const { promise: serverHasStream, resolve: gotStream } = Promise.withResolvers<void>();
      const server = http2.createServer();
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        // One chunk is read, and the rest of the first window stays unread: no WINDOW_UPDATE.
        stream.once("data", () => {
          stream.pause();
          stream.respond({ ":status": 200 });
        });
        gotStream();
      });
      const [clientSide, serverSide] = duplexPair();
      server.emit("connection", serverSide);
      const session = http2.connect("http://localhost", { createConnection: () => clientSide });
      try {
        session.on("error", () => {});
        await once(session, "connect");
        const request = session.request({ ":method": "POST", ":path": "/" });
        const events: string[] = [];
        const { promise: allSaid, resolve: done } = Promise.withResolvers<void>();
        const say = (who: string) => (error?: Error | null) => {
          events.push(`${who}:${codeOf(error)}`);
          if (who === "end") done();
        };
        request.on("error", error => events.push(`error:${codeOf(error)}`));
        request.on("close", () => events.push("close"));
        let writing = false;
        let destroyedWhileWriting = false;
        request.on("response", () => {
          destroyedWhileWriting = writing;
          request.write("late", say("late"));
          request.end(say("end"));
          request.destroy(error);
        });
        await serverHasStream;
        // Leave the read of the server that delivered the request: write() must start the exchange.
        await turns(1);
        writing = true;
        request.write(MB, say("write"));
        writing = false;
        await Promise.race([allSaid, turns(20)]);
        // The premise, in Bun: the answer came inside write(). node answers in a later turn.
        if (isBun) assert.strictEqual(destroyedWhileWriting, true);
        assert.deepStrictEqual(events, expected);
      } finally {
        session.destroy();
        server.close();
      }
    });
  }

  // The peer opens every window and reads nothing, so only the socket holds the upload. In Bun
  // the body is then in the buffer of the session, and the END_STREAM frame waits behind it.
  // node v26.3.0 never closes this stream (nodejs/node#58252), so these two run in Bun only.
  // On Windows the socket takes the whole upload at once.
  const blockedAsks: [string, (request: http2.ClientHttp2Stream) => Promise<string>][] = [
    ["pipeline(source, request)", request => pipeline(Readable.from([BIG]), request).then(() => "ok", codeOf)],
    [
      "request.end(callback) after a write",
      request =>
        new Promise(resolve => {
          request.write(BIG);
          request.end((error?: Error | null) => resolve(codeOf(error)));
        }),
    ],
  ];
  for (const [name, ask] of blockedAsks) {
    const title = `${name} gets the error of the stream when the peer resets it behind a blocked socket`;
    test(title, { skip: !blocksSocket }, async () => {
      const MAX = 0x7fffffff;
      const { promise: accepted, resolve: accept } = Promise.withResolvers<net.Socket>();
      const server = net.createServer(socket => {
        socket.on("error", () => {});
        socket.pause();
        socket.write(
          Buffer.concat([
            frame(FRAME.SETTINGS, 0, 0, Buffer.concat([Buffer.from([0, 4]), uint32(MAX)])),
            frame(FRAME.WINDOW_UPDATE, 0, 0, uint32(MAX - WINDOW)),
          ]),
        );
        accept(socket);
      });
      const port = await listen(server);
      const session = http2.connect(`http://127.0.0.1:${port}`, { maxSessionMemory: 1000 });
      try {
        session.on("error", () => {});
        await once(session, "remoteSettings");
        // The WINDOW_UPDATE frame is in the same read as the SETTINGS frame.
        await turns(1);
        const request = session.request({ ":method": "POST", ":path": "/" });
        const events: string[] = [];
        request.on("error", error => events.push(`error:${codeOf(error)}`));
        request.on("finish", () => events.push("finish"));
        const closed = closeOf(request);
        const answer = ask(request);
        for (let i = 0; i < 20 && session.state.outboundQueueSize === 0; i++) await turns(1);
        assert.notStrictEqual(session.state.outboundQueueSize, 0);
        (await accepted).write(frame(FRAME.RST_STREAM, 0, 1, uint32(NGHTTP2_INTERNAL_ERROR)));
        await closed;
        assert.deepStrictEqual(
          { answer: await answer, events },
          { answer: "ERR_HTTP2_STREAM_ERROR", events: ["error:ERR_HTTP2_STREAM_ERROR"] },
        );
      } finally {
        session.destroy();
        (await accepted).destroy();
        server.close();
      }
    });
  }

  // After RST_STREAM(CANCEL) the listener runs outside the teardown, and its error is uncaught in
  // both runtimes. After another code node does the same. Bun emits 'aborted' inside the teardown:
  // the error of the listener is then the error of the stream. The write is cancelled in each case.
  for (const [name, code] of [
    ["NGHTTP2_CANCEL", NGHTTP2_CANCEL],
    ["NGHTTP2_INTERNAL_ERROR", NGHTTP2_INTERNAL_ERROR],
    ["NGHTTP2_REFUSED_STREAM", NGHTTP2_REFUSED_STREAM],
  ] as const) {
    const title = `the write in flight is cancelled when an 'aborted' listener throws after RST_STREAM(${name})`;
    test(title, childTest, async () => {
      const events = await inChild(resetUploadScript(code, throwingAbortedListener("request")));
      const inTeardown = isBun && code !== NGHTTP2_CANCEL;
      const thrown = inTeardown ? "error:thrown by the listener" : "uncaught:thrown by the listener";
      assert.deepStrictEqual(events, [thrown, "write:ECANCELED"]);
    });
  }

  // node emits the error of the stream, and nothing handles it here. Bun emits no 'error' on a
  // stream that has no listener for it. The write fails in both.
  test("the write in flight is cancelled on a stream that has no 'error' listener", childTest, async () => {
    const events: string[] = await inChild(resetUploadScript(NGHTTP2_REFUSED_STREAM, ""));
    assert.strictEqual(events.at(-1), "write:ECANCELED");
  });

  // node ends the writable side of a pushed stream when it makes the stream. Bun's native write
  // has no entry for it. Both report that to each callback, once, and nothing throws.
  type Push = http2.ClientHttp2Stream;
  type Said = (error?: Error | null) => void;
  const onPushedStream: [string, (pushed: Push, said: Said) => void, number][] = [
    ["a write", (pushed, said) => void pushed.write("chunk", said), 1],
    [
      "two corked writes",
      (pushed, said) => {
        pushed.cork();
        pushed.write("one", said);
        pushed.write("two", said);
        pushed.uncork();
      },
      2,
    ],
    ["end(callback)", (pushed, said) => void pushed.end(said), 1],
  ];
  for (const [name, act, count] of onPushedStream) {
    test(`${name} on a pushed stream: each callback gets an error`, async () => {
      const server = http2.createServer();
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        stream.pushStream({ ":path": "/pushed" }, (error, push) => {
          if (error) return;
          push.on("error", () => {});
          push.respond({ ":status": 200 });
          push.end("pushed");
        });
        stream.respond({ ":status": 200 });
        stream.end("ok");
      });
      const port = await listen(server);
      const session = connectOverTcp(port);
      try {
        session.on("error", () => {});
        const failed: boolean[] = [];
        let threw = false;
        const { promise: allSaid, resolve } = Promise.withResolvers<void>();
        session.on("stream", (pushed: Push) => {
          pushed.on("error", () => {});
          pushed.resume();
          try {
            act(pushed, error => void (failed.push(error != null) === count && resolve()));
          } catch {
            threw = true;
            resolve();
          }
        });
        const request = session.request({ ":path": "/" });
        request.on("error", () => {});
        request.resume();
        request.end();
        await allSaid;
        await turns(2);
        assert.deepStrictEqual({ threw, failed }, { threw: false, failed: Array(count).fill(true) });
      } finally {
        session.destroy();
        server.close();
      }
    });
  }

  // Code that calls `_write` itself (a tracer, a stream that forwards its writes) owns the
  // callback that it passed. The write completes through that callback, once.
  for (const [name, chunk, grant, expected] of [
    ["a chunk that left", Buffer.from("chunk"), false, ["ok"]],
    ["a chunk that the session queued and then sent", MB, true, ["ok"]],
    ["a chunk that the session queued", MB, false, ["ECANCELED"]],
  ] as const) {
    test(`a direct _write() call with ${name} calls back once, also after destroy()`, async () => {
      const peer = await rawServer({ grant });
      const session = connectOverTcp(peer.port);
      try {
        session.on("error", () => {});
        const stream = session.request({ ":method": "POST", ":path": "/" });
        stream.on("error", () => {});
        await once(stream, "ready");
        const said: string[] = [];
        const { promise: called, resolve } = Promise.withResolvers<void>();
        stream._write(chunk, "buffer" as BufferEncoding, error => {
          said.push(codeOf(error));
          resolve();
        });
        await (expected[0] === "ok" ? called : peer.windowFull);
        const closed = closeOf(stream);
        stream.destroy();
        await closed;
        await Promise.race([called, turns(10)]);
        await turns(2);
        assert.deepStrictEqual(said, expected);
      } finally {
        session.destroy();
        peer.close();
      }
    });
  }

  test("a wrapper around _write() sees the write that the teardown cancels", async () => {
    const peer = await rawServer();
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      const stream = session.request({ ":method": "POST", ":path": "/" });
      stream.on("error", () => {});
      await once(stream, "ready");
      const seen: string[] = [];
      const write = stream._write;
      stream._write = function (chunk, encoding, callback) {
        write.call(this, chunk, encoding, error => {
          seen.push(`wrapper:${codeOf(error)}`);
          callback(error);
        });
      };
      const { promise: called, resolve } = Promise.withResolvers<void>();
      stream.write(MB, error => {
        seen.push(`write:${codeOf(error)}`);
        resolve();
      });
      await peer.windowFull;
      const closed = closeOf(stream);
      stream.destroy();
      await closed;
      await Promise.race([called, turns(10)]);
      assert.deepStrictEqual(seen, ["wrapper:ECANCELED", "write:ECANCELED"]);
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // node runs the callback in the store of the writer. Bun has no store there yet. Neither
  // runs it in the store that was current when the session was made.
  test("the callback of a queued write does not see the AsyncLocalStorage store of http2.connect()", async () => {
    const storage = new AsyncLocalStorage<string>();
    const peer = await rawServer({ grant: true });
    const session = storage.run("session", () => connectOverTcp(peer.port));
    try {
      session.on("error", () => {});
      await once(session, "connect");
      const stream = session.request({ ":method": "POST", ":path": "/" });
      stream.on("error", () => {});
      stream.resume();
      const store = await new Promise(resolve =>
        storage.run("writer", () => stream.write(MB, () => resolve(storage.getStore()))),
      );
      assert.notStrictEqual(store, "session");
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // The session never got this write, so it has nothing to cancel: the holder completes it.
  test("destroy() leaves a write alone that a replaced _write() holds", async () => {
    const peer = await rawServer();
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      const stream = session.request({ ":method": "POST", ":path": "/" });
      const events: string[] = [];
      stream.on("error", () => {});
      stream.on("close", () => events.push("close"));
      await once(stream, "ready");
      let held: ((error?: Error | null) => void) | undefined;
      stream._write = (_chunk, _encoding, callback) => void (held = callback);
      stream.write("chunk", error => events.push(`write:${codeOf(error)}`));
      const closed = closeOf(stream);
      stream.destroy();
      await closed;
      await turns(4);
      assert.deepStrictEqual(events, ["close"]);
      held!();
      assert.deepStrictEqual(events, ["close", "write:ok"]);
    } finally {
      session.destroy();
      peer.close();
    }
  });
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
  // [name, how the client leaves, whether node calls back]. After RST_STREAM(NO_ERROR) node
  // keeps the stream of the server open, and the write waits for the session to end.
  const leaves: [string, (socket: net.Socket) => void, boolean][] = [
    ["cancels the stream", socket => socket.write(frame(FRAME.RST_STREAM, 0, 1, uint32(NGHTTP2_CANCEL))), true],
    ["destroys its session", socket => socket.end(frame(FRAME.GOAWAY, 0, 0, uint32(0, NGHTTP2_NO_ERROR))), true],
    ["resets the connection", socket => socket.resetAndDestroy(), true],
    [
      "resets the stream with NO_ERROR",
      socket => socket.write(frame(FRAME.RST_STREAM, 0, 1, uint32(NGHTTP2_NO_ERROR))),
      false,
    ],
  ];
  type Say = (answer: string) => void;
  // A client that closes its connection: Bun completes the write in flight with no error, and
  // "streams build no frames for what they have buffered when the transport closes" in
  // node-http2.test.js holds that. The response still does not finish. node v26.3.0 cancels the
  // write, as after every other way of leaving.
  const [writeAtClose, endAtClose] = isBun ? ["ok", "ERR_STREAM_DESTROYED"] : ["ECANCELED", "ECANCELED"];
  // [name, how the server answers, the code it hears for each way of leaving]. `null` is the
  // error of the stream after a connection reset: the socket chooses its code.
  const answers: [string, (stream: http2.ServerHttp2Stream, say: Say) => void, (string | null)[]][] = [
    [
      "stream.write(chunk, callback)",
      (stream, say) => {
        stream.respond({ ":status": 200 });
        stream.write(MB, error => say(codeOf(error)));
      },
      ["ECANCELED", writeAtClose, "ECANCELED", "ECANCELED"],
    ],
    [
      "stream.end(chunk, callback)",
      (stream, say) => {
        stream.respond({ ":status": 200 });
        stream.end(MB, (error?: Error) => say(codeOf(error)));
      },
      ["ECANCELED", endAtClose, null, "ECANCELED"],
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
      ["ERR_STREAM_PREMATURE_CLOSE", "ERR_STREAM_PREMATURE_CLOSE", null, "ERR_STREAM_PREMATURE_CLOSE"],
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
      ["ERR_STREAM_PREMATURE_CLOSE", "ERR_STREAM_PREMATURE_CLOSE", null, "ERR_STREAM_PREMATURE_CLOSE"],
    ],
  ];

  for (const [answerName, answer, codes] of answers) {
    leaves.forEach(([leaveName, leave, nodeCallsBack], way) => {
      const outcome = codes[way] === "ok" ? "completes" : "fails";
      test(`${answerName} ${outcome} when the client ${leaveName}`, { skip: !isBun && !nodeCallsBack }, async () => {
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

  leaves.forEach(([leaveName, leave, nodeCallsBack], way) => {
    const skip = !isBun && !nodeCallsBack;
    const code = way === 1 ? writeAtClose : "ECANCELED";
    const outcome = code === "ok" ? "completes" : "fails";
    test(`response.write(chunk, callback) ${outcome} when the client ${leaveName}`, { skip }, async () => {
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
        assert.strictEqual(await said, code);
      } finally {
        socket.destroy();
        server.close();
      }
    });
  });

  // The producer of #45728: it writes until write() returns false and goes on at 'drain'. After
  // the client left, no write may be accepted, or the producer never stops. When the client
  // closes its connection, Bun still emits the one 'drain' of the write that it completes.
  type Producer = (
    write: (chunk: Buffer) => boolean,
    isGone: () => boolean,
    on: (name: string, fn: () => void) => void,
  ) => void;
  const produce =
    (count: { drains: number; accepted: number }, hasLeft: () => boolean): Producer =>
    (write, isGone, on) => {
      const pump = () => {
        while (!isGone() && write(MB.subarray(0, 65536))) {
          if (hasLeft() && ++count.accepted === 1000) return;
        }
      };
      on("drain", () => {
        if (hasLeft()) count.drains++;
        pump();
      });
      pump();
    };
  leaves.slice(0, 3).forEach(([leaveName, leave], way) => {
    for (const api of ["stream", "response"] as const) {
      test(`a ${api} that is written until it is full stops when the client ${leaveName}`, async () => {
        const count = { drains: 0, accepted: 0 };
        let left = false;
        const producer = produce(count, () => left);
        const { promise: closed, resolve } = Promise.withResolvers<void>();
        const server =
          api === "stream"
            ? http2.createServer()
            : http2.createServer((_request, response) => {
                response.on("error", () => {});
                response.on("close", () => resolve());
                response.writeHead(200);
                producer(
                  chunk => response.write(chunk),
                  () => response.destroyed || response.stream.destroyed,
                  (name, fn) => void response.on(name, fn),
                );
              });
        server.on("sessionError", () => {});
        if (api === "stream") {
          server.on("stream", (stream: http2.ServerHttp2Stream) => {
            stream.on("error", () => {});
            stream.on("close", () => resolve());
            stream.respond({ ":status": 200 });
            producer(
              chunk => stream.write(chunk),
              () => stream.destroyed,
              (name, fn) => void stream.on(name, fn),
            );
          });
        }
        const port = await listen(server);
        const { socket, windowFull } = await rawRequest(port);
        try {
          await windowFull;
          left = true;
          leave(socket);
          await closed;
          await turns(2);
          assert.deepStrictEqual(count, { drains: isBun && way === 1 ? 1 : 0, accepted: 0 });
        } finally {
          socket.destroy();
          server.close();
        }
      });
    }
  });

  // The server twin of the client tests. RST_STREAM(CANCEL) reaches the 'aborted' handler of the
  // session, and another code reaches the teardown of the stream.
  for (const [name, code] of [
    ["NGHTTP2_CANCEL", NGHTTP2_CANCEL],
    ["NGHTTP2_INTERNAL_ERROR", NGHTTP2_INTERNAL_ERROR],
  ] as const) {
    const title = `response.write is cancelled when an 'aborted' listener throws after RST_STREAM(${name})`;
    test(title, childTest, async () => {
      const events = await inChild(resetDownloadScript(code, throwingAbortedListener("stream")));
      const inTeardown = isBun && code !== NGHTTP2_CANCEL;
      const thrown = inTeardown ? "error:thrown by the listener" : "uncaught:thrown by the listener";
      assert.deepStrictEqual(events, [thrown, "write:ECANCELED"]);
    });
  }

  // The first response is stalled on its window, with the rest of its body in the queue of the
  // session. In Bun the END_STREAM frame of the second response, which has no payload, waits
  // behind that body today (#43422 ends that wait). In the request handler the session is in
  // the middle of a read. In a later turn the flush at the end of end() sends the frame.
  const turnsOfEnd: [string, (end: () => void) => void][] = [
    ["in the request handler", end => end()],
    ["in a later turn", end => void setImmediate(end)],
  ];
  for (const [name, run] of turnsOfEnd) {
    test(`a response that ends ${name} finishes while another stream is stalled on its window`, async () => {
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

  // The transport is a JS stream that reports backpressure after every write, and 'drain' comes
  // one turn later. Every window is open. The first response writes a body, and the second one
  // ends in the same turn with no body: its END_STREAM frame waits for the transport.
  test("a response that ends behind the backpressure of a JS transport finishes", async () => {
    let settingsSeen = false;
    let buffered = Buffer.alloc(0);
    const transport = new Duplex({
      writableHighWaterMark: 1,
      read() {},
      write(chunk, _encoding, callback) {
        buffered = Buffer.concat([buffered, chunk]);
        while (buffered.length >= 9 && buffered.length >= 9 + buffered.readUIntBE(0, 3)) {
          if (buffered[3] === FRAME.SETTINGS && !(buffered[4] & 1)) settingsSeen = true;
          buffered = buffered.subarray(9 + buffered.readUIntBE(0, 3));
        }
        setImmediate(callback);
      },
    });
    const events: string[] = [];
    let first: http2.ServerHttp2Stream | undefined;
    let needDrain = false;
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    const server = http2.createServer();
    server.on("sessionError", () => {});
    server.on("stream", (stream: http2.ServerHttp2Stream, headers) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      if (headers[":path"] === "/first") return void (first = stream);
      stream.on("finish", () => events.push("finish"));
      stream.on("close", () => resolve());
      setImmediate(() => {
        first!.write(MB.subarray(0, 40000));
        needDrain = transport.writableNeedDrain;
        stream.end();
      });
    });
    server.emit("connection", transport);
    try {
      const MAX = 0x7fffffff;
      transport.push(
        Buffer.concat([
          PREFACE,
          frame(FRAME.SETTINGS, 0, 0, Buffer.concat([Buffer.from([0, 4]), uint32(MAX)])),
          frame(FRAME.WINDOW_UPDATE, 0, 0, uint32(MAX - WINDOW)),
          frame(FRAME.HEADERS, 0x5, 1, requestHeaders("GET", "/first")),
        ]),
      );
      for (let i = 0; i < 50 && !(settingsSeen && first); i++) await turns(1);
      transport.push(frame(FRAME.SETTINGS, 1, 0));
      await turns(3);
      transport.push(frame(FRAME.HEADERS, 0x5, 3, requestHeaders("GET", "/second")));
      await closed;
      // The premise, in Bun: the body went to the transport inside write(). node sends it later.
      if (isBun) assert.strictEqual(needDrain, true);
      assert.deepStrictEqual(events, ["finish"]);
    } finally {
      transport.destroy();
      server.close();
    }
  });

  // A file response writes its chunks to the session without the stream's Writable.
  const file = path.join(import.meta.dirname, "node-http2.test.js");
  const fileSize = fs.statSync(file).size;

  // A write with no respond() before it sends the response headers itself, and that publishes to
  // a diagnostics channel. A subscriber destroys the stream there. node v26.3.0 throws a TypeError
  // from write() in that case, so this runs in Bun only.
  for (const [name, error, expected] of [
    ["destroy(error)", Object.assign(new Error("mine"), { code: "MINE" }), ["error:MINE", "close", "write:ECANCELED"]],
    ["destroy()", undefined, ["close", "write:ECANCELED"]],
  ] as const) {
    const title = `the write is cancelled when ${name} runs inside the respond() that the write makes`;
    test(title, { skip: !isBun }, async () => {
      const events: string[] = [];
      const { promise: said, resolve: say } = Promise.withResolvers<void>();
      let target: http2.ServerHttp2Stream | undefined;
      const onHeadersSent = (message: unknown) => {
        const { stream } = message as { stream: http2.ServerHttp2Stream };
        if (stream === target) stream.destroy(error);
      };
      diagnosticsChannel.subscribe("http2.server.stream.finish", onHeadersSent);
      const server = http2.createServer();
      server.on("sessionError", () => {});
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        target = stream;
        stream.on("error", error => events.push(`error:${codeOf(error)}`));
        stream.on("close", () => events.push("close"));
        stream.write("chunk", error => {
          events.push(`write:${codeOf(error)}`);
          say();
        });
      });
      const port = await listen(server);
      const { socket } = await rawRequest(port);
      try {
        await said;
        assert.deepStrictEqual(events, expected);
      } finally {
        diagnosticsChannel.unsubscribe("http2.server.stream.finish", onHeadersSent);
        socket.destroy();
        server.close();
      }
    });
  }

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

  // A chunk of the file that the session drops never completes, so the 'close' of the stream is
  // what stops the read of the file. It closes the descriptor that respondWithFile opened, and
  // it leaves the descriptor of respondWithFD open for its owner.
  const fileErrors = [[], [], ["ECONNRESET"]];
  leaves.slice(0, 3).forEach(([leaveName, leave], way) => {
    for (const owned of [true, false]) {
      const api = owned ? "respondWithFile closes" : "respondWithFD keeps";
      test(`${api} its descriptor when the client ${leaveName} in the middle`, async () => {
        const errors: string[] = [];
        const { promise: closed, resolve } = Promise.withResolvers<void>();
        const { ino } = fs.statSync(file);
        let fd = owned ? -1 : fs.openSync(file, "r");
        const isOpen = () => {
          try {
            return fs.fstatSync(fd).ino === ino;
          } catch {
            return false;
          }
        };
        // respondWithFile opens the file with fs.open: the test learns the descriptor there.
        const open: (...args: any[]) => void = fs.open;
        if (owned) {
          fs.open = ((...args: any[]) =>
            open.call(fs, ...args.slice(0, -1), (error: Error | null, opened: number) => {
              fd = opened;
              args.at(-1)(error, opened);
            })) as typeof fs.open;
        }
        const server = http2.createServer();
        server.on("sessionError", () => {});
        server.on("stream", (stream: http2.ServerHttp2Stream) => {
          stream.on("error", error => errors.push(codeOf(error)));
          stream.on("close", () => resolve());
          if (owned) stream.respondWithFile(file);
          else stream.respondWithFD(fd);
        });
        const port = await listen(server);
        const { socket, windowFull } = await rawRequest(port);
        try {
          await windowFull;
          assert.strictEqual(isOpen(), true);
          leave(socket);
          await closed;
          // The close of the descriptor can run on another thread: poll, with a deadline.
          const deadline = Date.now() + 2000;
          while (owned && isOpen() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
          if (!owned) await turns(4);
          assert.deepStrictEqual({ errors, open: isOpen() }, { errors: fileErrors[way], open: !owned });
        } finally {
          fs.open = open as typeof fs.open;
          if (!owned) fs.closeSync(fd);
          socket.destroy();
          server.close();
        }
      });
    }
  });

  // statCheck makes the response a 304, which ends on its HEADERS frame: the session refuses
  // every chunk of the file. The request body is still open, so the stream does not close. The
  // read of the file must still end, and with it the descriptor closes.
  test("respondWithFile closes its descriptor when the response ended on its HEADERS frame", async () => {
    const { ino } = fs.statSync(file);
    let fd = -1;
    const isOpen = () => {
      try {
        return fs.fstatSync(fd).ino === ino;
      } catch {
        return false;
      }
    };
    const open: (...args: any[]) => void = fs.open;
    fs.open = ((...args: any[]) =>
      open.call(fs, ...args.slice(0, -1), (error: Error | null, opened: number) => {
        fd = opened;
        args.at(-1)(error, opened);
      })) as typeof fs.open;
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respondWithFile(file, {}, { statCheck: (_stat, headers) => void (headers[":status"] = 304) });
    });
    const port = await listen(server);
    const session = connectOverTcp(port);
    try {
      session.on("error", () => {});
      const request = session.request({ ":method": "POST", ":path": "/" });
      request.on("error", () => {});
      request.write("a part of the body");
      const [headers] = await once(request, "response");
      const deadline = Date.now() + 2000;
      while ((fd === -1 || isOpen()) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
      assert.deepStrictEqual(
        { status: headers[":status"], opened: fd !== -1, open: isOpen() },
        { status: 304, opened: true, open: false },
      );
    } finally {
      fs.open = open as typeof fs.open;
      session.destroy();
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

    // The write and the first chunk of the file end in one frame. The callback of the write
    // throws when that frame leaves: the chunk of the file must still complete.
    test("behind a closed window, the file arrives whole when the write callback throws", childTest, async () => {
      const script = `${CHILD_PRELUDE}
        const server = http2.createServer();
        server.on("stream", stream => {
          stream.on("error", () => {});
          stream.cork();
          stream.write("x", () => {
            throw new Error("thrown by the callback");
          });
          stream.respondWithFile(${JSON.stringify(file)}, {}, { length: 100 });
        });
        server.listen(0, "127.0.0.1", () => {
          const url = "http://127.0.0.1:" + server.address().port;
          const session = http2.connect(url, { settings: { initialWindowSize: 0 } });
          session.on("error", () => {});
          const request = session.request({ ":path": "/" });
          request.on("error", () => {});
          let received = 0;
          request.on("data", chunk => (received += chunk.length));
          request.on("end", () => finish("received:" + received));
          // Three round trips give the chunk of the file time to join the write in the queue.
          const open = () => session.settings({ initialWindowSize: ${WINDOW} });
          request.on("response", () => session.ping(() => session.ping(() => session.ping(open))));
          request.end();
        });
      `;
      assert.deepStrictEqual(await inChild(script), ["uncaught:thrown by the callback", "received:101"]);
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

  /**
   * A server whose socket is blocked: the client asked for `BIG` at /stalled and reads nothing.
   * Every flow-control window is open, so only the socket holds that response. `answer` gets
   * the stream of the second request. node does not read that request while its socket is blocked.
   */
  async function behindBlockedSocket(answer: (stream: http2.ServerHttp2Stream) => void) {
    const { promise: stalled, resolve: isStalled } = Promise.withResolvers<void>();
    const server = http2.createServer({ maxSessionMemory: 1000 });
    server.on("sessionError", () => {});
    server.on("stream", (stream: http2.ServerHttp2Stream, headers) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      if (headers[":path"] !== "/stalled") return answer(stream);
      stream.write(BIG);
      isStalled();
    });
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    await once(socket, "connect");
    socket.pause();
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
    const close = () => {
      socket.destroy();
      server.close();
    };
    return { socket, close };
  }

  // The empty END_STREAM frame of stream 3 waits behind the response of stream 1. close() must
  // not finish the response, or reset the stream, before that frame has left. On Windows the
  // socket takes the whole response of stream 1 at once, so nothing waits.
  const held = { skip: !blocksSocket };
  test("end() then close() behind socket backpressure finishes after END_STREAM leaves", held, async () => {
    const events: string[] = [];
    const { promise: answered, resolve: hasAnswered } = Promise.withResolvers<void>();
    const { promise: closed, resolve: hasClosed } = Promise.withResolvers<void>();
    const { socket, close } = await behindBlockedSocket(stream => {
      stream.on("finish", () => events.push("finish"));
      stream.on("close", () => hasClosed());
      stream.end();
      stream.close();
      hasAnswered();
    });
    try {
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
      close();
    }
  });

  // close(code) resets the stream at once, and the session drops the END_STREAM frame that
  // waited. The writable side had no body left to send, so the response still finishes.
  test("end(callback) then close(NGHTTP2_CANCEL) behind socket backpressure finishes", held, async () => {
    const events: string[] = [];
    const { promise: closed, resolve: hasClosed } = Promise.withResolvers<void>();
    const { close } = await behindBlockedSocket(stream => {
      stream.on("finish", () => events.push("finish"));
      stream.on("close", () => hasClosed());
      stream.end((error?: Error | null) => events.push(`end:${codeOf(error)}`));
      stream.close(NGHTTP2_CANCEL);
    });
    try {
      await closed;
      assert.deepStrictEqual(events, ["end:ok", "finish"]);
    } finally {
      close();
    }
  });

  // In the two HEAD flows node fails the write with ERR_STREAM_WRITE_AFTER_END and leaves the
  // stream open. In the two cork() flows node closes the stream and never calls the write back.
  // Bun completes the write with no error, and the response finishes and closes, as before.
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

  // END_STREAM is on the HEADERS frame, so the end of the writable side sends no frame of its
  // own. The HEADERS frame must still reach the transport before the session goes away, as it
  // does in node v26.3.0. node 26.9 and newer drop this response.
  for (const [name, method, status] of [
    ["a 204 response", "GET", 204],
    ["the response to HEAD", "HEAD", 200],
  ] as const) {
    test(`${name} leaves before a session.destroy() in the same tick, over a JS stream`, async () => {
      const server = http2.createServer();
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        stream.respond({ ":status": status });
        stream.session!.destroy();
      });
      const [clientSide, serverSide] = duplexPair();
      server.emit("connection", serverSide);
      const session = http2.connect("http://localhost", { createConnection: () => clientSide });
      try {
        session.on("error", () => {});
        const request = session.request({ ":method": method, ":path": "/" });
        request.on("error", () => {});
        const [headers] = await once(request, "response");
        assert.strictEqual(headers[":status"], status);
      } finally {
        session.destroy();
        server.close();
      }
    });
  }
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

  // end() takes the cork off, so the write reaches `_write` with no id and waits there for
  // 'ready'. destroy() comes first: the session never got the write, and nothing calls it back.
  test("destroy() does not settle a write that waits for 'ready' on a connecting request", async () => {
    const peer = await rawServer();
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      const request = session.request({ ":method": "POST", ":path": "/" });
      assert.strictEqual(request.pending, true);
      const events: string[] = [];
      request.on("error", () => {});
      request.on("close", () => events.push("close"));
      request.write("chunk", error => events.push(`write:${codeOf(error)}`));
      request.end((error?: Error) => events.push(`end:${codeOf(error)}`));
      const closed = closeOf(request);
      request.destroy();
      await closed;
      await turns(4);
      assert.deepStrictEqual(events, ["close"]);
    } finally {
      session.destroy();
      peer.close();
    }
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
  // moment before is dropped, and its write is cancelled before 'close'.
  test("request.close() with a body larger than the window while the session connects", async () => {
    const peer = await rawServer();
    const session = connectOverTcp(peer.port);
    try {
      session.on("error", () => {});
      const request = session.request({ ":method": "POST", ":path": "/" });
      assert.strictEqual(request.pending, true);
      const events = await writeAndEnd(request, MB, () => request.close());
      assert.deepStrictEqual(events, ["write:ECANCELED", "close"]);
    } finally {
      session.destroy();
      peer.close();
    }
  });

  // Bun rejects this :path in request() and destroys the request, which never gets an id. node
  // sends the request, and the server rejects it.
  describe("the session rejects the request", { skip: !isBun }, () => {
    test("a write gets an error", async () => {
      const peer = await rawServer();
      const session = connectOverTcp(peer.port);
      try {
        session.on("error", () => {});
        await once(session, "connect");
        const request = session.request({ ":method": "POST", ":path": "/a b" });
        assert.deepStrictEqual(await writeAndEnd(request, "chunk", () => {}), ["close", "write:ECANCELED"]);
      } finally {
        session.destroy();
        peer.close();
      }
    });

    // The peer allows one stream. The second request waits for the first one to close, and the
    // session rejects its header value only when its turn comes, so its HEADERS frame never
    // leaves. The first request closes in the tick that makes the second one, which is still
    // corked then: the teardown must not send its write.
    test("a write on a request that is rejected when its turn comes fails, and no frame leaves", async () => {
      const wire: string[] = [];
      const peer = await rawServer({
        settings: Buffer.from([0, 3, 0, 0, 0, 1]),
        onHeaders: (_socket, streamId) => void (streamId === 3 && wire.push("HEADERS")),
        onData: (_socket, streamId) => void (streamId === 3 && wire.push("DATA")),
      });
      const session = connectOverTcp(peer.port);
      try {
        session.on("error", () => {});
        await once(session, "remoteSettings");
        const first = session.request({ ":method": "POST", ":path": "/" });
        first.on("error", () => {});
        await turns(2);
        first.destroy();
        const request = session.request({ ":method": "POST", ":path": "/", ":authority": "a\nb" });
        assert.strictEqual(request.pending, true);
        const events: string[] = [];
        request.on("error", error => events.push(`error:${codeOf(error)}`));
        request.on("close", () => events.push("close"));
        const closed = closeOf(request);
        request.write("chunk", error => events.push(`write:${codeOf(error)}`));
        await closed;
        // Everything that this session sent has arrived when its PING comes back.
        await new Promise<void>((resolve, reject) => session.ping(error => (error ? reject(error) : resolve())));
        assert.deepStrictEqual(
          { events, wire },
          {
            events: ["write:ERR_HTTP2_INVALID_HEADER_VALUE", "error:ERR_HTTP2_INVALID_HEADER_VALUE", "close"],
            wire: [],
          },
        );
      } finally {
        session.destroy();
        peer.close();
      }
    });

    // close() must not send RST_STREAM for a request with no id.
    test("request.close() closes the request", async () => {
      const peer = await rawServer();
      const session = connectOverTcp(peer.port);
      try {
        session.on("error", () => {});
        await once(session, "connect");
        const request = session.request({ ":path": "/a b" });
        request.on("error", () => {});
        const closed = closeOf(request);
        request.close();
        await closed;
        await turns(2);
      } finally {
        session.destroy();
        peer.close();
      }
    });
  });

  // The upload of the first request blocks the socket: the peer opens every window and reads
  // nothing. The second request waits behind the peer's stream limit, ends and closes. When it
  // gets its id, its END_STREAM frame waits for the socket, and close() sends RST_STREAM right
  // after the HEADERS frame: the session drops the frame that waited. The request had no body
  // left to send, so it finishes and closes.
  test(
    "a request that ended and closed before it had an id finishes without its END_STREAM frame",
    {
      skip: !blocksSocket,
    },
    async () => {
      const sockets = new Set<net.Socket>();
      const MAX = 0x7fffffff;
      // SETTINGS_INITIAL_WINDOW_SIZE = 2^31-1, SETTINGS_MAX_CONCURRENT_STREAMS = 1.
      const settings = Buffer.concat([Buffer.from([0, 4]), uint32(MAX), Buffer.from([0, 3]), uint32(1)]);
      const opened = Buffer.concat([
        frame(FRAME.SETTINGS, 0, 0, settings),
        frame(FRAME.WINDOW_UPDATE, 0, 0, uint32(MAX - WINDOW)),
      ]);
      const server = net.createServer(socket => {
        sockets.add(socket);
        socket.on("error", () => {});
        socket.pause();
        socket.write(opened);
      });
      const port = await listen(server);
      const session = http2.connect(`http://127.0.0.1:${port}`, { maxSessionMemory: 1000 });
      try {
        session.on("error", () => {});
        await once(session, "remoteSettings");
        // The WINDOW_UPDATE frame is in the same read as the SETTINGS frame.
        await turns(1);
        const upload = session.request({ ":method": "POST", ":path": "/" });
        upload.on("error", () => {});
        await new Promise<void>(resolve => upload.write(BIG, () => resolve()));

        const request = session.request({ ":method": "POST", ":path": "/" });
        request.on("error", () => {});
        assert.strictEqual(request.pending, true);
        const events: string[] = [];
        request.on("finish", () => events.push("finish"));
        const closed = closeOf(request);
        request.end();
        request.close();
        upload.destroy();
        await closed;
        assert.deepStrictEqual(events, ["finish"]);
      } finally {
        session.destroy();
        for (const socket of sockets) socket.destroy();
        server.close();
      }
    },
  );

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

// The header says that node runs this file too. This holds it in CI, where the `node` on the
// machine is the version that Bun reports. musl has no such node (see node-http2-client-close.test.ts).
if (typeof Bun !== "undefined") {
  const node = Bun.which("node");
  const version = node ? Bun.spawnSync([node, "-p", "process.versions.node"]).stdout.toString().trim() : "";
  const isMusl =
    process.platform === "linux" &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  describe("Node.js compatibility", () => {
    const skip = version !== process.versions.node || isMusl;
    test("the tests pass on the node that Bun reports", { skip, timeout: 120_000 }, async () => {
      await using proc = Bun.spawn({
        cmd: [node as string, "--v8-pool-size=1", import.meta.filename],
        env: { ...process.env, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.strictEqual(exitCode, 0, stdout + stderr);
    });
  });
}
