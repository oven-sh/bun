import { http2StreamTables } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import http2 from "node:http2";
import path from "node:path";
import { Duplex } from "node:stream";

// The spawned fixtures finish in well under a second in release but take
// several seconds under the ASAN-instrumented, unoptimized debug build, so
// the default 5s per-test budget kills them before they can exit.
const ASAN_MULTIPLIER = isDebug ? 10 : isASAN ? 3 : 1;

// H2FrameParser stored Stream by value in a HashMap. Any *Stream obtained
// from getPtr/value_ptr/valueIterator pointed into the map's backing storage
// and dangled if a re-entrant JS callback inserted a new stream and triggered
// a rehash. Streams are now heap-allocated and stored by pointer, so *Stream
// is stable for the lifetime of the H2FrameParser regardless of map growth.
// These three tests cover the call sites where this was observed under ASAN.

test(
  "session.request() from a stream 'timeout' listener during forEachStream does not UAF on hashmap rehash",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", path.join(import.meta.dir, "node-http2-foreach-rehash.fixture.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({ stdout: "OK", exitCode: 0 });
  },
  10_000 * ASAN_MULTIPLIER,
);

test(
  "http2 client request() does not hold *Stream across user-controlled options getters",
  async () => {
    const script = /* js */ `
    const http2 = require("node:http2");

    const server = http2.createServer();
    server.on("stream", (stream) => {
      stream.respond({ ":status": 200 });
      stream.end();
    });
    server.on("error", () => {});

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const client = http2.connect("http://127.0.0.1:" + port);
      client.on("error", () => {});

      client.on("connect", () => {
        let triggered = false;

        // Use a POST so the options object is passed through to the native
        // parser without being shallow-copied.
        const options = {
          get paddingStrategy() {
            if (!triggered) {
              triggered = true;
              // Insert enough new streams to force the HashMap to rehash,
              // invalidating any *Stream pointer held by the outer request().
              for (let i = 0; i < 128; i++) {
                const r = client.request({ ":path": "/", ":method": "GET" });
                r.on("error", () => {});
                r.on("response", () => {});
                r.resume();
              }
            }
            return 0;
          },
          // Ensure the outer request writes through the (previously dangling)
          // stream pointer after the getter returns.
          exclusive: true,
          parent: 1,
          weight: 16,
          waitForTrailers: false,
          endStream: true,
        };

        const req = client.request({ ":path": "/", ":method": "POST" }, options);
        req.on("error", () => {});
        req.on("response", () => {});
        req.resume();
        req.on("close", () => {
          client.close(() => {
            server.close(() => {
              if (!triggered) {
                console.error("getter was never invoked");
                process.exit(1);
              }
              console.log("done");
              process.exit(0);
            });
          });
        });
        req.end();
      });
    });
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({ stdout: "done", exitCode: 0 });
  },
  10_000 * ASAN_MULTIPLIER,
);

// handle_received_stream_id invoked the JS streamStart callback without arming the
// dispatch guard while holding the just-created *Stream. JS reached from inside that
// callback (here: EventEmitter.prototype.on, called by the Http2Stream constructor)
// could close the stream and then re-enter parser.read() at dispatch depth 0, where
// the deferred-close drain frees the Stream box; the native caller then wrote the
// stream context through the dangling pointer (ASAN: heap-use-after-free in
// Stream::set_context). The parser is driven directly because the hook must observe
// the window inside the native callback, before setStreamContext runs.
test(
  "closing the new stream and re-entering read() inside the streamStart callback does not UAF",
  async () => {
    const script = /* js */ `
    const http2 = require("node:http2");
    const { Duplex } = require("node:stream");
    const EE = require("node:events");

    const socket = new Duplex({
      write(chunk, enc, cb) {
        cb();
      },
      read() {},
    });

    const session = http2.performServerHandshake(socket);
    const parser = session[Symbol.for("::bunhttp2native::")];

    const origOn = EE.prototype.on;
    let hooked = false;
    let armed = false;
    EE.prototype.on = function (ev, fn) {
      // Http2Stream's constructor calls this.on("pause", ...) from inside the
      // native onStreamStart callback for the stream getNextStream() allocates.
      if (armed && ev === "pause") {
        armed = false;
        hooked = true;
        parser.rstStream(2, 8 /* NGHTTP2_CANCEL */); // queue the new stream's deferred close
        parser.read(Buffer.from("PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n")); // depth-0 read used to drain it
      }
      return origOn.call(this, ev, fn);
    };

    armed = true;
    const id = parser.getNextStream();
    EE.prototype.on = origOn;
    if (!hooked) {
      console.error("hook was never invoked");
      process.exit(1);
    }
    if (id !== 2) {
      console.error("unexpected stream id: " + id);
      process.exit(1);
    }
    // The close must have been deferred, not drained inside the callback: the native
    // entry is still alive (pre-fix this throws "Invalid stream id" on every build
    // tier because the drain freed it), and no context may have been installed for
    // the closed stream (a guard-only fix would return the Http2Stream here).
    let ctx;
    try {
      ctx = parser.getStreamContext(2);
    } catch (e) {
      console.error("getStreamContext threw: " + e.message);
      process.exit(1);
    }
    if (ctx !== undefined) {
      console.error("context installed for closed stream");
      process.exit(1);
    }
    // One depth-0 read runs the deferred drain; the entry must actually go away.
    parser.read(Buffer.alloc(0));
    let drained = false;
    try {
      parser.getStreamContext(2);
    } catch (e) {
      if (e.message !== "Invalid stream id") {
        console.error("unexpected getStreamContext error: " + e.message);
        process.exit(1);
      }
      drained = true;
    }
    if (!drained) {
      console.error("deferred close never drained");
      process.exit(1);
    }
    session.destroy();
    console.log("OK");
    process.exit(0);
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({ stdout: "OK", exitCode: 0 });
  },
  10_000 * ASAN_MULTIPLIER,
);

