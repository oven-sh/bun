import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import net from "node:net";

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
// The reader bounds how many bytes it will accumulate while waiting for that
// terminator (MAX_LINE_LEN = 512 KiB), so a server that streams an endless
// unterminated line gets a protocol error promptly instead of the client
// buffering and rescanning the whole line on every socket read.
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

  // 1) A simple-string reply whose CRLF terminator never arrives. Once more
  //    than 512 KiB of the line has accumulated, the client must fail the
  //    reply with a protocol error rather than keep waiting for a terminator
  //    that never comes. (The server closes the socket after the payload so
  //    that a client which keeps waiting still settles the promise -- with a
  //    connection-closed error instead of the expected protocol error.)
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
        expect(error.code).toBe("ERR_REDIS_INVALID_RESPONSE");
      } finally {
        client.close();
      }
    } finally {
      server.close();
    }
  }

  // 2) A large but properly terminated simple string under the bound still
  //    parses.
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

// https://github.com/oven-sh/bun/issues/33103
// close() on a client still in subscriber mode must release every event-loop
// reference it holds, just like unsubscribe()-then-close() does. The poll ref
// is driven by the subscription callback map, which close() left populated, so
// update_poll_ref kept the ref (and the strong this_value) alive forever and
// the process never exited. The mock server stays in this (parent) process so
// the spawned subscriber's exit depends solely on the client releasing its
// refs; nothing else keeps that subprocess alive after close().
test.concurrent("close() while subscribed lets the process exit", async () => {
  // Minimal RESP3 mock: +OK to the HELLO handshake, a subscribe push to
  // SUBSCRIBE. Enough to drive the client to connected + subscribed. TCP is a
  // stream, so accumulate bytes and reply once per command (a token could
  // straddle two reads).
  const server = net.createServer(socket => {
    let buffered = "";
    let repliedHello = false;
    let repliedSubscribe = false;
    socket.on("data", (data: Buffer) => {
      buffered += data.toString("latin1");
      if (!repliedHello && buffered.includes("HELLO")) {
        repliedHello = true;
        socket.write("+OK\r\n");
      }
      if (!repliedSubscribe && buffered.includes("SUBSCRIBE")) {
        repliedSubscribe = true;
        socket.write(">3\r\n$9\r\nsubscribe\r\n$4\r\nchan\r\n:1\r\n");
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  const port = (server.address() as net.AddressInfo).port;

  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const subscriber = new Bun.RedisClient(process.env.REDIS_URL);
          await subscriber.connect();
          await subscriber.subscribe("chan", () => {});
          subscriber.close();
          console.log("closed");
        `,
      ],
      env: { ...bunEnv, REDIS_URL: `redis://127.0.0.1:${port}` },
      stdout: "pipe",
      stderr: "pipe",
      // Fixed, the subscriber exits on its own right after close(). The timeout
      // only bounds the pre-fix hang so a stuck child is killed (non-null
      // signalCode below) instead of lingering.
      timeout: 10_000,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("closed");
    if (exitCode !== 0) expect(stderr).toBe("");
    // null => exited on its own; non-null => killed by the spawn timeout (hung).
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  } finally {
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/33103
// Same leak on a sibling terminal path: a subscribed client with
// autoReconnect:false that the server drops is just as dead (no reconnect, no
// message ever again), but on_close takes the no-reconnect branch that never
// sets is_manually_closed, so only gating on that flag still pinned the loop.
// update_poll_ref also has to treat the terminal `failed` flag as deletable.
test.concurrent("server dropping a subscribed no-reconnect client lets the process exit", async () => {
  // Mock drops the connection right after confirming the SUBSCRIBE. TCP is a
  // stream, so accumulate bytes and reply once per command.
  const server = net.createServer(socket => {
    let buffered = "";
    let repliedHello = false;
    let dropped = false;
    socket.on("data", (data: Buffer) => {
      buffered += data.toString("latin1");
      if (!repliedHello && buffered.includes("HELLO")) {
        repliedHello = true;
        socket.write("+OK\r\n");
      }
      if (!dropped && buffered.includes("SUBSCRIBE")) {
        dropped = true;
        socket.write(">3\r\n$9\r\nsubscribe\r\n$4\r\nchan\r\n:1\r\n", () => socket.end());
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  const port = (server.address() as net.AddressInfo).port;

  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const sub = new Bun.RedisClient(process.env.REDIS_URL, { autoReconnect: false });
          await sub.connect();
          // Let a subscribe() failure surface so "subscribed" prints only once
          // subscriber mode is actually established; the test then fails for the
          // right reason if it never got there.
          await sub.subscribe("chan", () => {});
          console.log("subscribed");
          // No close(): the server drop is terminal, so the loop must release.
        `,
      ],
      env: { ...bunEnv, REDIS_URL: `redis://127.0.0.1:${port}` },
      stdout: "pipe",
      stderr: "pipe",
      // Bounds the pre-fix hang so a stuck child shows up as a non-null
      // signalCode instead of lingering; the fixed client exits on its own.
      timeout: 10_000,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("subscribed");
    if (exitCode !== 0) expect(stderr).toBe("");
    // null => exited on its own; non-null => killed by the spawn timeout (hung).
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  } finally {
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/33103
// Third terminal path: a subscribed client that exhausts its reconnect retries.
// on_close sets is_reconnecting on the first retry and never clears it on the
// give-up branch, and has_activity ORs that flag in independently of
// subs_deletable, so the client stayed pinned forever once retries ran out.
// update_poll_ref must ignore is_reconnecting once the client has failed.
// (The subscription is what keeps the client alive long enough to reconnect;
// an idle client releases the loop right after connect and never gets here.)
test.concurrent("a subscribed client that exhausts reconnect retries lets the process exit", async () => {
  // Full handshake + subscribe on the first connection, then drop it. The
  // server keeps listening and drops every later connection before replying to
  // HELLO, so each reconnect resets instead of re-establishing and the retries
  // are exhausted. Connecting to a listening port that then resets is prompt
  // cross-platform; refusing a closed port is not (e.g. Windows SYN timeouts).
  let connections = 0;
  const server = net.createServer(socket => {
    socket.on("error", () => {});
    if (++connections > 1) {
      socket.destroy();
      return;
    }
    let buffered = "";
    let repliedHello = false;
    let dropped = false;
    socket.on("data", (data: Buffer) => {
      buffered += data.toString("latin1");
      if (!repliedHello && buffered.includes("HELLO")) {
        repliedHello = true;
        socket.write("+OK\r\n");
      }
      if (!dropped && buffered.includes("SUBSCRIBE")) {
        dropped = true;
        socket.write(">3\r\n$9\r\nsubscribe\r\n$4\r\nchan\r\n:1\r\n", () => socket.end());
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  const port = (server.address() as net.AddressInfo).port;

  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const c = new Bun.RedisClient(process.env.REDIS_URL, { maxRetries: 1 });
          await c.connect();
          await c.subscribe("chan", () => {});
          console.log("subscribed");
          // No close(): the reconnect attempt is dropped before it can
          // re-establish, so once retries are exhausted the loop must release.
        `,
      ],
      env: { ...bunEnv, REDIS_URL: `redis://127.0.0.1:${port}` },
      stdout: "pipe",
      stderr: "pipe",
      // Bounds the pre-fix hang so a stuck child shows up as a non-null
      // signalCode instead of lingering; the fixed client exits on its own.
      timeout: 10_000,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("subscribed");
    if (exitCode !== 0) expect(stderr).toBe("");
    // null => exited on its own; non-null => killed by the spawn timeout (hung).
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  } finally {
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/33103
// Fourth terminal path: a reply that is only half-read when the connection
// dies. has_pending_commands also counts read_buffer.len(), and on_close only
// cleared write_buffer, so a partial frame left in the read buffer kept the
// loop pinned forever. on_close must drop the read buffer (and reset the
// scanner) too, since a detached socket can never complete that frame.
test.concurrent("a half-read reply on a dropped connection lets the process exit", async () => {
  // Announce a large bulk string but send only a few bytes, then drop: the
  // client buffers the partial frame while waiting for the rest that never comes.
  // Hoisted so the test can assert the truncated-reply path actually ran.
  let sentPartial = false;
  const server = net.createServer(socket => {
    let buffered = "";
    let repliedHello = false;
    socket.on("data", (data: Buffer) => {
      buffered += data.toString("latin1");
      if (!repliedHello && buffered.includes("HELLO")) {
        repliedHello = true;
        socket.write("+OK\r\n");
      }
      if (!sentPartial && buffered.includes("GET")) {
        sentPartial = true;
        socket.write("$1000000\r\nPARTIAL", () => socket.end());
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  const port = (server.address() as net.AddressInfo).port;

  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const c = new Bun.RedisClient(process.env.REDIS_URL, { autoReconnect: false });
          await c.connect();
          // The GET reply is a truncated bulk string and the server drops; the
          // half-read frame must be discarded on close so the loop releases.
          await c.get("k").catch(() => {});
          console.log("done");
        `,
      ],
      env: { ...bunEnv, REDIS_URL: `redis://127.0.0.1:${port}` },
      stdout: "pipe",
      stderr: "pipe",
      // Bounds the pre-fix hang so a stuck child shows up as a non-null
      // signalCode instead of lingering; the fixed client exits on its own.
      timeout: 10_000,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Prove the client actually exercised the truncated-reply path.
    expect(sentPartial).toBe(true);
    expect(stdout.trim()).toBe("done");
    if (exitCode !== 0) expect(stderr).toBe("");
    // null => exited on its own; non-null => killed by the spawn timeout (hung).
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  } finally {
    server.close();
  }
});
