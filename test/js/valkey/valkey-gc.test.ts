import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, expectRssDeltaBelow, isASAN, isMusl, isWindows } from "harness";
import net from "node:net";
import { join } from "node:path";

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

// The socket's close event (ValkeyClient::on_close) rejects the commands the
// connection still owes replies for, then settles connect()/onclose or arms the
// retry. Rejecting a promise fails once the VM's termination is pending, which
// is the state a terminated worker's teardown closes its sockets in, and
// on_close() then returns before its callees ran. The keep-alive ref the socket
// held on the client used to be released by those callees, so every
// RedisClient terminated with commands owed leaked its Box<JSValkeyClient>; now
// the close event's entry releases it whatever on_close() returns. One case per
// branch of on_close() (retry scheduled, autoReconnect off, retries exhausted)
// with the commands in flight, one with commands in the offline queue as well,
// and one whose close event is on_connect_error (a dial that never completes)
// rather than on_close. With the offline queue, the first rejection failing
// used to leave the queue's remaining entries undropped, leaking their
// serialized bytes as well. Only observable via LSan, so ASAN-only. (The main
// thread's teardown under process.exit() closes the same sockets with no
// termination pending, so the rejections succeed there and nothing leaked.)
describe.skipIf(!isASAN)("VM teardown with commands owed to a RedisClient leaks nothing", () => {
  const CRLF = "\\r\\n";
  // Answers HELLO, never replies to a command, and resolves `ready` once the
  // first INCR has arrived, so the commands it owes are in flight from then on.
  // With `endAtIncr` it ends the connection at that INCR instead, which leaves
  // the client in its retry delay.
  const server = (endAtIncr: boolean) => `
    const HELLO = "%1${CRLF}$5${CRLF}proto${CRLF}:3${CRLF}";
    const { promise: ready, resolve: onReady } = Promise.withResolvers();
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(s) { s.data = { buf: "", hello: false }; },
        data(s, chunk) {
          s.data.buf += chunk.toString("latin1");
          if (!s.data.hello && s.data.buf.includes("HELLO")) {
            s.data.hello = true;
            s.write(HELLO);
          }
          if (s.data.buf.includes("INCR")) {
            onReady();
            if (${endAtIncr}) s.end();
          }
        },
        close() {},
        error() {},
      },
    });
  `;

  async function expectCleanExit(src: string, stdout: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: out, stderr: err, exitCode }).toEqual({ stdout, stderr: "", exitCode: 0 });
  }

  // The client is created from a macrotask on purpose: allocations made while
  // the worker's module body is still on the stack match the module-evaluation
  // entries of leaksan.supp, and a leaked client would then go unreported.
  const workerSrc = (body: string) => `
    const { parentPort, workerData } = require("node:worker_threads");
    setImmediate(() => {
      const client = new Bun.RedisClient(workerData.url, workerData.options);
      globalThis.client = client;
      ${body}
    });
  `;

  // Terminates the worker once the server reports `ready`, with whatever the
  // client still owes. With `closedDuringRetryDelay` the server ends the
  // connection instead, and the worker is terminated once it has posted that
  // it called close() during the retry delay.
  function terminateWorker(options: object, worker: string, closedDuringRetryDelay = false) {
    return expectCleanExit(
      `
      const { Worker } = require("node:worker_threads");
      ${server(closedDuringRetryDelay)}
      const worker = new Worker(${JSON.stringify(workerSrc(worker))}, {
        eval: true,
        workerData: { url: "redis://127.0.0.1:" + server.port, options: ${JSON.stringify(options)} },
      });
      const { promise: closed, resolve: onClosed } = Promise.withResolvers();
      worker.on("message", onClosed);
      worker.on("error", (err) => { console.error(err); process.exit(2); });
      worker.on("exit", (code) => { console.error("worker exited on its own with " + code); process.exit(3); });
      await ${closedDuringRetryDelay ? "closed" : "ready"};
      worker.removeAllListeners("exit");
      console.log("terminated", await worker.terminate());
      server.stop(true);
      `,
      "terminated 1\n",
    );
  }

  const inFlight = `client.connect().then(() => { for (let i = 0; i < 4; i++) client.incr("k").catch(() => {}); });`;

  // Symbolizing a leak report takes LSan several seconds on a debug binary.
  const timeout = 60_000;
  test.concurrent("worker.terminate(): retry scheduled", () => terminateWorker({}, inFlight), timeout);
  test.concurrent(
    "worker.terminate(): autoReconnect off",
    () => terminateWorker({ autoReconnect: false }, inFlight),
    timeout,
  );
  test.concurrent("worker.terminate(): retries exhausted", () => terminateWorker({ maxRetries: 0 }, inFlight), timeout);

  // close() during the retry delay has no socket close event to run through:
  // it disarms the retry timer and runs the close path by hand, so it must
  // take no ref of its own for that path to release. After close() nothing
  // else keeps the worker alive, and terminate() on a worker that has already
  // exited reports that exit instead; the timer keeps it running until
  // terminate() ends it like the other cases.
  test.concurrent(
    "worker.terminate(): after close() during the retry delay",
    () =>
      terminateWorker(
        {},
        `client.connect().then(async () => {
          client.incr("k").catch(() => {});
          while (client.connected) await Bun.sleep(1);
          client.close();
          setTimeout(() => {}, 1 << 30);
          parentPort.postMessage("closed");
        });`,
        true,
      ),
    timeout,
  );

  // WATCH is not auto-pipelined, so it waits in the offline queue while the
  // INCRs are in flight, and the INCRs sent after it queue up behind it. The
  // first in-flight rejection failing then leaves the whole queue behind.
  test.concurrent(
    "worker.terminate(): commands queued behind a non-pipelined command",
    () =>
      terminateWorker(
        { autoReconnect: false },
        `client.connect().then(() => {
          for (let i = 0; i < 4; i++) client.incr("k").catch(() => {});
          client.send("WATCH", ["k"]).catch(() => {});
          for (let i = 0; i < 4; i++) client.incr("k").catch(() => {});
        });`,
      ),
    timeout,
  );

  // A listener nobody accepts from, with a backlog one filler connection
  // fills, so the kernel drops every later SYN and a dial to `port` sits in
  // EINPROGRESS for good. Needs listen(2) with the smallest backlog that
  // admits exactly one connection (macOS treats 0 as unlimited), which Bun's
  // own listeners do not expose, so the listener is a raw libc socket.
  const blackhole = `
    const net = require("node:net");
    const { dlopen, ptr } = require("bun:ffi");
    const darwin = process.platform === "darwin";
    const libc = dlopen(darwin ? "libSystem.B.dylib" : "libc.so.6", {
      socket:      { args: ["int", "int", "int"],  returns: "int" },
      bind:        { args: ["int", "ptr", "int"],  returns: "int" },
      listen:      { args: ["int", "int"],         returns: "int" },
      getsockname: { args: ["int", "ptr", "ptr"],  returns: "int" },
    });
    const AF_INET = 2, SOCK_STREAM = 1;
    const addr = new Uint8Array(16);
    if (darwin) { addr[0] = 16; addr[1] = AF_INET; } else new DataView(addr.buffer).setUint16(0, AF_INET, true);
    addr.set([127, 0, 0, 1], 4);
    const fd = libc.symbols.socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0 || libc.symbols.bind(fd, ptr(addr), 16) !== 0 || libc.symbols.listen(fd, darwin ? 1 : 0) !== 0) throw new Error("listen failed");
    const len = new Uint32Array([16]);
    if (libc.symbols.getsockname(fd, ptr(addr), ptr(len)) !== 0) throw new Error("getsockname failed");
    const port = (addr[2] << 8) | addr[3];
    // The error listener outlives the await, so a later error on the filler
    // is swallowed rather than thrown.
    const filler = net.connect(port, "127.0.0.1");
    await new Promise((resolve, reject) => filler.on("connect", resolve).on("error", reject));
  `;

  // The dial never completes, so teardown delivers on_connect_error for it,
  // with the commands in the offline queue.
  test.concurrent.skipIf(isWindows || isMusl)(
    "worker.terminate(): commands queued behind a dial that stays pending",
    () =>
      expectCleanExit(
        `
        const { Worker } = require("node:worker_threads");
        ${blackhole}
        const { promise: dialing, resolve: onDialing } = Promise.withResolvers();
        const worker = new Worker(${JSON.stringify(
          workerSrc(`
            client.connect().catch(() => {});
            for (let i = 0; i < 4; i++) client.incr("k").catch(() => {});
            parentPort.postMessage("dialing");
          `),
        )}, {
          eval: true,
          workerData: { url: "redis://127.0.0.1:" + port, options: { autoReconnect: false } },
        });
        worker.on("message", onDialing);
        worker.on("error", (err) => { console.error(err); process.exit(2); });
        worker.on("exit", (code) => { console.error("worker exited on its own with " + code); process.exit(3); });
        await dialing;
        worker.removeAllListeners("exit");
        console.log("terminated", await worker.terminate());
        filler.destroy();
        `,
        "terminated 1\n",
      ),
    timeout,
  );

  // A dial to an IP literal gets a real us_socket_t back from uSockets before
  // the TCP handshake completes (POLL_TYPE_SEMI_SOCKET), and uSockets delivers
  // no close event when the application closes one of those, so
  // ValkeyClient::close() releases connect()'s keep-alive ref and runs the
  // close event by hand. One case per entry into that branch: close() while
  // the dial is pending, and the connection timeout firing during it. The
  // command in the offline queue tells the two apart: connect() itself is
  // always rejected as connection-closed. The client is created from a
  // macrotask for the same reason as the workers'.
  function closePendingDial(options: object, body: string, stdout: string) {
    return expectCleanExit(
      `
      ${blackhole}
      const { promise: done, resolve: onDone } = Promise.withResolvers();
      setImmediate(async () => {
        const client = new Bun.RedisClient("redis://127.0.0.1:" + port, ${JSON.stringify(options)});
        let closes = 0;
        client.onclose = () => { closes++; };
        const connecting = client.connect();
        const queued = client.get("k");
        ${body}
        const code = (p) => p.then(() => "resolved", (err) => err.code);
        console.log(await code(connecting), await code(queued), closes, client.connected);
        Bun.gc(true);
        onDone();
      });
      await done;
      Bun.gc(true);
      filler.destroy();
      `,
      stdout + "\n",
    );
  }
  test.concurrent.skipIf(isWindows || isMusl)(
    "close() while a dial to an IP literal is pending",
    () =>
      closePendingDial(
        { autoReconnect: false },
        "client.close();",
        "ERR_REDIS_CONNECTION_CLOSED ERR_REDIS_CONNECTION_CLOSED 1 false",
      ),
    timeout,
  );
  test.concurrent.skipIf(isWindows || isMusl)(
    "connection timeout while a dial to an IP literal is pending",
    () =>
      closePendingDial(
        { connectionTimeout: 1 },
        "",
        "ERR_REDIS_CONNECTION_CLOSED ERR_REDIS_CONNECTION_TIMEOUT 1 false",
      ),
    timeout,
  );
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
        // OHOS: the server's FIN does not always reach the client's reader
        // (sandbox socket-close propagation), so the pending command times
        // out instead of reporting connection-closed. Both mean the
        // unterminated reply was not accepted.
        expect(["ERR_REDIS_CONNECTION_CLOSED", "ERR_REDIS_CONNECTION_TIMEOUT"]).toContain(error.code);
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