test(
  "http2 client write callback that opens new streams during flushQueue does not UAF",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "node-http2-flush-rehash.fixture.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({ stdout: "ok", exitCode: 0 });
  },
  10_000 * ASAN_MULTIPLIER,
);

// H2FrameParser::on_auto_flush calls flush -> uncork -> unregister_auto_flush,
// removing its own entry from the DeferredTaskQueue mid-iteration and then
// returning true. With a second auto-flusher (an HTTPServerWritable small
// write) sitting after it in the map, DeferredTaskQueue::run would index past
// the new length and panic.
test(
  "DeferredTaskQueue::run tolerates an on_auto_flush callback that unregisters itself and returns true",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "node-http2-deferred-task-queue.fixture.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({ stdout: "OK", exitCode: 0 });
  },
  10_000 * ASAN_MULTIPLIER,
);

// A session keeps three native tables keyed by stream id: the parser's streams, the per-stream
// JS context roots, and the inbound engine's streams. Stream ids only rise, so every stream is a
// new key, and the key is removed when the stream closes. The tables must stay dense: after a
// burst of streams, a full walk reads one position for each stream that is still open, not one
// for each stream the session once held at the same time. `http2StreamTables` reports, for each
// table, the entry count (`len`) and the positions a full walk reads (`walkPositions`).

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
const FRAME = { DATA: 0x0, HEADERS: 0x1, RST_STREAM: 0x3, SETTINGS: 0x4, PUSH_PROMISE: 0x5, PING: 0x6 };
const FLAG = { END_STREAM: 0x1, ACK: 0x1, END_HEADERS: 0x4 };
// :method GET, :scheme http, :path / from the HPACK static table, then a literal :authority.
const GET_BLOCK = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01, 9]), Buffer.from("localhost")]);
// :status 200 from the HPACK static table.
const OK_BLOCK = Buffer.from([0x88]);

type Frame = { type: number; flags: number; streamId: number; payload: Buffer };

function frame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header.writeUInt8(type, 3);
  header.writeUInt8(flags, 4);
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

/** The other end of one session's transport. The test sends frames and reads what the session writes. */
class Peer {
  frames: Frame[] = [];
  socket: Duplex;
  #unparsed = Buffer.alloc(0);
  #waiters: { matches: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];
  #prefaceLeft: number;
  #pings = 0;

