import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tls } from "harness";
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
// These tests cover call sites where this was observed under ASAN.

test(
  "session.request() from a stream 'aborted' listener during forEachStream does not UAF on hashmap rehash",
  async () => {
    const script = /* js */ `
    const http2 = require("node:http2");
    const { duplexPair } = require("node:stream");

    const [transport, peer] = duplexPair();
    peer.resume();
    const client = http2.connect("http://localhost", { createConnection: () => transport });
    const counts = { aborted: 0, opened: 0, closed: 0 };
    function open() {
      const req = client.request({ ":method": "POST" });
      if (!req.pending) counts.opened++;
      return req.on("close", () => counts.closed++);
    }
    client.on("connect", () => {
      for (let i = 0; i < 24; i++) {
        // The transport's close cancels every stream from inside forEachStream().
        open().on("aborted", () => {
          counts.aborted++;
          for (let j = 0; j < 4; j++) open();
        });
      }
      transport.destroy();
    });
    process.on("exit", () => console.log(JSON.stringify(counts)));
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
      stdout: JSON.stringify({ aborted: 24, opened: 120, closed: 120 }),
      exitCode: 0,
      stderr: "",
    });
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

// JS reached from inside the streamStart callback (here: EventEmitter.prototype.on, called by the
// Http2Stream constructor) can close the new stream and re-enter parser.read(), which forgets
// closed streams. The native caller still holds the stream and used to write its context through
// a dangling pointer (ASAN: heap-use-after-free). The parser is driven directly because the hook
// must observe the window inside the native callback.
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
        parser.rstStream(2, 8 /* NGHTTP2_CANCEL */);
        parser.read(Buffer.from("PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n"));
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
    // No context may have been installed for the closed stream, which would pin the dead Http2Stream.
    let ctx;
    try {
      ctx = parser.getStreamContext(2);
    } catch {}
    if (ctx !== undefined) {
      console.error("context installed for closed stream");
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

describe.concurrent("a transport's write() that", () => {
  const prelude = /* js */ `
    const http2 = require("node:http2");
    const { once } = require("node:events");
    const { Duplex } = require("node:stream");
    let inNextWrite;
    const transport = onWrite =>
      new Duplex({
        read() {},
        write(chunk, encoding, callback) {
          onWrite?.(chunk);
          const hook = inNextWrite;
          inNextWrite = undefined;
          hook?.();
          callback();
        },
      });
    async function connect(socket, send) {
      const session = http2.connect("http://localhost", { createConnection: () => socket });
      await once(session, "connect");
      const settingsAndAck = Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1, 0, 0, 0, 0]);
      await Promise.all([once(session, "localSettings"), send(settingsAndAck)]);
      await new Promise(setImmediate);
      return session;
    }
    const connectDuplex = (duplex = transport()) => connect(duplex, bytes => duplex.push(bytes));
  `;
  async function run(body: string, env = bunEnv) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", prelude + body], env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test(
    "destroys the TLS socket on top of it does not UAF",
    async () => {
      const result = await run(/* js */ `
      const tls = require("node:tls");
      const server = tls.createServer({ ...${JSON.stringify(tls)}, ALPNProtocols: ["h2"] });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const raw = require("node:net").connect(server.address().port, "127.0.0.1");
      const duplex = transport(chunk => raw.write(chunk));
      raw.on("data", chunk => duplex.push(chunk));
      const socket = tls.connect({ socket: duplex, ALPNProtocols: ["h2"], rejectUnauthorized: false });
      const [[peer]] = await Promise.all([once(server, "secureConnection"), once(socket, "secureConnect")]);
      const session = await connect(socket, bytes => peer.on("error", () => {}).resume().write(bytes));
      inNextWrite = () => {
        socket.destroy();
        Bun.gc(true);
      };
      session.ping(() => {});
      await once(session, "close");
      console.log("closed");
      raw.destroy();
      server.close();
    `);
      expect(result).toEqual({ stdout: "closed", stderr: "", exitCode: 0 });
    },
    10_000 * ASAN_MULTIPLIER,
  );

  test(
    "destroys the stream leaves the rest of its DATA unqueued",
    async () => {
      const result = await run(/* js */ `
      const session = await connectDuplex();
      const req = session.request({ ":method": "POST" });
      await new Promise(setImmediate);
      inNextWrite = () => req.destroy();
      req.write(Buffer.alloc(65535 + 40000));
      await once(req, "close");
      console.log(session.state.outboundQueueSize);
      session.destroy();
    `);
      expect(result).toEqual({ stdout: "0", stderr: "", exitCode: 0 });
    },
    10_000 * ASAN_MULTIPLIER,
  );

  test(
    "destroys the stream gets no more of its queued DATA",
    async () => {
      const result = await run(/* js */ `
      let written = 0;
      const duplex = transport(chunk => (written += chunk.length));
      const session = await connectDuplex(duplex);
      const req = session.request({ ":method": "POST" });
      req.end(Buffer.alloc(65535 + 100000));
      while (session.state.outboundQueueSize === 0) await new Promise(setImmediate);
      await new Promise(setImmediate);
      written = 0;
      inNextWrite = () => req.destroy();
      const windowUpdate = id => [0, 0, 4, 8, 0, 0, 0, 0, id, 0, 16, 0, 0];
      duplex.push(Buffer.from([...windowUpdate(0), ...windowUpdate(1)]));
      await once(req, "close");
      while (session.state.outboundQueueSize > 0) await new Promise(setImmediate);
      console.log(written < 50000);
      session.destroy();
    `);
      expect(result).toEqual({ stdout: "true", stderr: "", exitCode: 0 });
    },
    10_000 * ASAN_MULTIPLIER,
  );

  test.skipIf(!isASAN)(
    "exits the process does not leak the session",
    async () => {
      const result = await run(
        /* js */ `
      const session = await connectDuplex();
      inNextWrite = () => {
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
