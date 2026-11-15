import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import path from "node:path";

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

test("session.request() from a stream 'timeout' listener during forEachStream does not UAF on hashmap rehash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", path.join(import.meta.dir, "node-http2-foreach-rehash.fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({ stdout: "OK", exitCode: 0 });
});

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

test("http2 client write callback that opens new streams during flushQueue does not UAF", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "node-http2-flush-rehash.fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({ stdout: "ok", exitCode: 0 });
});

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

describe.concurrent("JS that runs under a write to a user-supplied Duplex", () => {
  const prelude = /* js */ `
    const http2 = require("node:http2");
    const { once } = require("node:events");
    const { Duplex } = require("node:stream");
    function frame(type, flags, streamId, body = Buffer.alloc(0)) {
      const header = Buffer.alloc(9);
      header.writeUIntBE(body.length, 0, 3);
      header[3] = type;
      header[4] = flags;
      header.writeUInt32BE(streamId, 5);
      return Buffer.concat([header, body]);
    }
    function u32(n) {
      const bytes = Buffer.alloc(4);
      bytes.writeUInt32BE(n);
      return bytes;
    }
    const ping = () => frame(6, 0, 0, Buffer.alloc(8));
    const windowUpdate = streamId => frame(8, 0, streamId, u32(1 << 20));
    const tick = () => new Promise(resolve => setImmediate(resolve));
    async function until(condition) {
      for (let i = 0; i < 1000 && !condition(); i++) await tick();
      if (!condition()) throw new Error("never happened: " + condition);
    }
    // duplex.inNextWrite runs once, inside _write. duplex.stall holds the write callback back.
    async function connect(options) {
      const duplex = new Duplex({
        ...options,
        read() {},
        write(chunk, encoding, callback) {
          duplex.written.push(Buffer.from(chunk));
          const hook = duplex.inNextWrite;
          duplex.inNextWrite = undefined;
          hook?.();
          if (duplex.stall) duplex.stalled = callback;
          else callback();
        },
      });
      duplex.written = [];
      const session = http2.connect("http://localhost:1", { createConnection: () => duplex });
      await once(session, "connect");
      const acked = once(session, "localSettings");
      duplex.push(Buffer.concat([frame(4, 0, 0), frame(4, 1, 0)]));
      await acked;
      await tick();
      duplex.written.length = 0;
      return { session, duplex };
    }
    function isAllocated(session, streamId) {
      try {
        session[Symbol.for("::bunhttp2native::")].getStreamContext(streamId);
        return true;
      } catch (e) {
        if (e.message !== "Invalid stream id") throw e;
        return false;
      }
    }
  `;

  async function run(body: string, env = bunEnv) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + body],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // Sessions share one cork buffer: a's write first flushes b's PING through b's Duplex, which
  // closes the stream that a is writing and makes a read.
  const closeFromOtherSession = /* js */ `
    const result = {};
    b.duplex.inNextWrite = () => {
      controller.abort();
      a.duplex.push(ping());
      result.duringWrite = isAllocated(a.session, 1);
    };
    b.session.ping(() => {});
    write();
    await once(req, "error");
    a.duplex.push(ping());
    result.afterNextRead = isAllocated(a.session, 1);
    console.log(JSON.stringify(result));
    a.session.destroy();
    b.session.destroy();
  `;

  test(
    "does not free the stream that sendTrailers({}) is ending",
    async () => {
      const result = await run(/* js */ `
      const a = await connect();
      const b = await connect();
      const controller = new AbortController();
      const req = a.session.request(
        { ":method": "POST", ":path": "/" },
        { waitForTrailers: true, signal: controller.signal },
      );
      const wanted = once(req, "wantTrailers");
      req.end();
      await wanted;
      await until(() => a.duplex.written.length > 0);
      const write = () => req.sendTrailers({});
      ${closeFromOtherSession}
    `);
      expect(result).toEqual({ stdout: '{"duringWrite":true,"afterNextRead":false}', stderr: "", exitCode: 0 });
    },
    10_000 * ASAN_MULTIPLIER,
  );

  test(
    "does not free the stream whose queued DATA is being flushed",
    async () => {
      const result = await run(/* js */ `
      const a = await connect({ writableHighWaterMark: 1 });
      const b = await connect();
      const controller = new AbortController();
      const req = a.session.request({ ":method": "POST", ":path": "/" }, { signal: controller.signal });
      req.write(Buffer.alloc(1 << 19, "a"));
      await until(() => a.session.state.outboundQueueSize > 0);
      a.duplex.stall = true;
      a.duplex.push(Buffer.concat([windowUpdate(0), windowUpdate(1)]));
      await until(() => a.duplex.stalled);
      // 'drain' flushes the rest of the queue.
      const write = () => {
        a.duplex.stall = false;
        a.duplex.stalled();
      };
      ${closeFromOtherSession}
    `);
      expect(result).toEqual({ stdout: '{"duringWrite":true,"afterNextRead":false}', stderr: "", exitCode: 0 });
    },
    10_000 * ASAN_MULTIPLIER,
  );

  test(
    "can still write to a stream that the peer reset during that write",
    async () => {
      const result = await run(/* js */ `
      const { session, duplex } = await connect();
      const req = session.request({ ":method": "POST", ":path": "/" });
      await until(() => duplex.written.length > 0);
      duplex.inNextWrite = () => {
        duplex.push(frame(3, 0, 1, u32(http2.constants.NGHTTP2_INTERNAL_ERROR)));
        duplex.push(ping());
        req.write("late");
      };
      session.settings({});
      const [error] = await once(req, "error");
      console.log(error.code);
      session.destroy();
    `);
      expect(result).toEqual({ stdout: "ERR_HTTP2_STREAM_ERROR", stderr: "", exitCode: 0 });
    },
    10_000 * ASAN_MULTIPLIER,
  );

  test(
    "does not leave DATA queued on a stream it aborts",
    async () => {
      const result = await run(/* js */ `
      const { session, duplex } = await connect();
      const controller = new AbortController();
      const aborted = session.request({ ":method": "POST", ":path": "/" }, { signal: controller.signal });
      await until(() => duplex.written.length > 0);
      duplex.inNextWrite = () => controller.abort();
      // More than the window: the rest would be queued once the first part is written.
      aborted.write(Buffer.alloc(65535 + 40000, "a"));
      await once(aborted, "error");
      console.log(session.state.outboundQueueSize);

      duplex.push(windowUpdate(0));
      duplex.written.length = 0;
      const next = session.request({ ":method": "POST", ":path": "/" });
      next.on("error", () => {});
      await until(() => duplex.written.length > 0);
      next.write("hello");
      await until(() => Buffer.concat(duplex.written).includes("hello"));
      console.log("sent");
      session.destroy();
    `);
      expect(result).toEqual({ stdout: "0\nsent", stderr: "", exitCode: 0 });
    },
    10_000 * ASAN_MULTIPLIER,
  );

  test.each([
    ["a", { a: ["a-outer.", "reenter!"], b: ["b-first."], c: [] }],
    ["b", { a: ["a-outer."], b: ["b-first.", "reenter!"], c: [] }],
    ["c", { a: ["a-outer."], b: ["b-first."], c: ["reenter!"] }],
  ])(
    "does not lose a frame it sends on session %s while b hands the cork buffer over to a",
    async (target, expected) => {
      const result = await run(/* js */ `
      const peers = { a: await connect(), b: await connect(), c: await connect() };
      const pings = ({ duplex }) => duplex.written.join("").match(/a-outer.|b-first.|reenter!/g)?.sort() ?? [];
      peers.b.duplex.inNextWrite = () => peers.${target}.session.ping(Buffer.from("reenter!"), () => {});
      peers.b.session.ping(Buffer.from("b-first."), () => {});
      peers.a.session.ping(Buffer.from("a-outer."), () => {});
      await until(() => pings(peers.a).includes("a-outer."));
      console.log(JSON.stringify({ a: pings(peers.a), b: pings(peers.b), c: pings(peers.c) }));
      for (const { session } of Object.values(peers)) session.destroy();
    `);
      expect(result).toEqual({ stdout: JSON.stringify(expected), stderr: "", exitCode: 0 });
    },
    10_000 * ASAN_MULTIPLIER,
  );

  test.skipIf(!isASAN)(
    "can exit the process without a leak report",
    async () => {
      const result = await run(
        /* js */ `
      const { session, duplex } = await connect();
      duplex.inNextWrite = () => {
        console.log("exiting");
        process.exit(0);
      };
      session.ping(() => {});
    `,
        {
          ...bunEnv,
          BUN_DESTRUCT_VM_ON_EXIT: "1",
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
          LSAN_OPTIONS: `print_suppressions=0:suppressions=${path.join(import.meta.dir, "../../../leaksan.supp")}`,
        },
      );
      expect(result).toEqual({ stdout: "exiting", stderr: "", exitCode: 0 });
    },
    10_000 * ASAN_MULTIPLIER,
  );
});
