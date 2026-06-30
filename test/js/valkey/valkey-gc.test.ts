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
