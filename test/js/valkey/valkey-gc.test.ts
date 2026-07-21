import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import net from "node:net";

// Fuzzer found a heap-use-after-free: connect()'s tls_ctx_failed branch
// called on_valkey_close() before the socket keep-alive ref was taken, so
// on_valkey_close's unconditional deref over-released by one. do_connect's
// scoped deref_guard then dropped the refcount to 0 and freed the
// Box<JSValkeyClient> while the JS wrapper (and its ext ptr) was still
// alive; the next property access read freed memory.
test.concurrent("RedisClient survives a failed custom-TLS context without freeing the live client", async () => {
  const src = `
    for (let i = 0; i < 10; i++) {
      const c = new Bun.RedisClient("rediss://127.0.0.1:1", {
        tls: { key: "not a valid key", cert: "not a valid cert" },
        autoReconnect: false,
      });
      c.onclose = () => {};
      try { await c.connect(); } catch {}
      // Before the fix the backing allocation was already freed here; ASAN
      // reports heap-use-after-free on the status read inside this getter.
      if (c.connected !== false) throw new Error("expected connected=false");
      try { c.close(); } catch {}
    }
    Bun.gc(true);
    await 1;
    Bun.gc(true);
    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// Fuzzer found a heap-use-after-free that survived the ScopedRef refactor:
// on_connection_timeout's unconditional `ScopedRef::adopt` released a ref the
// timer no longer held, so the ScopedRef drop at scope end brought the
// intrusive count to 0 and freed the Box<JSValkeyClient> while the JS wrapper
// (and the other armed timer) still pointed at it; GC finalize -> stop_timers
// then read the freed allocation. Repro: server answers HELLO then stops
// replying, so the connection/idle-timeout and reconnect timers churn against
// each other under subscribe/close/connect re-entry.
test.concurrent(
  "RedisClient survives connection-timeout + reconnect churn against an under-replying server",
  async () => {
    const src = `
    const CRLF = "\\r\\n";
    const blk = s => "$" + s.length + CRLF + s + CRLF;
    const HELLO = "%1" + CRLF + blk("proto") + ":3" + CRLF;
    const sockets = [];
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(s) { s.data = { buf: "" }; sockets.push(s); },
        data(s, d) {
          s.data.buf += d.toString("latin1");
          if (s.data.buf.includes("HELLO")) {
            s.write(HELLO);
            s.data.buf = "";
          }
          // anything else is ignored (under-replying)
        },
        close() {},
      },
    });
    const url = "redis://127.0.0.1:" + server.port;
    for (let round = 0; round < ${isASAN ? 40 : 120}; round++) {
      const c = new Bun.RedisClient(url, {
        autoReconnect: true,
        connectionTimeout: 1 + (round % 4),
        idleTimeout: 1 + (round % 5),
        maxRetries: 2,
      });
      c.onconnect = () => {}; c.onclose = () => {};
      try { await c.connect(); } catch {}
      try { c.subscribe("ch", () => {}).catch(() => {}); } catch {}
      try { c.get("k").catch(() => {}); } catch {}
      await new Promise(r => setTimeout(r, round % 7));
      if (round % 2) while (sockets.length) try { sockets.pop()?.terminate?.(); } catch {}
      await new Promise(r => setTimeout(r, round % 5));
      try { c.close(); } catch {}
      try { c.connect().catch(() => {}); } catch {}
      await new Promise(r => setImmediate(r));
      try { c.close(); } catch {}
      // Before the fix the backing allocation could already be freed here;
      // ASAN reports heap-use-after-free on the status read inside this getter.
      if (typeof c.connected !== "boolean") throw new Error("expected boolean");
      if (round % 3 === 0) Bun.gc(true);
    }
    for (const s of sockets) try { s.terminate?.(); } catch {}
    server.stop(true);
    Bun.gc(true);
    await 1;
    Bun.gc(true);
    console.log("OK");
    process.exit(0);
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim()).toBe("OK");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  },
);

