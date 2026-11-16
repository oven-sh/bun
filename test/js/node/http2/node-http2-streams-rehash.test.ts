import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tls as tlsCert } from "harness";
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
// The first three tests cover the call sites where this was observed under ASAN.

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

// handle_received_stream_id holds the just-created Stream across the JS streamStart
// callback. JS reached from inside that callback (here: EventEmitter.prototype.on, called
// by the Http2Stream constructor) can close the stream and re-enter parser.read(), whose
// deferred-close drain must not free it yet. The parser is driven directly because the hook
// must observe the window inside the native callback, before setStreamContext runs.
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
        parser.read(Buffer.from("PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n")); // must not drain it
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
    // the closed stream.
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
    // One read outside the callback runs the deferred drain; the entry must actually go away.
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

describe.concurrent("re-entering a session from its Duplex transport's _write", () => {
  const prelude = /* js */ `
    const http2 = require("node:http2");
    const { once } = require("node:events");
    const { Duplex } = require("node:stream");
    const [DATA, HEADERS, RST_STREAM, SETTINGS, PING, WINDOW_UPDATE] = [0, 1, 3, 4, 6, 8];
    const [END_STREAM, ACK, END_HEADERS] = [1, 1, 4];
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
    const settingsAndAck = () => Buffer.concat([frame(SETTINGS, 0, 0), frame(SETTINGS, ACK, 0)]);
    const ping = () => frame(PING, 0, 0, Buffer.alloc(8));
    const windowUpdate = streamId => frame(WINDOW_UPDATE, 0, streamId, u32(1 << 20));
    const tick = () => new Promise(resolve => setImmediate(resolve));
    async function until(condition) {
      for (let i = 0; i < 1000 && !condition(); i++) await tick();
      if (!condition()) throw new Error("never happened: " + condition);
    }
    // duplex.inNextWrite runs once, in a _write of at least duplex.minLength bytes. duplex.stall holds the callback back.
    function transport(options, onWrite) {
      const duplex = new Duplex({
        ...options,
        read() {},
        write(chunk, encoding, callback) {
          onWrite(chunk);
          const hook = chunk.length >= (duplex.minLength ?? 0) && duplex.inNextWrite;
          if (hook) {
            duplex.inNextWrite = undefined;
            hook();
          }
          if (duplex.stall) duplex.stalled = callback;
          else callback();
        },
      });
      return duplex;
    }
    const preface = Buffer.from("PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n");
    function parse(bytes, type) {
      const found = [];
      for (let rest = bytes; rest.length; rest = rest.subarray(9 + rest.readUIntBE(0, 3))) {
        found.push({ type: rest[3], flags: rest[4] });
      }
      return found.filter(frame => frame.type === type);
    }
    async function handshake(options, greeting, open) {
      const written = [];
      const duplex = transport(options, chunk => written.push(Buffer.from(chunk)));
      const session = await open(duplex);
      const acked = once(session, "localSettings");
      duplex.push(greeting);
      await acked;
      await tick();
      written.length = 0;
      return { session, duplex, frames: type => parse(Buffer.concat(written), type) };
    }
    const connect = options =>
      handshake(options, settingsAndAck(), async duplex => {
        const session = http2.connect("http://localhost:1", { createConnection: () => duplex });
        await once(session, "connect");
        return session;
      });
    const accept = () => handshake({}, Buffer.concat([preface, settingsAndAck()]), http2.performServerHandshake);
    // The socket is native, but every TLS record goes through the Duplex.
    async function connectTls() {
      const tls = require("node:tls");
      const server = tls.createServer({ ...${JSON.stringify(tlsCert)}, ALPNProtocols: ["h2"] });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const accepted = once(server, "secureConnection");
      const raw = require("node:net").connect(server.address().port, "127.0.0.1");
      await once(raw, "connect");
      const duplex = transport({}, chunk => raw.write(chunk));
      let held;
      raw.on("data", chunk => (held ? (held = Buffer.concat([held, chunk])) : duplex.push(chunk)));
      const socket = tls.connect({ socket: duplex, ALPNProtocols: ["h2"], rejectUnauthorized: false });
      await once(socket, "secureConnect");
      const [peer] = await accepted;
      peer.on("error", () => {}).resume();
      const session = http2.connect("https://localhost", { createConnection: () => socket });
      await once(session, "connect");
      const acked = once(session, "localSettings");
      peer.write(Buffer.concat([settingsAndAck(), windowUpdate(0)]));
      await acked;
      // The record that carries these bytes, for the test to push when it wants them read.
      async function encrypt(bytes) {
        held = Buffer.alloc(0);
        peer.write(bytes);
        while (held.length < 5 || held.length < 5 + held.readUInt16BE(3)) await once(raw, "data");
        return held;
      }
      function close() {
        session.destroy();
        raw.destroy();
        server.close();
      }
      return { session, socket, duplex, encrypt, close };
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
    const post = { ":method": "POST", ":path": "/" };
    const hpackGet = Buffer.from([0x82, 0x86, 0x84, 0x41, 0x01, 0x61]);
    const hpackStatus200 = Buffer.from([0x88]);
    // With its frame header, leaves no room in the cork buffer for the next frame.
    const fillsCorkBuffer = Buffer.alloc(16374);
    async function requestWantingTrailers(session, options) {
      const req = session.request(post, { waitForTrailers: true, ...options }).on("error", () => {});
      const wanted = once(req, "wantTrailers");
      req.end();
      await wanted;
      return req;
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

  test.each([
    [
      "sendTrailers({})",
      /* js */ `
      const req = await requestWantingTrailers(session, { signal: controller.signal });
      const write = () => {
        other.write(fillsCorkBuffer);
        req.sendTrailers({});
      };`,
    ],
    [
      "a flush of queued DATA",
      /* js */ `
      const req = session.request(post, { signal: controller.signal });
      // More than its window: from now on every write is queued.
      other.write(Buffer.alloc(70000));
      await until(() => session.state.outboundQueueSize > 0);
      const write = () => {
        req.write(Buffer.alloc(40000));
        session.ping(() => {});
      };`,
    ],
  ])("abort() and a read during %s do not free the stream", async (_, setup) => {
    const result = await run(/* js */ `
      const { session, duplex, encrypt, close } = await connectTls();
      const controller = new AbortController();
      const other = session.request(post).on("error", () => {});
      ${setup}
      const records = [await encrypt(ping()), await encrypt(ping())];
      let pings = 0;
      session.on("ping", () => pings++);
      duplex.minLength = 16384;
      duplex.inNextWrite = () => {
        controller.abort();
        duplex.push(records[0]);
      };
      write();
      await once(req, "error");
      console.log(pings, isAllocated(session, 3));
      duplex.push(records[1]);
      await until(() => pings === 2);
      console.log(pings, isAllocated(session, 3));
      close();
    `);
    expect(result).toEqual({ stdout: "1 true\n2 false", stderr: "", exitCode: 0 });
  });

  test("closed streams are freed when every read comes from _write", async () => {
    const result = await run(/* js */ `
      const { session, duplex, frames } = await connect();
      for (let id = 1; id <= 7; id += 2) {
        duplex.inNextWrite = () => duplex.push(frame(HEADERS, END_STREAM | END_HEADERS, id, hpackStatus200));
        await once(session.request().resume(), "close");
        await tick();
      }
      console.log(isAllocated(session, 1), isAllocated(session, 3), frames(HEADERS).length);
      session.destroy();
    `);
    expect(result).toEqual({ stdout: "false false 4", stderr: "", exitCode: 0 });
  });

  test("closed streams are freed when every read comes from a flush of queued DATA", async () => {
    const result = await run(/* js */ `
      const { session, duplex, encrypt, close } = await connectTls();
      // More than its window: from now on every write is queued.
      session.request(post).on("error", () => {}).write(Buffer.alloc(70000));
      await until(() => session.state.outboundQueueSize > 0);
      duplex.minLength = 16384;
      for (let id = 3; id <= 7; id += 2) {
        const record = await encrypt(frame(HEADERS, END_STREAM | END_HEADERS, id, hpackStatus200));
        duplex.inNextWrite = () => duplex.push(record);
        await once(session.request(post).resume().end(Buffer.alloc(20000)), "close");
        await tick();
      }
      console.log(isAllocated(session, 3), isAllocated(session, 5));
      close();
    `);
    expect(result).toEqual({ stdout: "false false", stderr: "", exitCode: 0 });
  });

  test("destroy() and GC do not free the TLSSocket mid-write", async () => {
    const result = await run(/* js */ `
      const { session, socket, duplex, close } = await connectTls();
      duplex.inNextWrite = () => {
        socket.destroy();
        Bun.gc(true);
      };
      session.ping(() => {});
      await once(session, "close");
      console.log("closed");
      close();
    `);
    expect(result).toEqual({ stdout: "closed", stderr: "", exitCode: 0 });
  });

  test("write() after an inbound RST_STREAM emits ERR_HTTP2_STREAM_ERROR", async () => {
    const result = await run(/* js */ `
      const { session, duplex, frames } = await connect();
      const req = session.request(post);
      await until(() => frames(HEADERS).length === 1);
      duplex.inNextWrite = () => {
        duplex.push(frame(RST_STREAM, 0, 1, u32(http2.constants.NGHTTP2_INTERNAL_ERROR)));
        duplex.push(ping());
        req.write("late");
      };
      session.settings({});
      const [error] = await once(req, "error");
      console.log(error.code);
      session.destroy();
    `);
    expect(result).toEqual({ stdout: "ERR_HTTP2_STREAM_ERROR", stderr: "", exitCode: 0 });
  });

  test.each([
    ["_write", "req.end(Buffer.alloc(70000));"],
    ["_writev", "req.write(Buffer.alloc(35000)); req.end(Buffer.alloc(35000));"],
  ])("a request made before 'connect' sends END_STREAM once (%s)", async (_, send) => {
    const result = await run(/* js */ `
      const written = [];
      const duplex = transport({}, chunk => written.push(Buffer.from(chunk)));
      duplex.minLength = 65535;
      duplex.inNextWrite = () => duplex.push(Buffer.concat([frame(SETTINGS, 0, 0), windowUpdate(0), windowUpdate(1)]));
      const session = http2.connect("http://localhost:1", { createConnection: () => duplex });
      const req = session.request(post).on("error", () => {});
      ${send}
      await until(() => req.writableFinished);
      const data = parse(Buffer.concat(written).subarray(preface.length), DATA);
      console.log(data.map(frame => frame.flags).join());
      session.destroy();
    `);
    expect(result).toEqual({ stdout: "0,0,0,0,0,1", stderr: "", exitCode: 0 });
  });

  test.skipIf(!isASAN)("process.exit() leaves no leak report", async () => {
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
  });

  // Sessions share one cork buffer. b has a frame in it when a starts to write.
  describe("b's _write runs because a takes the cork buffer", () => {
    test.each([
      [
        "sendTrailers({})",
        /* js */ `
      const a = await connect();
      const b = await connect();
      const controller = new AbortController();
      const req = await requestWantingTrailers(a.session, { signal: controller.signal });
      await until(() => a.frames(HEADERS).length === 1);
      const write = () => req.sendTrailers({});`,
      ],
      [
        "a flush of queued DATA",
        /* js */ `
      const a = await connect({ writableHighWaterMark: 1 });
      const b = await connect();
      const controller = new AbortController();
      const req = a.session.request(post, { signal: controller.signal }).on("error", () => {});
      req.write(Buffer.alloc(1 << 18));
      await until(() => a.session.state.outboundQueueSize > 0);
      a.duplex.stall = true;
      a.duplex.push(Buffer.concat([windowUpdate(0), windowUpdate(1)]));
      await until(() => a.duplex.stalled);
      // 'drain' flushes the rest of the queue.
      const write = () => {
        a.duplex.stall = false;
        a.duplex.stalled();
      };`,
      ],
    ])("abort() and a read during %s do not free the stream", async (_, setup) => {
      const result = await run(/* js */ `
      ${setup}
      b.duplex.inNextWrite = () => {
        controller.abort();
        a.duplex.push(ping());
        console.log(isAllocated(a.session, 1));
      };
      b.session.ping(() => {});
      write();
      await once(req, "error");
      a.duplex.push(ping());
      console.log(isAllocated(a.session, 1));
      a.session.destroy();
      b.session.destroy();
    `);
      expect(result).toEqual({ stdout: "true\nfalse", stderr: "", exitCode: 0 });
    });

    test("RST_STREAM during respond() closes and frees the stream", async () => {
      const result = await run(/* js */ `
      const a = await accept();
      const b = await connect();
      const opened = once(a.session, "stream");
      a.duplex.push(frame(HEADERS, END_STREAM | END_HEADERS, 1, hpackGet));
      const [stream] = await opened;
      b.duplex.inNextWrite = () => {
        a.duplex.push(frame(RST_STREAM, 0, 1, u32(http2.constants.NGHTTP2_CANCEL)));
        a.duplex.push(ping());
      };
      b.session.ping(() => {});
      stream.respond();
      await once(stream, "close");
      a.duplex.push(ping());
      console.log(isAllocated(a.session, 1));
      a.session.destroy();
      b.session.destroy();
    `);
      expect(result).toEqual({ stdout: "false", stderr: "", exitCode: 0 });
    });
  });
});