test.concurrent(
  "RedisClient read buffer stays bounded when every socket read ends with a partial reply",
  async () => {
    const ROUNDS = isASAN ? 900 : 1200;
    const src = `
    const B = 131072;
    const K = 64;
    const WINDOW = 16;
    const CRLF = "\\r\\n";
    const body = Buffer.alloc(B, "x");
    const header = Buffer.from("$" + B + CRLF);
    const first = Buffer.concat([header, body, Buffer.from(CRLF), header, body.subarray(0, K)]);
    const next = Buffer.concat([body.subarray(K), Buffer.from(CRLF), header, body.subarray(0, K)]);
    const GET = "*2" + CRLF + "$3" + CRLF + "GET" + CRLF + "$1" + CRLF + "k" + CRLF;
    const net = require("node:net");
    const sockets = [];
    const server = net.createServer(socket => {
      sockets.push(socket);
      socket.setNoDelay(true);
      socket.on("error", () => {});
      let buf = "";
      let hello = false;
      let replied = 0;
      socket.on("data", d => {
        buf += d.toString("latin1");
        if (!hello) {
          if (!buf.includes("HELLO")) return;
          hello = true;
          buf = "";
          socket.write("+OK" + CRLF);
          return;
        }
        let idx;
        while ((idx = buf.indexOf(GET)) !== -1) {
          buf = buf.slice(idx + GET.length);
          socket.write(replied++ === 0 ? first : next);
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", resolve);
      server.on("error", reject);
    });
    const client = new Bun.RedisClient("redis://127.0.0.1:" + server.address().port, {
      autoReconnect: false,
      connectionTimeout: 30000,
    });
    await client.connect();
    async function run(count, label) {
      const inflight = [];
      let received = 0;
      for (let i = 0; i < count; i++) {
        inflight.push(client.get("k"));
        if (inflight.length === WINDOW || i === count - 1) {
          const values = await Promise.all(inflight);
          inflight.length = 0;
          for (const v of values) {
            if (typeof v !== "string" || v.length !== B) throw new Error("bad " + label + " reply " + received);
            received++;
          }
          Bun.gc(false);
        }
      }
      if (received !== count) throw new Error("expected " + count + " " + label + " replies, got " + received);
    }
    await run(2 * WINDOW, "warmup");
    Bun.gc(true);
    const baseline = process.memoryUsage().rss;
    const ROUNDS = ${ROUNDS};
    await run(ROUNDS, "measured");
    Bun.gc(true);
    await 1;
    Bun.gc(true);
    const growthMB = (process.memoryUsage().rss - baseline) / (1024 * 1024);
    const trafficMB = (ROUNDS * (B + K + 16)) / (1024 * 1024);
    client.close();
    for (const s of sockets) s.destroy();
    server.close();
    console.log(JSON.stringify({ growthMB, trafficMB }));
    process.exit(0);
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: {
        ...bunEnv,
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    const { growthMB, trafficMB } = JSON.parse(stdout.trim());
    expect(trafficMB).toBeGreaterThan(70);
    // ASAN's allocator keeps freed pages resident, so the child's RSS tracks
    // peak allocation there rather than retention; the tight ratio is
    // enforced on non-sanitized lanes.
    expect(growthMB).toBeLessThan(trafficMB * (isASAN ? 1.5 : 0.85));
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  },
  180_000,
);

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

// Closing a client from the continuation of its last reply and collecting
// before the socket read returns used to panic ("unreachable" in
// subscription_callback_map): the collector had found the wrapper dead but
// finalize() had not run yet. The fixture runs the scenario ten times, checks
// after each collection whether the wrapper is really dead, and exits non-zero
// unless at least one round reached that state and came back from the read.
test.concurrent("a client closed and collected from within its own reply does not crash the socket read", async () => {
  const result = await bunRun(join(import.meta.dir, "valkey.close-from-reply.fixture.ts"));
  expect(result).toSpawn();
  const reached = result.stdout.match(/^([1-9]\d*) rounds? reached the window$/m);
  expect(reached).not.toBeNull();
  // Keep the per-lane count in the CI log so a slide toward zero is visible.
  console.log(`close-from-reply fixture: ${reached![1]} of 10 rounds reached the window`);
});

test.concurrent("new RedisClient(url) does not leak the URL and its components", async () => {
  const code = /* js */ `
    const base = Buffer.alloc(200 * 1024, "a").toString();
    function once(i) { try { new Bun.RedisClient("redis://user:" + base + i + "@127.0.0.1:1/0"); } catch {} }
    for (let i = 0; i < 20; i++) once(i);
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 300; i++) once(i);
    Bun.gc(true);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;

  // Unfixed: ~148 MiB. Fixed: allocator slack only.
  await expectRssDeltaBelow(["--smol", "-e", code], { release: 70, debug: 90 });
});