// Fuzzer found the same over-release reachable from subscribe() when the
// socket dies mid-call: upsert_receive_handler's exit guard re-enters
// on_writable/update_poll_ref before send() takes its own ref, so a
// connect/close fault path inside could free the client under the live
// `&self`. This variant races a server-side RST against subscribe()+close().
test.concurrent("RedisClient survives subscribe() + close() against a server that resets the connection", async () => {
  const src = `
    const CRLF = "\\r\\n";
    const blk = s => "$" + s.length + CRLF + s + CRLF;
    const sockets = [];
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(s) { s.data = { buf: "" }; sockets.push(s); },
        data(s, d) {
          s.data.buf += d.toString("latin1");
          if (s.data.buf.includes("HELLO")) s.write("%1" + CRLF + blk("proto") + ":3" + CRLF);
          else if (s.data.buf.includes(CRLF)) s.write("+OK" + CRLF);
          s.data.buf = "";
        },
        close() {},
      },
    });
    for (let round = 0; round < 100; round++) {
      const c = new Bun.RedisClient("redis://127.0.0.1:" + server.port, {
        autoReconnect: true,
        connectionTimeout: 2000,
      });
      c.onconnect = () => {}; c.onclose = () => {};
      try { await c.connect(); } catch {}
      const s = sockets.pop();
      try { s?.terminate?.(); } catch {}
      const t0 = Bun.nanoseconds();
      while (Bun.nanoseconds() - t0 < 4e6) {}
      try { c.subscribe("ch" + round, () => {}).catch(() => {}); } catch {}
      try { c.close(); } catch {}
      if (round % 8 === 0) Bun.gc(false);
      await new Promise(r => setImmediate(r));
    }
    server.stop(true);
    console.log("OK");
    process.exit(0);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// Fuzzer found a flaky SIGILL when a RedisClient is constructed, a command
// throws during argument validation (before any connection attempt), and the
// client is then garbage collected. `updatePollRef` could be reached after
// the JS wrapper was finalized, and `subscriptionCallbackMap()` would hit
// `orelse unreachable` because `this_value.tryGet()` returns null for a
// finalized JSRef.

test.concurrent("RedisClient survives GC after a command throws during argument validation", async () => {
  const src = `
    let threw = 0;
    for (let i = 0; i < 200; i++) {
      const c = new Bun.RedisClient();
      try {
        // BigUint64Array (a constructor function) is not a valid argument,
        // so this throws before send() / connect() is ever called.
        c.zrangebylex(65535, 65535, BigUint64Array);
      } catch {
        threw++;
      }
    }
    if (threw !== 200) throw new Error("expected zrangebylex to throw on every call, got " + threw);
    Bun.gc(true);
    await 1;
    Bun.gc(true);
    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// A later argument's toString() can detach an earlier ArrayBuffer argument
// (transfer() frees its store synchronously), so the earlier captured slice
// pointed at freed heap by the time the command was serialized onto the wire.
test.concurrent("set/send serialize ArrayBuffer arguments before a later toString() can free them", async () => {
  const src = `
    const net = require("node:net");

    let wire = Buffer.alloc(0);
    let resolveFrame;
    let gotFrame = new Promise(r => (resolveFrame = r));
    const server = net.createServer(socket => {
      socket.on("data", data => {
        if (data.includes("HELLO")) {
          socket.write("+OK\\r\\n");
          return;
        }
        wire = Buffer.concat([wire, data]);
        socket.write("+OK\\r\\n");
        resolveFrame();
      });
      socket.on("error", () => {});
    });
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", resolve);
      server.on("error", reject);
    });

    const client = new Bun.RedisClient("redis://127.0.0.1:" + server.address().port, {
      autoReconnect: false,
      connectionTimeout: 5000,
    });
    await client.connect();

    const keep = [];
    function evilValue(key) {
      return Object.assign(new String("v"), {
        toString() {
          // Free the earlier key's backing store synchronously, then recycle
          // that block with recognizable foreign bytes.
          key.buffer.transfer(0);
          Bun.gc(true);
          for (let i = 0; i < 64; i++) {
            const x = new Uint8Array(4096);
            x.fill(0x5a);
            Buffer.from(x.buffer).write("RECYCLEDKEY");
            keep.push(x);
          }
          Bun.gc(true);
          return "v";
        },
      });
    }

    // set(key, value): key is a Buffer, value.toString() frees it.
    {
      const key = Buffer.from(new ArrayBuffer(4096));
      key.write("ORIGINALKEY");
      client.set(key, evilValue(key)).catch(() => {});
      await gotFrame;
    }

    // send("LPUSH", [key, value]): same shape through the array iterator.
    {
      gotFrame = new Promise(r => (resolveFrame = r));
      const key = Buffer.from(new ArrayBuffer(4096));
      key.write("ORIGINAL2KEY");
      client.send("LPUSH", [key, evilValue(key)]).catch(() => {});
      await gotFrame;
    }

    client.close();
    server.close();

    const text = wire.toString("latin1");
    if (text.includes("RECYCLEDKEY")) {
      throw new Error("freed/recycled heap reached the wire: " + JSON.stringify(text.slice(0, 80)));
    }
    if (!text.includes("ORIGINALKEY") || !text.includes("ORIGINAL2KEY")) {
      throw new Error("original key bytes missing from the wire: " + JSON.stringify(text.slice(0, 80)));
    }
    console.log("OK");
    process.exit(0);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// Fuzzer found heap corruption (zapped cell during GC marking) when a custom
// setter on a generated class was invoked with a receiver that is not an
// instance of that class (e.g. through a Proxy wrapping the instance, or an
// extracted setter function). The generated setter wrapper downcast the
// receiver without a type check and wrote an internal field into whatever
// object the receiver happened to be.
test.concurrent("custom setter with a foreign receiver throws instead of corrupting the heap", async () => {
  const src = `
    const client = new Bun.RedisClient();

    // Receiver is a Proxy wrapping the instance.
    try {
      const proxy = new Proxy(client, {});
      proxy.onconnect = function () {};
      throw new Error("expected TypeError");
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
    }

    // Receiver is a plain object with the instance on its prototype chain.
    try {
      Object.create(client).onconnect = function () {};
      throw new Error("expected TypeError");
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
    }

    // Extracted setter function called with a foreign this value.
    const desc = Object.getOwnPropertyDescriptor(Bun.RedisClient.prototype, "onconnect");
    for (const thisValue of [{}, null, 42, new Proxy(client, {})]) {
      try {
        desc.set.call(thisValue, function () {});
        throw new Error("expected TypeError");
      } catch (e) {
        if (!(e instanceof TypeError)) throw e;
      }
    }

    // Setting on a real instance still works.
    const fn = function () {};
    client.onconnect = fn;
    if (client.onconnect !== fn) throw new Error("expected onconnect to be set");

    Bun.gc(true);
    await 1;
    Bun.gc(true);
    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

test.concurrent("RedisClient survives GC across many short-lived instances", async () => {
  const src = `
    for (let i = 0; i < 1000; i++) {
      new Bun.RedisClient();
    }
    Bun.gc(true);
    await 1;
    Bun.gc(true);
    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// A RESP scalar line (simple string, error, integer, ...) must end with CRLF.
// The reader caps line-terminated replies at MAX_BULK_LEN (512 MB), so a 600 KB
// unterminated line is treated as a partial reply; when the server closes
// mid-line the pending command is rejected as connection-closed.
test.concurrent("rejects a RESP simple-string reply whose line terminator never arrives", async () => {
  // Minimal mock Redis server: replies +OK to the HELLO handshake, then
  // answers the next command with `payload`.
  function listen(payload: Buffer, endAfterPayload: boolean): Promise<{ server: net.Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = net.createServer(socket => {
        socket.on("data", (data: Buffer) => {
          if (data.includes("HELLO")) {
            socket.write("+OK\r\n");
          }
          if (data.includes("PING")) {
            socket.write(payload, () => {
              if (endAfterPayload) socket.end();
            });
          }
        });
        socket.on("error", () => {});
      });
      server.listen(0, "127.0.0.1", () => {
        resolve({ server, port: (server.address() as net.AddressInfo).port });
      });
      server.on("error", reject);
    });
  }

  // 1) A simple-string reply whose CRLF terminator never arrives. The reader
  //    treats the unterminated bytes as a partial reply and keeps waiting; when
  //    the server closes, the pending command is rejected as connection-closed.
  {
    const unterminated = Buffer.from("+" + Buffer.alloc(600_000, "A").toString());
    const { server, port } = await listen(unterminated, true);
    try {
      const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
      });
      try {
        await client.send("PING", []);
        expect.unreachable();
      } catch (error: any) {
        expect(error.code).toBe("ERR_REDIS_CONNECTION_CLOSED");
      } finally {
        client.close();
      }
    } finally {
      server.close();
    }
  }

  // 2) A large, properly terminated simple string still parses.
  {
    const value = Buffer.alloc(100_000, "B").toString();
    const { server, port } = await listen(Buffer.from("+" + value + "\r\n"), false);
    try {
      const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
      });
      try {
        expect(await client.send("PING", [])).toBe(value);
      } finally {
        client.close();
      }
    } finally {
      server.close();
    }
  }
});

// Buffer-mode replies (`getBuffer` and friends) adopt the RESP parser's
// payload allocation as the Buffer backing store instead of copying it. The
// pointer is handed to JSC and freed by the ArrayBuffer deallocator when the
// Buffer is collected, so an allocator mismatch or double free crashes —
// especially under ASAN. Run a GC-heavy getBuffer workload against a mock
// server and check both content integrity and a clean exit. Covers large,
// pipelined, empty, null, and verbatim-string replies.
test.concurrent("getBuffer replies survive GC with adopted backing stores intact", async () => {
  const src = `
    const net = require("node:net");

    const CRLF = Buffer.from("\\r\\n");
    const GET_FRAME = "*2\\r\\n$3\\r\\nGET\\r\\n$1\\r\\nk\\r\\n";
    const replies = [];

    function bulk(payload) {
      return Buffer.concat([Buffer.from("$" + payload.length + "\\r\\n"), payload, CRLF]);
    }

    // Mock server: +OK to the HELLO handshake, then shift one queued reply
    // per GET frame (frames may coalesce when commands are auto-pipelined).
    let pending = "";
    let saidHello = false;
    const server = net.createServer(socket => {
      socket.on("data", data => {
        if (!saidHello) {
          if (data.includes("HELLO")) {
            saidHello = true;
            socket.write("+OK\\r\\n");
          }
          return;
        }
        pending += data.toString("latin1");
        while (pending.startsWith(GET_FRAME)) {
          pending = pending.slice(GET_FRAME.length);
          if (replies.length === 0) throw new Error("reply queue underflow");
          socket.write(replies.shift());
        }
      });
      socket.on("error", () => {});
    });
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", resolve);
      server.on("error", reject);
    });

    const client = new Bun.RedisClient("redis://127.0.0.1:" + server.address().port, {
      autoReconnect: false,
      connectionTimeout: 5000,
    });

    function check(buf, size, seed, what) {
      if (!(buf instanceof Uint8Array)) throw new Error(what + ": expected a Uint8Array");
      if (buf.length !== size) throw new Error(what + ": length " + buf.length + " !== " + size);
      for (const i of [0, size >> 1, size - 1]) {
        if (buf[i] !== (seed & 0xff)) {
          throw new Error(what + ": byte " + i + " is " + buf[i] + ", expected " + (seed & 0xff));
        }
      }
    }

    // Large payloads, sequential, collecting earlier replies while later ones
    // are still arriving.
    const LARGE = 1 << 20;
    for (let i = 0; i < 4; i++) {
      replies.push(bulk(Buffer.alloc(LARGE, i & 0xff)));
      check(await client.getBuffer("k"), LARGE, i, "large #" + i);
      if (i % 2 === 1) Bun.gc(true);
    }

    // Auto-pipelined batches of small payloads.
    const SMALL = 1 << 16;
    for (let batch = 0; batch < 5; batch++) {
      const seeds = [];
      for (let j = 0; j < 12; j++) {
        const seed = batch * 12 + j;
        seeds.push(seed);
        replies.push(bulk(Buffer.alloc(SMALL, seed & 0xff)));
      }
      const bufs = await Promise.all(seeds.map(() => client.getBuffer("k")));
      for (let j = 0; j < bufs.length; j++) {
        check(bufs[j], SMALL, seeds[j], "batch " + batch + " #" + j);
      }
      Bun.gc(true);
    }

    // Zero-length reply: an empty box has no allocation to adopt or free.
    for (let i = 0; i < 3; i++) {
      replies.push(bulk(Buffer.alloc(0)));
      const buf = await client.getBuffer("k");
      if (!(buf instanceof Uint8Array) || buf.length !== 0) {
        throw new Error("empty #" + i + ": expected a zero-length Uint8Array");
      }
    }

    // Null bulk reply.
    replies.push(Buffer.from("$-1\\r\\n"));
    if ((await client.getBuffer("k")) !== null) throw new Error("expected null for $-1 reply");

    // RESP3 verbatim string in buffer mode adopts verbatim.content.
    for (let i = 0; i < 3; i++) {
      const content = Buffer.alloc(1024, (77 + i) & 0xff);
      const framed = Buffer.concat([Buffer.from("txt:"), content]);
      replies.push(Buffer.concat([Buffer.from("=" + framed.length + "\\r\\n"), framed, CRLF]));
      check(await client.getBuffer("k"), 1024, 77 + i, "verbatim #" + i);
    }

    Bun.gc(true);
    await 1;
    Bun.gc(true);

    client.close();
    server.close();
    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});