  /** `prefaceLength` is the length of the client preface the session writes before its frames. */
  constructor(prefaceLength: number) {
    this.#prefaceLeft = prefaceLength;
    this.socket = new Duplex({
      read() {},
      write: (chunk: Buffer, _encoding, callback) => {
        this.#onWrite(chunk);
        callback();
      },
    });
  }

  #onWrite(chunk: Buffer) {
    const skip = Math.min(this.#prefaceLeft, chunk.length);
    this.#prefaceLeft -= skip;
    this.#unparsed = Buffer.concat([this.#unparsed, chunk.subarray(skip)]);
    while (this.#unparsed.length >= 9) {
      const length = this.#unparsed.readUIntBE(0, 3);
      if (this.#unparsed.length < 9 + length) break;
      const written: Frame = {
        type: this.#unparsed.readUInt8(3),
        flags: this.#unparsed.readUInt8(4),
        streamId: this.#unparsed.readUInt32BE(5) & 0x7fffffff,
        payload: this.#unparsed.subarray(9, 9 + length),
      };
      this.#unparsed = this.#unparsed.subarray(9 + length);
      this.frames.push(written);
      this.#waiters = this.#waiters.filter(waiter => {
        if (!waiter.matches(written)) return true;
        waiter.resolve(written);
        return false;
      });
    }
  }

  /** Resolves with the first frame the session writes from now on that `matches`. */
  next(matches: (f: Frame) => boolean): Promise<Frame> {
    const { promise, resolve } = Promise.withResolvers<Frame>();
    this.#waiters.push({ matches, resolve });
    return promise;
  }

  send(...frames: Buffer[]) {
    this.socket.push(Buffer.concat(frames));
  }

  /**
   * One more read, which the session answers. A read starts with the release of the native
   * entries of the streams that closed before it, so the tables are settled after this.
   */
  async roundTrip() {
    const payload = Buffer.concat([uint32(0), uint32(++this.#pings)]);
    const answered = this.next(f => f.type === FRAME.PING && (f.flags & FLAG.ACK) !== 0 && f.payload.equals(payload));
    this.send(frame(FRAME.PING, 0, 0, payload));
    await answered;
    // The session writes the answer inside the read. Let that read return.
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

function tablesOf(session: http2.Http2Session) {
  return http2StreamTables((session as any)[Symbol.for("::bunhttp2native::")]);
}

function dense(len: number) {
  const table = { len, walkPositions: len };
  return { streams: table, contexts: table, engine: table };
}

test(
  "a server session's stream tables stay dense after a burst of streams",
  async () => {
    const BURST = 48;
    const KEPT = 16;
    const peer = new Peer(0);
    const session = http2.performServerHandshake(peer.socket);
    try {
      const burst: http2.ServerHttp2Stream[] = [];
      const bodies = new Map<number, string>();
      const allOpen = Promise.withResolvers<void>();
      const burstClosed = Promise.withResolvers<void>();
      let burstLeft = BURST;
      const keptClosed: number[] = [];
      let onKeptClosed = () => {};
      session.on("stream", stream => {
        stream.on("error", () => {});
        stream.respond({ ":status": 200 });
        if (stream.id < BURST * 2) {
          burst.push(stream);
          stream.on("close", () => {
            if (--burstLeft === 0) burstClosed.resolve();
          });
        } else {
          let body = "";
          stream.setEncoding("latin1");
          stream.on("data", chunk => (body += chunk));
          stream.on("end", () => {
            bodies.set(stream.id, body);
            stream.end();
          });
          stream.on("close", () => {
            keptClosed.push(stream.id);
            onKeptClosed();
          });
        }
        if (stream.id === (BURST + KEPT) * 2 - 1) allOpen.resolve();
      });
      const untilKeptClosed = (count: number) => {
        const { promise, resolve } = Promise.withResolvers<void>();
        onKeptClosed = () => {
          if (keptClosed.length === count) resolve();
        };
        onKeptClosed();
        return promise;
      };

      peer.send(PREFACE, frame(FRAME.SETTINGS, 0, 0));
      // One read opens every stream: BURST complete requests, then KEPT requests with an open body.
      const opening: Buffer[] = [];
      const keptIds: number[] = [];
      let id = 1;
      for (let i = 0; i < BURST; i++, id += 2) {
        opening.push(frame(FRAME.HEADERS, FLAG.END_HEADERS | FLAG.END_STREAM, id, GET_BLOCK));
      }
      for (let i = 0; i < KEPT; i++, id += 2) {
        opening.push(frame(FRAME.HEADERS, FLAG.END_HEADERS, id, GET_BLOCK));
        keptIds.push(id);
      }
      peer.send(...opening);
      await allOpen.promise;
      await peer.roundTrip();
      expect(tablesOf(session)).toEqual(dense(BURST + KEPT));

      for (const stream of burst) stream.end();
      await burstClosed.promise;
      await peer.roundTrip();
      expect(tablesOf(session)).toEqual(dense(KEPT));

      // Close every second stream that is left. That moves the entries of the others inside
      // the tables. Each of the others must still get the frames with its own id.
      const first = keptIds.filter((_, i) => i % 2 === 0);
      const second = keptIds.filter((_, i) => i % 2 === 1);
      const end = (id: number) => frame(FRAME.DATA, FLAG.END_STREAM, id, Buffer.from(`body of stream ${id}`));
      peer.send(...first.map(end));
      await untilKeptClosed(first.length);
      await peer.roundTrip();
      expect({ closed: keptClosed.toSorted((a, b) => a - b), tables: tablesOf(session) }).toEqual({
        closed: first,
        tables: dense(second.length),
      });

      peer.send(...second.map(end));
      await untilKeptClosed(KEPT);
      await peer.roundTrip();
      expect({
        bodies: [...bodies].sort((a, b) => a[0] - b[0]),
        // Every stream got a response that ends: END_STREAM on a HEADERS or DATA frame.
        answered: new Set(
          peer.frames.filter(f => f.type <= FRAME.HEADERS && (f.flags & FLAG.END_STREAM) !== 0).map(f => f.streamId),
        ).size,
        tables: tablesOf(session),
      }).toEqual({
        bodies: keptIds.map(id => [id, `body of stream ${id}`]),
        answered: BURST + KEPT,
        tables: dense(0),
      });
    } finally {
      session.destroy();
    }
  },
  10_000 * ASAN_MULTIPLIER,
);

test(
  "a client session's stream tables stay dense after a flood of pushed streams that the server resets",
  async () => {
    const PUSHES = 100;
    const CANCEL = 0x8;
    const peer = new Peer(PREFACE.length);
    const client = http2.connect("http://localhost", { createConnection: () => peer.socket });
    try {
      client.on("error", () => {});
      let pushed = 0;
      let closed = 0;
      const allClosed = Promise.withResolvers<void>();
      client.on("stream", stream => {
        pushed++;
        stream.on("error", () => {});
        stream.on("close", () => {
          if (++closed === PUSHES) allClosed.resolve();
        });
      });
      // Stream 1 stays open. It is the parent of every push.
      const requestSent = peer.next(f => f.type === FRAME.HEADERS && f.streamId === 1);
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      const responded = Promise.withResolvers<void>();
      req.on("response", () => responded.resolve());
      await requestSent;

      // One read: the response headers, then every PUSH_PROMISE with the RST_STREAM that cancels it.
      const flood = [
        frame(FRAME.SETTINGS, 0, 0),
        frame(FRAME.SETTINGS, FLAG.ACK, 0),
        frame(FRAME.HEADERS, FLAG.END_HEADERS, 1, OK_BLOCK),
      ];
      for (let promised = 2; promised <= PUSHES * 2; promised += 2) {
        flood.push(
          frame(FRAME.PUSH_PROMISE, FLAG.END_HEADERS, 1, Buffer.concat([uint32(promised), GET_BLOCK])),
          frame(FRAME.RST_STREAM, 0, promised, uint32(CANCEL)),
        );
      }
      peer.send(...flood);
      await Promise.all([responded.promise, allClosed.promise]);
      await peer.roundTrip();
      // Only stream 1 is left. A client roots a JS context only for a pushed stream.
      expect({ pushed, closed, tables: tablesOf(client) }).toEqual({
        pushed: PUSHES,
        closed: PUSHES,
        tables: { ...dense(1), contexts: { len: 0, walkPositions: 0 } },
      });
    } finally {
      client.destroy();
    }
  },
  10_000 * ASAN_MULTIPLIER,
);
