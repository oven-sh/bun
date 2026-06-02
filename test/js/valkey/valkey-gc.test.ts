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