test.concurrent("RESP map keys are not leaked", async () => {
  const code = /* js */ `
    const net = require("net");
    const big = Buffer.alloc(400 * 1024, "k").toString();
    let n = 0;
    const server = net.createServer(sock => {
      sock.on("data", d => {
        const s = d.toString();
        for (const _ of s.split("\\r\\n").filter(x => x.startsWith("*"))) {
          if (s.includes("HELLO")) sock.write("%1\\r\\n+server\\r\\n+mock\\r\\n");
          else {
            const k1 = big + n++, k2 = big + n++;
            sock.write("%2\\r\\n$" + k1.length + "\\r\\n" + k1 + "\\r\\n:1\\r\\n$" + k2.length + "\\r\\n" + k2 + "\\r\\n:2\\r\\n");
          }
        }
      });
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const client = new Bun.RedisClient("redis://127.0.0.1:" + server.address().port);
    await client.connect();
    for (let i = 0; i < 10; i++) await client.send("HGETALL", ["x"]);
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 300; i++) await client.send("HGETALL", ["x"]);
    Bun.gc(true);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
    client.close();
    server.close();
  `;

  // Unfixed: ~270 MiB (two 400 KiB keys per reply). Fixed: ~30 MiB of JS string churn.
  await expectRssDeltaBelow(["--smol", "-e", code], { release: 130, debug: 160 });
});
