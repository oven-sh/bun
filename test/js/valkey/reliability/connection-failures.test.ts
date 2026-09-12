import { blackholeListener } from "blackhole";
import { RedisClient } from "bun";
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { describe, expect, mock, test } from "bun:test";
import { once } from "events";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, nodeExe, tempDir, tls as tlsCert } from "harness";
import net from "net";
import path from "path";
import tls from "tls";
import { DEFAULT_REDIS_OPTIONS, DEFAULT_REDIS_URL, delay, isEnabled } from "../test-utils";

/**
 * Test suite for connection failures, reconnection, and error handling
 * - Connection failures
 * - Reconnection behavior
 * - Timeout handling
 * - Error propagation
 */
describe.skipIf(!isEnabled)("Valkey: Connection Failures", () => {
  // Use invalid port to force connection failure
  const BAD_CONNECTION_URL = "redis://localhost:12345";

  describe("Connection Failure Handling", () => {
    test("should handle initial connection failure gracefully", async () => {
      // Create client with invalid port to force connection failure
      const client = new RedisClient(BAD_CONNECTION_URL, {
        connectionTimeout: 500, // Short timeout
        autoReconnect: false, // Disable auto reconnect to simplify the test
      });

      try {
        // Attempt to send command - should fail with connection error
        await client.set("key", "value");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Expect an error with connection closed message
        expect(error.message).toMatch(/connection closed|socket closed|failed to connect/i);
      } finally {
        // Cleanup
        await client.close();
      }
    });

    test("should reject commands with appropriate errors when disconnected", async () => {
      // Create client with invalid connection
      const client = new RedisClient(BAD_CONNECTION_URL, {
        connectionTimeout: 500,
        autoReconnect: false,
        enableOfflineQueue: false, // Disable offline queue to test immediate rejection
      });

      // Verify the client is not connected
      expect(client.connected).toBe(false);

      // Try commands individually to make sure they fail properly
      try {
        await client.get("any-key");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should fail with connection error
        expect(error.message).toMatch(/connection closed|socket closed|failed to connect|offline queue is disabled/i);
      }

      try {
        await client.set("any-key", "value");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should fail with connection error
        expect(error.message).toMatch(/connection closed|socket closed|failed to connect|offline queue is disabled/i);
      }

      try {
        await client.del("any-key");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should fail with connection error
        expect(error.message).toMatch(/connection closed|socket closed|failed to connect|offline queue is disabled/i);
      }

      try {
        await client.incr("counter");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should fail with connection error
        expect(error.message).toMatch(/connection closed|socket closed|failed to connect|offline queue is disabled/i);
      }
    });

    test("should handle connection timeout", async () => {
      // The connect never completes, so the short timeout is what fails it.
      using blackhole = await blackholeListener();
      const client = new RedisClient(`redis://${blackhole.hostname}:${blackhole.port}`, {
        connectionTimeout: 2,
        autoReconnect: false,
      });
      try {
        await expect(client.get("any-key")).rejects.toThrowErrorMatchingInlineSnapshot(
          `"Connection timeout reached after 2ms"`,
        );
      } finally {
        await client.close();
      }
    });

    test("should report correct connected status", async () => {
      // Create client with invalid connection
      const client = new RedisClient(BAD_CONNECTION_URL, {
        connectionTimeout: 500,
        autoReconnect: false,
      });

      // Should report disconnected state
      expect(client.connected).toBe(false);

      try {
        // Try to send command to ensure connection attempt
        await client.get("key");
      } catch (error) {
        // Expected error
      }

      // Should still report disconnected
      expect(client.connected).toBe(false);

      await client.close();
    });
  });

  describe("Reconnection Behavior", () => {
    // Use a shorter timeout to avoid test hanging
    test("should reject commands when offline queue is enabled", async () => {
      // Create client with invalid connection but with offline queue enabled
      const client = new RedisClient(BAD_CONNECTION_URL, {
        connectionTimeout: 100, // Very short timeout
        autoReconnect: false, // Disable auto-reconnect to avoid waiting for retries
        enableOfflineQueue: true,
      });

      // Try to send a command - it should be queued but eventually fail
      // when the connection timeout is reached
      const commandPromise = client.set("key1", "value1");

      try {
        await commandPromise;
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should fail with a connection error
        expect(error.message).toMatch(/connection closed|socket closed|failed to connect/i);
      }

      await client.close();
    });

    test("should reject commands when offline queue is disabled", async () => {
      // Create client with invalid connection and offline queue disabled
      const client = new RedisClient(BAD_CONNECTION_URL, {
        connectionTimeout: 500,
        autoReconnect: true,
        enableOfflineQueue: false,
      });

      try {
        // Try to send command - should reject immediately
        await client.set("key", "value");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error.message).toMatch(/connection closed|offline queue is disabled/i);
      }

      await client.close();
    });

    // Skip this test since it's hard to reliably wait for max retries in a test environment
    test.skip("should stop reconnection attempts after max retries", async () => {
      // This test is unreliable in a test environment, as it would need to wait
      // for all retry attempts which could cause timeouts
    });
  });

  describe("Connection Event Callbacks", () => {
    // Only test this if Redis is available
    test("onconnect and onclose handlers", async () => {
      // Try connecting to the default Redis URL
      const client = new RedisClient(DEFAULT_REDIS_URL, DEFAULT_REDIS_OPTIONS);

      // Set up event handlers
      const onconnect = mock(() => {});
      const onclose = mock(() => {});
      client.onconnect = onconnect;
      client.onclose = onclose;
      await client.set("__test_key", "test-value");

      // If we get here, connection succeeded, so we should check connect callback
      expect(client.connected).toBe(true);
      expect(onconnect).toHaveBeenCalled();

      // Explicitly disconnect to trigger onclose
      client.close();

      // Wait briefly for disconnect callbacks to execute
      await delay(10);

      // onclose should be called regardless of whether the connection succeeded
      expect(client.connected).toBe(false);
      expect(onclose).toHaveBeenCalled();

      expect(onconnect).toHaveBeenCalledTimes(1);
      expect(onclose).toHaveBeenCalledTimes(1);
    });
    test("should support changing onconnect and onclose handlers", async () => {
      const client = new RedisClient(DEFAULT_REDIS_URL, DEFAULT_REDIS_OPTIONS);

      // Create mock handlers
      const onconnect1 = mock(() => {});
      const onclose1 = mock(() => {});
      const onconnect2 = mock(() => {});
      const onclose2 = mock(() => {});

      // Set initial handlers
      client.onconnect = onconnect1;
      client.onclose = onclose1;

      // Change handlers
      client.onconnect = onconnect2;
      client.onclose = onclose2;

      try {
        // Try to initialize connection
        await client.set("__test_key", "test-value");
      } catch (error) {
        // Connection failed, but we can still test onclose
      }

      // Disconnect to trigger close handler
      await client.close();

      // Wait briefly for the callbacks to execute
      await delay(10);

      // First handlers should not have been called because they were replaced
      expect(onconnect1).not.toHaveBeenCalled();
      expect(onclose1).not.toHaveBeenCalled();

      // Second handlers should have been called
      expect(onclose2).toHaveBeenCalled();

      // If connection succeeded, the connect handler should have been called
      if (client.connected) {
        expect(onconnect2).toHaveBeenCalled();
      }
    });
  });

  describe("Handling Manually Closed Connections", () => {
    test("should not auto-reconnect when manually closed", async () => {
      // Set up a client
      const client = new RedisClient(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        autoReconnect: true,
      });

      // Try to initialize connection
      await client.set("__test_key", "test-value");

      // Manually disconnect
      client.close();

      // Try to send a command
      expect(client.connected).toBe(false);
      expect(async () => {
        await client.get("__test_key");
      }).toThrowErrorMatchingInlineSnapshot(`"Connection has failed"`);
      // Wait some time to see if auto-reconnect happens
      await delay(50);

      // Should still be disconnected
      expect(client.connected).toBe(false);
    });

    test("should clean up resources when disconnected", async () => {
      // Create a client with no auto reconnect to simplify test
      const client = new RedisClient(BAD_CONNECTION_URL, {
        autoReconnect: false,
        connectionTimeout: 100,
      });

      // Disconnect immediately
      await client.close();

      expect(client.connected).toBe(false);
      expect(async () => {
        await client.get("any-key");
      }).toThrowErrorMatchingInlineSnapshot(`"Connection closed"`);
      // Multiple disconnects should not cause issues
      await client.close();
      await client.close();
    });
  });

  describe("Multiple Connection Attempts", () => {
    test("should handle rapid connection/disconnection", async () => {
      // Create and immediately disconnect many clients
      const promises = [];

      for (let i = 0; i < 10; i++) {
        const client = new RedisClient(DEFAULT_REDIS_URL, {
          ...DEFAULT_REDIS_OPTIONS,
          connectionTimeout: 500,
        });

        // Immediately disconnect
        promises.push(client.close());
      }

      // All should resolve without errors
      await Promise.all(promises);
    });

    test("should not crash when connections fail", async () => {
      // Create multiple clients with invalid connections in parallel
      const clients = [];

      for (let i = 0; i < 5; i++) {
        clients.push(
          new RedisClient(BAD_CONNECTION_URL, {
            connectionTimeout: 200,
            autoReconnect: false,
          }),
        );
      }

      // Try sending commands to all clients
      const promises = clients.map(client =>
        client.get("key").catch(err => {
          // We expect errors, but want to make sure they're the right kind
          expect(err.message).toMatch(/connection closed|socket closed|failed to connect/i);
        }),
      );

      // All should reject without crashing
      await Promise.all(promises);

      // Clean up
      for (const client of clients) {
        await client.close();
      }
    });
  });
});

// Takes the complete RESP commands off the front of `state.buffer` and leaves
// any partial command in it for the next chunk.
function readCommands(state: { buffer: Buffer }): string[][] {
  const commands: string[][] = [];
  while (true) {
    const text = state.buffer.toString("latin1");
    if (text[0] !== "*") break;
    const headerEnd = text.indexOf("\r\n");
    if (headerEnd === -1) break;
    const argCount = parseInt(text.slice(1, headerEnd), 10);
    if (!Number.isInteger(argCount) || argCount < 0) break;
    let pos = headerEnd + 2;
    const args: string[] = [];
    let complete = true;
    for (let i = 0; i < argCount; i++) {
      if (text[pos] !== "$") {
        complete = false;
        break;
      }
      const lenEnd = text.indexOf("\r\n", pos);
      if (lenEnd === -1) {
        complete = false;
        break;
      }
      const len = parseInt(text.slice(pos + 1, lenEnd), 10);
      if (!Number.isInteger(len) || len < 0) {
        complete = false;
        break;
      }
      const dataStart = lenEnd + 2;
      const dataEnd = dataStart + len;
      if (text.length < dataEnd + 2) {
        complete = false;
        break;
      }
      args.push(text.slice(dataStart, dataEnd));
      pos = dataEnd + 2;
    }
    if (!complete) break;
    commands.push(args);
    state.buffer = state.buffer.subarray(pos);
  }
  return commands;
}

describe("Valkey: Auto-Reconnect In-Flight Commands", () => {
  test("rejects commands that were in flight when the connection dropped instead of pairing them with replies from the next connection", async () => {
    const sockets: net.Socket[] = [];
    let connections = 0;
    const secondHello = Promise.withResolvers<void>();
    const serverError = Promise.withResolvers<never>();
    const server = net.createServer(socket => {
      connections += 1;
      const connection = connections;
      sockets.push(socket);
      const state = { buffer: Buffer.alloc(0) };
      socket.on("data", chunk => {
        state.buffer = Buffer.concat([state.buffer, chunk]);
        for (const args of readCommands(state)) {
          const name = (args[0] ?? "").toUpperCase();
          if (name === "HELLO") {
            socket.write("+OK\r\n");
            if (connection === 2) {
              secondHello.resolve();
            }
          } else if (connection === 1) {
            socket.destroy();
          } else {
            socket.write("$5\r\nfresh\r\n");
          }
        }
      });
      socket.on("error", () => {});
    });
    server.on("error", serverError.reject);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    const client = new RedisClient(`redis://127.0.0.1:${port}`, {
      autoReconnect: true,
      enableOfflineQueue: true,
      connectionTimeout: 5000,
      maxRetries: 10,
    });
    try {
      const staleOutcome = client.get("stale-key").then(
        value => ({ status: "fulfilled", value }),
        error => ({ status: "rejected", code: error.code, message: error.message }),
      );
      await Promise.race([secondHello.promise, serverError.promise]);
      const fresh = client.get("fresh-key");
      expect(await Promise.race([staleOutcome, serverError.promise])).toEqual({
        status: "rejected",
        code: "ERR_REDIS_CONNECTION_CLOSED",
        message: "Connection closed",
      });
      expect(await fresh).toBe("fresh");
      expect(connections).toBe(2);
    } finally {
      client.close();
      server.close();
      for (const socket of sockets) {
        socket.destroy();
      }
    }
  });
});

describe("Valkey: Recovering After fail()", () => {
  // Answers the chunk carrying HELLO with `+OK` and the one carrying PING with
  // `+PONG` unless `replies` says otherwise for that connection (a hook that
  // returns null answers nothing). Other commands are never answered.
  function helloServer(
    replies: Partial<Record<"HELLO" | "PING", (connection: number, socket: net.Socket) => string | null>> = {},
    { secure = false, allowHalfOpen = false } = {},
  ) {
    const sockets: net.Socket[] = [];
    const onConnection = (socket: net.Socket) => {
      sockets.push(socket);
      const connection = sockets.length;
      socket.on("data", chunk => {
        const text = chunk.toString("latin1");
        for (const command of ["HELLO", "PING"] as const) {
          if (!text.includes(command)) continue;
          const reply = replies[command]
            ? replies[command](connection, socket)
            : `+${command === "HELLO" ? "OK" : "PONG"}\r\n`;
          if (reply !== null) socket.write(reply);
        }
      });
      socket.on("error", () => {});
    };
    const server: net.Server = secure
      ? tls.createServer({ key: tlsCert.key, cert: tlsCert.cert, allowHalfOpen }, onConnection)
      : net.createServer({ allowHalfOpen }, onConnection);
    return {
      server,
      sockets,
      get connections() {
        return sockets.length;
      },
      // events.once() rejects if the listen fails instead of leaving the test to time out.
      listen: async () => {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        return (server.address() as net.AddressInfo).port;
      },
      listenUnix: async (socketPath: string) => {
        server.listen(socketPath);
        await once(server, "listening");
      },
      close: () => new Promise(resolve => server.close(resolve)),
    };
  }

  // The RST a failed client sends makes the stub's socket emit an error before
  // it closes, which events.once() would turn into a rejection.
  function closedOnServer(socket: net.Socket): Promise<void> {
    return socket.destroyed ? Promise.resolve() : new Promise(resolve => socket.once("close", () => resolve()));
  }

  // How the peer's socket ended: "end" for a FIN, the error code for an RST.
  function endOrError(socket: net.Socket): Promise<string> {
    return new Promise(resolve => {
      socket.once("end", () => resolve("end"));
      socket.once("error", (err: NodeJS.ErrnoException) => resolve(err.code ?? err.message));
    });
  }

  const STUCK_VALUE_BYTES = 256 * 1024;
  // One of writeUntilStuck's SETs as the client frames it: header, value, CRLF.
  const STUCK_COMMAND_BYTES =
    `*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$${STUCK_VALUE_BYTES}\r\n`.length + STUCK_VALUE_BYTES + 2;

  // Writes SETs of STUCK_VALUE_BYTES until two flushes in a row hand nothing to
  // the socket, i.e. the peer has stopped reading and the socket holds
  // undelivered bytes.
  async function writeUntilStuck(client: RedisClient): Promise<Promise<string>[]> {
    const value = Buffer.alloc(STUCK_VALUE_BYTES, "x").toString();
    const pending: Promise<string>[] = [];
    let stuckFlushes = 0;
    while (stuckFlushes < 2 && pending.length < 256) {
      const before = client.bufferedAmount;
      pending.push(
        client.set("key", value).then(
          () => "resolved",
          err => err.code,
        ),
      );
      await new Promise(resolve => setImmediate(resolve));
      const added = client.bufferedAmount - before;
      stuckFlushes = added >= value.length ? stuckFlushes + 1 : 0;
    }
    expect(stuckFlushes).toBe(2);
    return pending;
  }

  // RESP3 push frames as the server writes them for SUBSCRIBE and for messages.
  const push = (...items: (string | number)[]) =>
    `>${items.length}\r\n` +
    items
      .map(item => (typeof item === "number" ? `:${item}\r\n` : `$${Buffer.byteLength(item)}\r\n${item}\r\n`))
      .join("");

  // A process that a client keeps alive never exits on its own; report that
  // as the exit code instead of waiting for the test to time out. The payload
  // runs in well under a second on a debug build; the exit itself is what an
  // ASAN build makes slow.
  async function exitOutcome(proc: Bun.Subprocess<"ignore", "pipe", "pipe">) {
    const output = Promise.all([proc.stdout.text(), proc.stderr.text()]);
    const budget = isASAN || isDebug ? 15_000 : 3_000;
    const exitCode = await Promise.race([proc.exited, delay(budget).then(() => "still running" as const)]);
    if (exitCode === "still running") proc.kill();
    const [stdout, stderr] = await output;
    return { stdout, stderr, exitCode };
  }

  // Calls connect() from the first onclose and reports how that attempt ended.
  function connectFromOnclose(client: RedisClient): Promise<string> {
    const { promise, resolve } = Promise.withResolvers<string>();
    client.onclose = () => {
      client.onclose = () => {};
      resolve(
        client.connect().then(
          () => "connected",
          (err: Error) => `rejected: ${err.message}`,
        ),
      );
    };
    return promise;
  }

  // A failure the client detects itself is a deliberate close, not a retry,
  // even with auto reconnect on (left on here): only closes initiated by the
  // peer go through the retry policy, as has always been the case and unlike
  // ioredis. onclose only fires on that terminal path, so it firing is the
  // assertion.
  test.each([
    ["redis", false],
    ["rediss", true],
  ])(
    "a failure while connected over %s:// closes the socket, fires onclose, and connect() reconnects",
    async (scheme, secure) => {
      // 0x01 is not a RESP type byte, so the first connection fails after the
      // handshake, on the same path as an idle timeout or any other protocol error.
      const fake = helloServer({ PING: connection => (connection === 1 ? "\x01\r\n" : "+PONG\r\n") }, { secure });
      const port = await fake.listen();
      const closed = Promise.withResolvers<Error>();
      const client = new RedisClient(`${scheme}://127.0.0.1:${port}`, secure ? { tls: { ca: tlsCert.cert } } : {});
      try {
        client.onclose = err => closed.resolve(err);
        await client.connect();
        expect(client.connected).toBe(true);
        await expect(client.ping()).rejects.toMatchObject({ code: "ERR_REDIS_INVALID_RESPONSE_TYPE" });
        // Already closed when the rejection is observed. Over TLS a graceful
        // close would still be waiting for the peer's close_notify at this point.
        expect(client.connected).toBe(false);
        expect(await closed.promise).toBeInstanceOf(Error);
        expect(fake.connections).toBe(1);
        await client.connect();
        expect(await client.ping()).toBe("PONG");
        expect(fake.connections).toBe(2);
      } finally {
        client.close();
        fake.server.close();
      }
    },
  );

  test.each([
    ["redis", false],
    ["rediss", true],
  ])("an idle timeout over %s:// closes the connection and rejects what was in flight", async (scheme, secure) => {
    const fake = helloServer({}, { secure });
    const port = await fake.listen();
    const closed = Promise.withResolvers<{ err: Error & { code: string }; connectedInsideOnclose: boolean }>();
    // What is pinned here is what happens when the timer fires on an idle
    // connection. 500ms leaves a debug build ample room to finish connecting.
    const client = new RedisClient(`${scheme}://127.0.0.1:${port}`, {
      idleTimeout: 50,
      connectionTimeout: 500,
      ...(secure ? { tls: { ca: tlsCert.cert } } : {}),
    });
    try {
      client.onclose = err =>
        closed.resolve({ err: err as Error & { code: string }, connectedInsideOnclose: client.connected });
      await client.connect();
      // GET is never answered by the stub, so it is still in flight when the timeout fires.
      const inFlight = client.get("key").then(
        () => "resolved",
        (err: Error & { code: string }) => err.code,
      );
      const { err, connectedInsideOnclose } = await closed.promise;
      expect({
        onclose: err.code,
        connectedInsideOnclose,
        connectedAfter: client.connected,
        inFlight: await inFlight,
        connections: fake.connections,
      }).toEqual({
        onclose: "ERR_REDIS_CONNECTION_CLOSED",
        connectedInsideOnclose: false,
        connectedAfter: false,
        inFlight: "ERR_REDIS_IDLE_TIMEOUT",
        connections: 1,
      });
      await closedOnServer(fake.sockets[0]);
      await client.connect();
      expect(await client.ping()).toBe("PONG");
      expect(fake.connections).toBe(2);
    } finally {
      client.close();
      fake.server.close();
    }
  });

  test("a connection that stays silent after the handshake is closed by its idle timeout", async () => {
    const fake = helloServer();
    const port = await fake.listen();
    // The timer is armed with connectionTimeout when the socket is dialed, and
    // accepting HELLO is what switches it to idleTimeout. With connectionTimeout
    // off, the idle timeout is the only thing that can close this connection.
    const client = new RedisClient(`redis://127.0.0.1:${port}`, {
      connectionTimeout: 0,
      idleTimeout: 50,
      autoReconnect: false,
    });
    try {
      // Once for a first connection, once for the one connect() dials after it.
      for (const connection of [1, 2]) {
        const closed = Promise.withResolvers<Error>();
        client.onclose = err => closed.resolve(err);
        await client.connect();
        expect(client.connected).toBe(true);
        expect(await closed.promise).toMatchObject({ code: "ERR_REDIS_CONNECTION_CLOSED" });
        expect(client.connected).toBe(false);
        expect(fake.connections).toBe(connection);
      }
    } finally {
      client.close();
      fake.server.close();
    }
  });

  test("data from the server restarts the idle timeout", async () => {
    let pushes = 0;
    const fake = helloServer({
      // PING is answered with 30 pushes 20ms apart, at least 600ms of traffic,
      // and never with PONG. A client that is not subscribed discards them, so
      // restarting its idle timer is all they can do.
      PING: (_, socket) => {
        const timer = setInterval(() => {
          socket.write(">2\r\n$7\r\nmessage\r\n$2\r\nhi\r\n");
          if (++pushes === 30) clearInterval(timer);
        }, 20);
        socket.on("close", () => clearInterval(timer));
        return null;
      },
    });
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { idleTimeout: 400, autoReconnect: false });
    try {
      await client.connect();
      // Every push restarts the 400ms idle timer armed by the handshake, so it
      // runs out, rejecting PING, 400ms after the last push, not in the middle
      // of them.
      await expect(client.ping()).rejects.toMatchObject({ code: "ERR_REDIS_IDLE_TIMEOUT" });
      expect(pushes).toBe(30);
      expect(client.connected).toBe(false);
    } finally {
      client.close();
      fake.server.close();
    }
  });

  test("connected reads false inside onclose when the server drops an established connection", async () => {
    // Connection 1 is dropped by the server right after it answers PING.
    const fake = helloServer({
      PING: (connection, socket) => {
        if (connection !== 1) return "+PONG\r\n";
        socket.end("+PONG\r\n");
        return null;
      },
    });
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { autoReconnect: false });
    try {
      const closed = Promise.withResolvers<boolean>();
      client.onclose = () => closed.resolve(client.connected);
      await client.connect();
      expect(await client.ping()).toBe("PONG");
      expect(await closed.promise).toBe(false);
      await client.connect();
      expect(await client.ping()).toBe("PONG");
      expect(fake.connections).toBe(2);
    } finally {
      client.close();
      fake.server.close();
    }
  });

  test("close() over rediss:// does not wait for the peer to answer close_notify", async () => {
    // allowHalfOpen: the server never closes its side in response, which is
    // what a graceful TLS close would be waiting for.
    const fake = helloServer({}, { secure: true, allowHalfOpen: true });
    const port = await fake.listen();
    const client = new RedisClient(`rediss://127.0.0.1:${port}`, { tls: { ca: tlsCert.cert }, autoReconnect: false });
    try {
      let closes = 0;
      client.onclose = () => closes++;
      await client.connect();
      const ended = once(fake.sockets[0], "end");
      client.close();
      expect({ connected: client.connected, closes }).toEqual({ connected: false, closes: 1 });
      await ended;
    } finally {
      client.close();
      fake.sockets[0]?.destroy();
      fake.server.close();
    }
  });

  test("a failure while the peer has stopped reading still closes the TLS socket at once", async () => {
    // Pins the close code fail() uses: with a fast shutdown, usockets keeps a
    // TLS socket whose last batch flush could not be handed to the kernel
    // (packages/bun-usockets/src/crypto/openssl.c, us_internal_ssl_close) until
    // the peer reads again, which this peer never does.
    const fake = helloServer(
      {
        HELLO: (connection, socket) => {
          if (connection === 1) socket.pause();
          return "+OK\r\n";
        },
        PING: () => "+PONG\r\n",
      },
      { secure: true },
    );
    const port = await fake.listen();
    const closed = Promise.withResolvers<void>();
    const client = new RedisClient(`rediss://127.0.0.1:${port}`, { tls: { ca: tlsCert.cert }, autoReconnect: false });
    try {
      client.onclose = () => closed.resolve();
      await client.connect();
      const pending = await writeUntilStuck(client);
      const lastSet = client.set("key", "last");
      fake.sockets[0].write("\x01\r\n");
      await expect(lastSet).rejects.toMatchObject({ code: "ERR_REDIS_INVALID_RESPONSE_TYPE" });
      expect(client.connected).toBe(false);
      await closed.promise;
      await Promise.all(pending);
      await client.connect();
      expect(await client.ping()).toBe("PONG");
      expect(fake.connections).toBe(2);
    } finally {
      client.close();
      fake.sockets[0]?.destroy();
      fake.server.close();
    }
  });

  test("a connect() issued from onclose after a refused connection rejects instead of hanging", async () => {
    // Nothing listens on the port a just-closed listener used.
    const fake = helloServer();
    const port = await fake.listen();
    await new Promise(resolve => fake.server.close(resolve));
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { autoReconnect: false });
    try {
      const secondConnect = connectFromOnclose(client);
      await expect(client.connect()).rejects.toMatchObject({ code: "ERR_REDIS_CONNECTION_CLOSED" });
      expect(await secondConnect).toBe("rejected: Connection closed");
    } finally {
      client.close();
    }
  });

  test("a connection timeout shorter than the retry delay does not stop the retries from settling connect()", async () => {
    const fake = helloServer();
    const port = await fake.listen();
    await fake.close();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // The refusal comes back within a few milliseconds and the retry is
        // scheduled 50ms after it, so a 30ms timeout armed for the first attempt
        // would fire while no socket exists; the retry must still run and give up.
        // The queued PING is rejected by whichever failure ends the client, so
        // its message tells the two apart.
        const client = new Bun.RedisClient("redis://127.0.0.1:${port}", { connectionTimeout: 30, maxRetries: 1 });
        client.onclose = err => console.log("onclose", err.code);
        const connected = client.connect().catch(err => console.log("connect rejected", err.code));
        client.ping().catch(err => console.log("ping rejected:", err.message));
        await connected;
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: [
        "onclose ERR_REDIS_CONNECTION_CLOSED",
        "ping rejected: Max reconnection attempts reached",
        "connect rejected ERR_REDIS_CONNECTION_CLOSED",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  // The close for a dial that failed before a socket existed runs from the
  // event loop; until then the client must look like it is dialling, so that
  // whatever JS runs first neither dials on top of it nor is ignored.
  test("a connect() issued from onclose is not fed the replies left over from the failed connection", async () => {
    // With a database in the URL, HELLO and SELECT are written together, so a
    // server that rejects HELLO delivers both error replies in one read.
    const fake = helloServer({
      HELLO: connection =>
        connection === 1 ? "-WRONGPASS invalid password\r\n-NOAUTH Authentication required.\r\n" : "+OK\r\n+OK\r\n",
    });
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}/1`, { autoReconnect: false });
    try {
      const secondConnect = connectFromOnclose(client);
      await expect(client.connect()).rejects.toMatchObject({ code: "ERR_REDIS_CONNECTION_CLOSED" });
      expect(await secondConnect).toBe("connected");
      expect(await client.ping()).toBe("PONG");
      expect(fake.connections).toBe(2);
    } finally {
      client.close();
      fake.server.close();
    }
  });

  test("a rejected SELECT after an accepted HELLO fails the connection once and connect() from onclose dials again", async () => {
    // HELLO and SELECT are written together, and both replies come back in one
    // read: connection 1 accepts HELLO and rejects SELECT, connection 2 accepts both.
    const fake = helloServer({
      HELLO: connection => (connection === 1 ? "+OK\r\n-ERR DB index is out of range\r\n" : "+OK\r\n+OK\r\n"),
    });
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}/1`, { autoReconnect: true });
    try {
      const closes: { message: string; connected: boolean; connections: number }[] = [];
      let secondConnect: Promise<string> | undefined;
      client.onclose = err => {
        closes.push({ message: err.message, connected: client.connected, connections: fake.connections });
        secondConnect ??= client.connect().then(
          () => "connected",
          (err: Error) => `rejected: ${err.message}`,
        );
      };
      // Queued behind the handshake, so it is still pending when SELECT is rejected.
      const queued = client.get("key").then(
        () => "resolved",
        (err: Error & { code: string }) => `${err.code}: ${err.message}`,
      );
      // connect() settles on the accepted HELLO, before the SELECT reply is
      // read, so it resolves; the failure that follows is reported by onclose.
      await client.connect();
      expect(await queued).toBe("ERR_REDIS_INVALID_COMMAND: ERR DB index is out of range");
      // The rejection is a failure the client detected, so there is no retry
      // even with autoReconnect on: onclose fires once and the only second
      // connection is the one dialed from it.
      expect(closes).toEqual([{ message: "Connection closed", connected: false, connections: 1 }]);
      expect(await secondConnect).toBe("connected");
      expect(await client.ping()).toBe("PONG");
      expect(fake.connections).toBe(2);
    } finally {
      client.close();
      fake.server.close();
    }
  });

  test("a duplicate of a failed client still auto-reconnects", async () => {
    // Connection 1 (the original) fails on a protocol error, connection 2 (the
    // duplicate) is dropped by the server right after it answers PING.
    const fake = helloServer({
      PING: (connection, socket) => {
        if (connection === 1) return "\x01\r\n";
        if (connection === 2) {
          socket.end("+PONG\r\n");
          return null;
        }
        return "+PONG\r\n";
      },
    });
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { autoReconnect: true });
    let duplicate: RedisClient | undefined;
    try {
      await client.connect();
      await expect(client.ping()).rejects.toMatchObject({ code: "ERR_REDIS_INVALID_RESPONSE_TYPE" });
      expect(client.connected).toBe(false);
      duplicate = await client.duplicate();
      // A duplicate carries no close history from its source, so the drop of
      // connection 2 goes through the retry policy: no onclose, a second
      // onconnect, and the next PING answered by connection 3.
      const reconnected = Promise.withResolvers<void>();
      let connects = 0;
      duplicate.onconnect = () => {
        if (++connects === 2) reconnected.resolve();
      };
      duplicate.onclose = err => reconnected.reject(err);
      expect(await duplicate.ping()).toBe("PONG");
      await reconnected.promise;
      expect(await duplicate.ping()).toBe("PONG");
      expect(fake.connections).toBe(3);
    } finally {
      duplicate?.close();
      client.close();
      fake.server.close();
    }
  });

  test("a duplicate of a closed client auto-reconnects", async () => {
    // Connection 2 (the duplicate's first) is dropped by the server right
    // after it answers PING.
    const fake = helloServer({
      PING: (connection, socket) => {
        if (connection === 2) {
          socket.end("+PONG\r\n");
          return null;
        }
        return "+PONG\r\n";
      },
    });
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { autoReconnect: true });
    let duplicate: RedisClient | undefined;
    try {
      await client.connect();
      client.close();
      duplicate = await client.duplicate();
      // The duplicate has no close history of its own, so the drop of
      // connection 2 goes through the retry policy: no onclose, a second
      // onconnect, and the next PING answered by connection 3.
      const reconnected = Promise.withResolvers<void>();
      let connects = 0;
      duplicate.onconnect = () => {
        if (++connects === 2) reconnected.resolve();
      };
      duplicate.onclose = err => reconnected.reject(err);
      expect(await duplicate.ping()).toBe("PONG");
      await reconnected.promise;
      expect(await duplicate.ping()).toBe("PONG");
      expect(fake.connections).toBe(3);
    } finally {
      duplicate?.close();
      client.close();
      fake.server.close();
    }
  });

  test("a message listener that closes and reconnects is not fed the pushes buffered behind its message", async () => {
    const fake = helloServer();
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`);
    try {
      await client.connect();
      const connection1 = fake.sockets[0];
      connection1.on("data", chunk => {
        if (chunk.toString("latin1").includes("SUBSCRIBE")) connection1.write(push("subscribe", "ch", 1));
      });
      const delivered: string[] = [];
      const firstDelivered = Promise.withResolvers<void>();
      const reconnect = Promise.withResolvers<string>();
      await client.subscribe("ch", message => {
        delivered.push(message);
        if (delivered.length === 1) firstDelivered.resolve();
        if (delivered.length !== 2) return;
        client.close();
        reconnect.resolve(
          client.connect().then(
            () => "connected",
            (err: Error) => `rejected: ${err.message}`,
          ),
        );
      });
      const [m1, m2] = [push("message", "ch", "m1"), push("message", "ch", "m2")];
      // m0 is handled straight off this read and the start of m1 is kept in the
      // read buffer, so everything from here on goes through the buffer path.
      connection1.write(push("message", "ch", "m0") + m1.slice(0, 10));
      await firstDelivered.promise;
      // One read completes m1 and carries m2. The listener closes connection 1
      // on m1 and dials connection 2; m2 belongs to neither (taken as the next
      // reply, it would be read as connection 2's HELLO answer and fail it).
      connection1.write(m1.slice(10) + m2);
      expect({
        reconnect: await reconnect.promise,
        delivered,
        connected: client.connected,
        connections: fake.connections,
      }).toEqual({ reconnect: "connected", delivered: ["m0", "m1"], connected: true, connections: 2 });
    } finally {
      client.close();
      fake.server.close();
    }
  });

  test("a connect() issued from onclose after a failed TLS handshake gets to dial again", async () => {
    let handshakes = 0;
    const server = net.createServer(socket => {
      // The first bytes are the ClientHello; dropping the connection there
      // fails the client's handshake.
      socket.once("data", () => {
        handshakes += 1;
        socket.destroy();
      });
      socket.on("error", () => {});
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    const client = new RedisClient(`rediss://127.0.0.1:${port}`, { autoReconnect: false });
    try {
      const secondConnect = connectFromOnclose(client);
      await expect(client.connect()).rejects.toMatchObject({ code: "ERR_REDIS_CONNECTION_CLOSED" });
      expect({ secondConnect: await secondConnect, handshakes }).toEqual({
        secondConnect: "rejected: Connection closed",
        handshakes: 2,
      });
    } finally {
      client.close();
      server.close();
    }
  });
  test("the process exits once auto-reconnect gives up", async () => {
    const fake = helloServer();
    const port = await fake.listen();
    await new Promise(resolve => fake.server.close(resolve));
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const client = new Bun.RedisClient("redis://127.0.0.1:${port}", { autoReconnect: true, maxRetries: 1 });
        client.onclose = err => console.log("onclose", err.code);
        await client.connect().catch(err => console.log("connect rejected", err.code));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "onclose ERR_REDIS_CONNECTION_CLOSED\nconnect rejected ERR_REDIS_CONNECTION_CLOSED\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The close for a dial that failed before a socket existed runs from the
  // event loop; until then the client must look like it is dialling, so that
  // whatever JS runs first neither dials on top of it nor is ignored.
  test.skipIf(isWindows)(
    "a close() issued right after a dial failed outright is honoured by the deferred close",
    async () => {
      using dir = tempDir("valkey-unix", {});
      const socketPath = path.join(String(dir), "r.sock");
      const first = helloServer();
      const second = helloServer();
      await first.listenUnix(socketPath);
      const client = new RedisClient(`redis+unix://${socketPath}`);
      try {
        await client.connect();
        client.close();
        await first.close();
        let closes = 0;
        client.onclose = () => closes++;
        const outcome = client.connect().then(
          () => "connected",
          (err: Error & { code: string }) => err.code,
        );
        client.close();
        await second.listenUnix(socketPath);
        expect({ outcome: await outcome, closes, connected: client.connected, redialled: second.connections }).toEqual({
          outcome: "ERR_REDIS_CONNECTION_CLOSED",
          closes: 1,
          connected: false,
          redialled: 0,
        });
      } finally {
        client.close();
        await first.close();
        await second.close();
      }
    },
  );

  test.skipIf(isWindows)(
    "a connect() that runs in the same tick as a retry that failed outright does not dial on top of it",
    async () => {
      using dir = tempDir("valkey-unix", {});
      const socketPath = path.join(String(dir), "r.sock");
      // Connection 1 is dropped by the server instead of answering PING.
      const first = helloServer({
        PING: (_connection, socket) => {
          socket.end();
          return null;
        },
      });
      // The listener that comes back holds its HELLO reply, so a second dial on
      // top of the first one would show up as a second connection here.
      const second = helloServer({ HELLO: () => null });
      await first.listenUnix(socketPath);
      const client = new RedisClient(`redis+unix://${socketPath}`);
      // Settled by the connect() made in the window; the handler is attached
      // right away so that a failure elsewhere is not reported as its rejection.
      const fromTimer = Promise.withResolvers<string>();
      try {
        await client.connect();
        // Stops accepting at once while connection 1 stays up, so the retry
        // scheduled when it drops fails outright.
        void first.close();
        const ping = await client.ping().then(
          () => "answered",
          (err: Error & { code: string }) => err.code,
        );
        expect(ping).toBe("ERR_REDIS_CONNECTION_CLOSED");
        // The close that rejected the PING also armed the retry, 50ms out, and
        // this continuation runs in its microtask checkpoint, before the loop
        // turns again. Blocking past the retry and the timer armed here makes
        // the loop fire both in one pass, in due order: the retry fails
        // outright, then the callback runs in the window before the deferred
        // close, brings the listener back and calls connect().
        setTimeout(() => {
          void second.listenUnix(socketPath);
          fromTimer.resolve(
            client.connect().then(
              () => "connected",
              (err: Error & { code: string }) => err.code,
            ),
          );
        }, 150);
        Bun.sleepSync(250);
        // The deferred close schedules the next retry, which is what connects.
        while (second.connections === 0) await Bun.sleep(1);
        // Had the callback's connect() dialled on top, the deferred close would
        // still have scheduled its retry, so a second connection would follow
        // within one retry delay (at most 100ms at this point); this is the
        // bound on asserting that it never comes.
        await Bun.sleep(250);
        expect(second.connections).toBe(1);
        second.sockets[0].write("+OK\r\n");
        expect({
          fromTimer: await fromTimer.promise,
          connected: client.connected,
          connections: second.connections,
        }).toEqual({ fromTimer: "connected", connected: true, connections: 1 });
      } finally {
        client.close();
        await first.close();
        await second.close();
      }
    },
  );

  test.skipIf(isWindows)("a reconnect whose dial fails outright is retried like a refused one", async () => {
    using dir = tempDir("valkey-unix", {});
    const socketPath = path.join(String(dir), "r.sock");
    const first = helloServer();
    const second = helloServer();
    await first.listenUnix(socketPath);
    const client = new RedisClient(`redis+unix://${socketPath}`);
    try {
      await client.connect();
      client.close();
      await first.close();
      // connect(2) on a path nobody listens on fails before a socket exists.
      const reconnected = client.connect();
      await second.listenUnix(socketPath);
      await reconnected;
      expect(await client.ping()).toBe("PONG");
      expect({ first: first.connections, second: second.connections }).toEqual({ first: 1, second: 1 });
    } finally {
      client.close();
      await first.close();
      await second.close();
    }
  });

  test.skipIf(isWindows)(
    "a reconnect whose dial fails outright rejects connect() when auto-reconnect is off",
    async () => {
      using dir = tempDir("valkey-unix", {});
      const socketPath = path.join(String(dir), "r.sock");
      const fake = helloServer();
      await fake.listenUnix(socketPath);
      const client = new RedisClient(`redis+unix://${socketPath}`, { autoReconnect: false });
      try {
        await client.connect();
        client.close();
        await fake.close();
        let closes = 0;
        client.onclose = () => closes++;
        const attempt = client.connect();
        // Reported from the event loop like a refused connection, not from
        // inside connect(), so an onclose that calls connect() cannot recurse.
        expect(closes).toBe(0);
        const outcome = await attempt.then(
          () => "connected",
          (err: Error & { code: string }) => `rejected: ${err.code}`,
        );
        expect({ outcome, closes }).toEqual({ outcome: "rejected: ERR_REDIS_CONNECTION_CLOSED", closes: 1 });
        await expect(client.ping()).rejects.toMatchObject({ code: "ERR_REDIS_CONNECTION_CLOSED" });
      } finally {
        client.close();
        await fake.close();
      }
    },
  );

  // A fresh client's first dial can fail the same way, whether connect() or the
  // first command makes it; it goes through the same close as a refused dial.
  const firstDialFrom: [string, (client: RedisClient) => Promise<unknown>][] = [
    ["connect()", client => client.connect()],
    ["a command", client => client.ping()],
  ];

  test.skipIf(isWindows).each(firstDialFrom)(
    "a first dial that fails outright, made by %s, rejects and runs onclose once when auto-reconnect is off",
    async (_entry, dial) => {
      using dir = tempDir("valkey-unix", {});
      const socketPath = path.join(String(dir), "r.sock");
      const fake = helloServer();
      const client = new RedisClient(`redis+unix://${socketPath}`, { autoReconnect: false });
      try {
        let closes = 0;
        client.onclose = () => closes++;
        const attempt = dial(client).then(
          () => "resolved",
          (err: Error & { code: string }) => `rejected: ${err.code}`,
        );
        expect(closes).toBe(0);
        expect({ outcome: await attempt, closes, connected: client.connected }).toEqual({
          outcome: "rejected: ERR_REDIS_CONNECTION_CLOSED",
          closes: 1,
          connected: false,
        });
        // The failed attempt is settled and forgotten: a connect() once a
        // listener is there dials rather than handing the same promise back.
        await fake.listenUnix(socketPath);
        await client.connect();
        expect({ ping: await client.ping(), connections: fake.connections }).toEqual({ ping: "PONG", connections: 1 });
      } finally {
        client.close();
        await fake.close();
      }
    },
  );

  test.skipIf(isWindows).each(firstDialFrom)(
    "a first dial that fails outright, made by %s, is retried until a listener is there",
    async (_entry, dial) => {
      using dir = tempDir("valkey-unix", {});
      const socketPath = path.join(String(dir), "r.sock");
      const fake = helloServer();
      const client = new RedisClient(`redis+unix://${socketPath}`);
      try {
        let closes = 0;
        client.onclose = () => closes++;
        const attempt = dial(client);
        // Listening well before the first retry is due; a later retry would
        // connect just the same, the retries are not terminal either way.
        await fake.listenUnix(socketPath);
        await attempt;
        expect({ ping: await client.ping(), closes, connections: fake.connections }).toEqual({
          ping: "PONG",
          closes: 0,
          connections: 1,
        });
      } finally {
        client.close();
        await fake.close();
      }
    },
  );

  test("a connect() issued from onclose after the TLS context cannot be built dials again from the event loop", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Neither key nor cert parses, so no attempt ever gets as far as a socket.
        const client = new Bun.RedisClient("rediss://127.0.0.1:1", {
          tls: { key: "not a key", cert: "not a cert" },
          autoReconnect: false,
        });
        const attempts = [];
        const done = Promise.withResolvers();
        let closes = 0, depth = 0, nested = false;
        client.onclose = () => {
          closes += 1;
          nested ||= depth > 0;
          depth += 1;
          if (closes < 3) attempts.push(client.connect());
          else done.resolve();
          depth -= 1;
        };
        attempts.push(client.connect());
        const closesInsideConnect = closes;
        await done.promise;
        const outcomes = await Promise.all(attempts.map(p => p.then(() => "connected", err => err.code)));
        console.log(JSON.stringify({ closesInsideConnect, nested, closes, outcomes, connected: client.connected }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({
        closesInsideConnect: 0,
        nested: false,
        closes: 3,
        outcomes: ["ERR_REDIS_CONNECTION_CLOSED", "ERR_REDIS_CONNECTION_CLOSED", "ERR_REDIS_CONNECTION_CLOSED"],
        connected: false,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test("close() discards a half-received reply instead of letting it keep the process alive", async () => {
    // Announces a 4 byte bulk string and stops halfway through it.
    const fake = helloServer({ PING: () => "$4\r\nPO" });
    const port = await fake.listen();
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const client = new Bun.RedisClient("redis://127.0.0.1:${port}", { autoReconnect: false });
          await client.connect();
          const ping = client.ping().catch(err => console.log("ping rejected", err.code));
          while (client.bufferedAmount === 0) await Bun.sleep(1);
          console.log("buffered before close", client.bufferedAmount);
          client.close();
          await ping;
          console.log("buffered after close", client.bufferedAmount);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "buffered before close 6\nping rejected ERR_REDIS_CONNECTION_CLOSED\nbuffered after close 0\n",
        stderr: "",
        exitCode: 0,
      });
    } finally {
      fake.server.close();
    }
  });

  // Polls `condition` until it holds or `timeoutMs` passes; reports whether it held.
  async function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) await Bun.sleep(1);
    return condition();
  }

  // Answers HELLO on connection 1 and drops it on PING, so the client is left
  // between retries with the reconnect timer armed and no socket. Later
  // connections hold their HELLO reply until `release` is called for them.
  function droppingServer() {
    const held = new Map<number, net.Socket>();
    const fake = helloServer({
      PING: (connection, socket) => {
        if (connection !== 1) return "+PONG\r\n";
        socket.end();
        return null;
      },
      HELLO: (connection, socket) => {
        if (connection === 1) return "+OK\r\n";
        held.set(connection, socket);
        return null;
      },
    });
    return {
      ...fake,
      get connections() {
        return fake.connections;
      },
      release: (connection: number) => held.get(connection)!.write("+OK\r\n"),
    };
  }

  // Connects `client`, has the server drop the connection, and returns once the
  // client has scheduled its first retry (50ms out).
  async function dropAndAwaitRetryDelay(client: RedisClient) {
    await client.connect();
    const ping = await client.ping().then(
      () => "answered",
      (err: Error & { code: string }) => err.code,
    );
    expect(ping).toBe("ERR_REDIS_CONNECTION_CLOSED");
    expect(client.connected).toBe(false);
  }

  test("close() during the retry delay cancels the retry and fires onclose once", async () => {
    const fake = droppingServer();
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`);
    const closes: string[] = [];
    client.onclose = err => closes.push(`${err.code}: ${err.message}`);
    try {
      await dropAndAwaitRetryDelay(client);
      // Queued for the retry; only close() is left to settle it.
      const queued = client.get("k").then(
        () => "answered",
        (err: Error & { code: string }) => err.code,
      );
      client.close();
      expect({ queued: await queued, closes }).toEqual({
        queued: "ERR_REDIS_CONNECTION_CLOSED",
        closes: ["ERR_REDIS_CONNECTION_CLOSED: Connection closed"],
      });
      // The retry was due 50ms after the drop; a second connection within a
      // few multiples of that would be the cancelled timer dialling anyway.
      await until(() => fake.connections >= 2, 300);
      expect({ connections: fake.connections, closes: closes.length, connected: client.connected }).toEqual({
        connections: 1,
        closes: 1,
        connected: false,
      });
    } finally {
      client.close();
      for (const socket of fake.sockets) socket.destroy();
      await fake.close();
    }
  });

  test("close() after the retries are exhausted does not report a second close", async () => {
    const fake = helloServer();
    const port = await fake.listen();
    await fake.close();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { maxRetries: 1 });
    let closes = 0;
    client.onclose = () => closes++;
    try {
      await expect(client.connect()).rejects.toMatchObject({ code: "ERR_REDIS_CONNECTION_CLOSED" });
      expect(closes).toBe(1);
      client.close();
      await until(() => closes >= 2, 100);
      expect(closes).toBe(1);
    } finally {
      client.close();
    }
  });

  test("the process exits once close() cancels a pending retry", async () => {
    const fake = droppingServer();
    const port = await fake.listen();
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const client = new Bun.RedisClient("redis://127.0.0.1:${port}");
          let connects = 0;
          client.onconnect = () => console.log("onconnect", ++connects);
          client.onclose = err => console.log("onclose", err.code);
          await client.connect();
          await client.ping().catch(err => console.log("ping rejected", err.code));
          while (client.connected) await Bun.sleep(1);
          client.close();
          console.log("closed");
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: [
          "onconnect 1",
          "ping rejected ERR_REDIS_CONNECTION_CLOSED",
          "onclose ERR_REDIS_CONNECTION_CLOSED",
          "closed",
          "",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      });
      expect(fake.connections).toBe(1);
    } finally {
      await fake.close();
    }
  });

  test("connect() during the retry delay dials once and the retry timer does not dial on top of it", async () => {
    const fake = droppingServer();
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`);
    let closes = 0;
    client.onclose = () => closes++;
    try {
      await dropAndAwaitRetryDelay(client);
      const reconnected = client.connect().then(
        () => "connected",
        (err: Error & { code: string }) => err.code,
      );
      expect(await until(() => fake.connections === 2, 1000)).toBe(true);
      // Connection 2 holds its HELLO reply past the 50ms the retry was due
      // in; a third connection would be that retry dialling on top of it.
      await until(() => fake.connections >= 3, 300);
      expect(fake.connections).toBe(2);
      fake.release(2);
      expect({ reconnected: await reconnected, connected: client.connected, closes }).toEqual({
        reconnected: "connected",
        connected: true,
        closes: 0,
      });
      expect(await client.ping()).toBe("PONG");
    } finally {
      client.close();
      for (const socket of fake.sockets) socket.destroy();
      await fake.close();
    }
  });

  test("connect() during the retry delay starts the retry budget over", async () => {
    // Connection 1 is dropped on PING; every later connection is dropped as
    // soon as it sends HELLO, so each dial ends in another retry.
    const fake = helloServer({
      PING: (_connection, socket) => {
        socket.end();
        return null;
      },
      HELLO: (connection, socket) => {
        if (connection === 1) return "+OK\r\n";
        socket.destroy();
        return null;
      },
    });
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { maxRetries: 2 });
    let closes = 0;
    client.onclose = () => closes++;
    try {
      // Attempt 1 of 2 is pending here. Waiting for it would leave one more
      // attempt; connect() dials now instead and counts from zero again, so
      // three more connections are dropped before the client gives up.
      await dropAndAwaitRetryDelay(client);
      const outcome = await client.connect().then(
        () => "connected",
        (err: Error & { code: string }) => err.code,
      );
      expect({ outcome, connections: fake.connections, closes, connected: client.connected }).toEqual({
        outcome: "ERR_REDIS_CONNECTION_CLOSED",
        connections: 4,
        closes: 1,
        connected: false,
      });
    } finally {
      client.close();
      for (const socket of fake.sockets) socket.destroy();
      await fake.close();
    }
  });

  test("close() during a reconnect attempt reports the close exactly once", async () => {
    const fake = droppingServer();
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`);
    let closes = 0;
    client.onclose = () => closes++;
    try {
      await dropAndAwaitRetryDelay(client);
      // The explicit dial is left connecting on a held HELLO reply.
      const reconnected = client.connect().then(
        () => "connected",
        (err: Error & { code: string }) => err.code,
      );
      expect(await until(() => fake.connections === 2, 1000)).toBe(true);
      client.close();
      expect(await reconnected).toBe("ERR_REDIS_CONNECTION_CLOSED");
      await until(() => closes >= 2, 300);
      expect({ closes, connections: fake.connections, connected: client.connected }).toEqual({
        closes: 1,
        connections: 2,
        connected: false,
      });
    } finally {
      client.close();
      for (const socket of fake.sockets) socket.destroy();
      await fake.close();
    }
  });

  test.skipIf(isWindows)(
    "the connect timer of an attempt ended by close() does not fire into the next attempt",
    async () => {
      using dir = tempDir("valkey-unix", {});
      const socketPath = path.join(String(dir), "r.sock");
      // Holds every HELLO reply, so the first dial stays connecting until close().
      const first = helloServer({ HELLO: () => null });
      const second = helloServer();
      await first.listenUnix(socketPath);
      const connectionTimeout = 1000;
      const client = new RedisClient(`redis+unix://${socketPath}`, { connectionTimeout });
      let closes = 0;
      client.onclose = () => closes++;
      // Settled by the connect() made from the socket callback below.
      const fromCallback = Promise.withResolvers<{
        outcome: Promise<string>;
        ping: Promise<string>;
        beforeStaleDeadline: boolean;
      }>();
      // A dial made from a socket callback runs before the timers of that
      // loop iteration are checked, and blocking there makes them due.
      using control = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(_socket, chunk) {
            const staleDeadline = Number(chunk.toString());
            fromCallback.resolve({
              beforeStaleDeadline: performance.now() < staleDeadline,
              outcome: client.connect().then(
                () => "connected",
                (err: Error & { code: string }) => `rejected: ${err.code}`,
              ),
              ping: client.ping().then(
                () => "PONG",
                (err: Error) => `rejected: ${err.message}`,
              ),
            });
            Bun.sleepSync(Math.max(0, staleDeadline + 100 - performance.now()));
          },
          open() {},
          close() {},
          error() {},
        },
      });
      const sender = await Bun.connect({
        hostname: "127.0.0.1",
        port: control.port,
        socket: { data() {}, open() {}, close() {}, error() {} },
      });
      try {
        // connect() arms the connect timer before it returns, so the real
        // deadline is at or shortly after the one computed from here: a dial
        // before this one is before the real one too, and the callback sleeps
        // 100ms past it to be past the real one as well.
        const armedAt = performance.now();
        const attempt = client.connect().then(
          () => "connected",
          (err: Error & { code: string }) => `rejected: ${err.code}`,
        );
        const staleDeadline = armedAt + connectionTimeout;
        expect(await until(() => first.connections === 1, 1000)).toBe(true);
        client.close();
        expect({ attempt: await attempt, closes }).toEqual({
          attempt: "rejected: ERR_REDIS_CONNECTION_CLOSED",
          closes: 1,
        });
        // With the path gone the next dial fails outright, so it arms no
        // connect timer of its own; the hold it leaves is settled from the
        // event loop, after the timers of the iteration are checked. Blocking
        // in the callback past the stale deadline makes that timer due first.
        await first.close();
        sender.write(String(staleDeadline));
        const { outcome, ping, beforeStaleDeadline } = await fromCallback.promise;
        // Had the timer been left armed, it was still pending when the
        // callback dialled; otherwise the test proved nothing.
        expect(beforeStaleDeadline).toBe(true);
        // The hold's close schedules a retry, which is what connects.
        await second.listenUnix(socketPath);
        expect(await until(() => second.connections >= 1, 3000)).toBe(true);
        expect({ outcome: await outcome, ping: await ping, closes }).toEqual({
          outcome: "connected",
          ping: "PONG",
          closes: 1,
        });
      } finally {
        client.close();
        sender.end();
        for (const socket of first.sockets) socket.destroy();
        await first.close();
        await second.close();
      }
    },
  );

  test("subscribe() on a failed client rejects and registers no handler", async () => {
    const fake = helloServer();
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, {
      connectionTimeout: 0,
      idleTimeout: 50,
      autoReconnect: false,
    });
    try {
      const closed = Promise.withResolvers<Error>();
      client.onclose = err => closed.resolve(err);
      await client.connect();
      await closed.promise;
      const delivered: string[] = [];
      const firstDelivered = Promise.withResolvers<void>();
      const listener = (message: string) => {
        delivered.push(message);
        firstDelivered.resolve();
      };
      await expect(client.subscribe("ch", listener)).rejects.toMatchObject({
        code: "ERR_REDIS_CONNECTION_CLOSED",
        message: "Connection has failed",
      });
      // The rejected subscribe left the client out of subscriber mode.
      expect(() => client.unsubscribe("ch")).toThrow("can only be called while in subscriber mode");

      // A subscribe on the next connection is the only registration: the
      // message arrives once, not once per attempt.
      client.onclose = () => {};
      await client.connect();
      const connection2 = fake.sockets[1];
      connection2.on("data", chunk => {
        if (chunk.toString("latin1").includes("SUBSCRIBE")) {
          connection2.write(push("subscribe", "ch", 1) + push("message", "ch", "m0"));
        }
      });
      await client.subscribe("ch", listener);
      await firstDelivered.promise;
      // PONG comes back after anything else the stub wrote, so a second
      // delivery of m0 would be in `delivered` by now.
      await client.ping();
      expect({ delivered, connections: fake.connections }).toEqual({ delivered: ["m0"], connections: 2 });
    } finally {
      client.close();
      fake.server.close();
    }
  });

  test("subscribe() on a fresh client with the offline queue off dials, rejects and registers no handler", async () => {
    const fake = helloServer();
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { enableOfflineQueue: false });
    try {
      const connected = Promise.withResolvers<void>();
      client.onconnect = () => connected.resolve();
      const delivered: string[] = [];
      const firstDelivered = Promise.withResolvers<void>();
      const listener = (message: string) => {
        delivered.push(message);
        firstDelivered.resolve();
      };
      // The rejection is the one get() gets on this client: the dial has been
      // started, and the SUBSCRIBE cannot wait for it.
      await expect(client.subscribe("ch", listener)).rejects.toMatchObject({
        code: "ERR_REDIS_CONNECTION_CLOSED",
        message: "Connection is closed and offline queue is disabled",
      });
      expect(() => client.unsubscribe("ch")).toThrow("can only be called while in subscriber mode");

      // That dial completes on its own.
      await connected.promise;
      const connection = fake.sockets[0];
      connection.on("data", chunk => {
        if (chunk.toString("latin1").includes("SUBSCRIBE")) {
          connection.write(push("subscribe", "ch", 1) + push("message", "ch", "m0"));
        }
      });
      await client.subscribe("ch", listener);
      await firstDelivered.promise;
      await client.ping();
      expect({ delivered, connections: fake.connections }).toEqual({ delivered: ["m0"], connections: 1 });
    } finally {
      client.close();
      fake.server.close();
    }
  });

  test("subscribe() with a channel of the wrong type throws before the fresh client dials", async () => {
    const fake = helloServer();
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`);
    const probe = new RedisClient(`redis://127.0.0.1:${port}`);
    try {
      expect(() => client.subscribe(123 as never, () => {})).toThrow(
        "Expected channel to be a string or array for 'subscribe'.",
      );
      // A dial made by the call above is ahead of the probe's in the stub's
      // accept queue, so it has been counted by the time the probe is answered.
      await probe.connect();
      expect(fake.connections).toBe(1);
    } finally {
      client.close();
      probe.close();
      fake.server.close();
    }
  });

  test("the process exits after subscribe() is rejected by a failed client", async () => {
    const fake = helloServer();
    const port = await fake.listen();
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const client = new Bun.RedisClient("redis://127.0.0.1:${port}", { connectionTimeout: 0, idleTimeout: 50, autoReconnect: false });
          const closed = Promise.withResolvers();
          client.onclose = err => closed.resolve(err);
          await client.connect();
          await closed.promise;
          console.log("onclose");
          await client.subscribe("ch", () => {}).catch(err => console.log("subscribe rejected", err.code));
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await exitOutcome(proc)).toEqual({
        stdout: "onclose\nsubscribe rejected ERR_REDIS_CONNECTION_CLOSED\n",
        stderr: "",
        exitCode: 0,
      });
    } finally {
      fake.server.close();
    }
  });

  // subscribe() before connect() with the default offline queue stores the
  // listener and queues the SUBSCRIBE; when the dial then fails for good the
  // queued SUBSCRIBE is rejected but the listener stays, so the process is
  // held alive. #33290 registers the listener on the server's subscribe
  // confirmation instead, which closes this route; a -ERR reply to SUBSCRIBE
  // (an ACL NOPERM, say) leaves the same orphan and is closed the same way.
  test.todo("the process exits after a queued subscribe() is rejected by a dial that fails for good", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const client = new Bun.RedisClient("redis://127.0.0.1:1", { maxRetries: 0, autoReconnect: false });
        await client.subscribe("ch", () => {}).catch(err => console.log("subscribe rejected", err.code));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await exitOutcome(proc)).toEqual({
      stdout: "subscribe rejected ERR_REDIS_CONNECTION_CLOSED\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // A TLS stub run under Node in its own process, so it can read while this
  // loop is blocked, and so that what it reports about the peer's close does
  // not come from the socket code under test. It pauses connection 1 after
  // HELLO, resumes when the resume file appears, and writes the drained file
  // once its byte count has reached the number written into the resume file
  // (minus what one spilled batch can hold) and stopped growing. When the
  // peer ends the connection it probes the socket with one write: after a
  // FIN the kernel takes the byte, after an RST it refuses it. Told the peer
  // already closed, it also probes once it has drained without an end.
  const TLS_STUB = /* js */ `
    const tls = require("tls");
    const { existsSync, readFileSync, writeFileSync } = require("fs");
    const [resumeFile, drainedFile] = process.argv.slice(2);
    let connections = 0;
    const server = tls.createServer(
      { key: readFileSync("key.pem"), cert: readFileSync("cert.pem"), allowHalfOpen: true },
      socket => {
        const connection = ++connections;
        const seen = [];
        let reported = false;
        function report(probe) {
          if (reported) return;
          reported = true;
          console.log("saw", seen.join(", "), "|", probe, "|", socket.bytesRead);
        }
        socket.on("data", chunk => {
          const text = chunk.toString("latin1");
          if (text.includes("HELLO")) {
            socket.write("+OK\\r\\n");
            if (connection === 1) {
              socket.pause();
              const poll = setInterval(() => {
                if (!existsSync(resumeFile)) return;
                clearInterval(poll);
                socket.resume();
                const [handed, peerClosed] = readFileSync(resumeFile, "utf8").split(" ").map(Number);
                const expected = handed - ${STUCK_VALUE_BYTES};
                let last = -1;
                const settle = setInterval(() => {
                  const now = socket.bytesRead;
                  if (now >= expected && now === last) {
                    clearInterval(settle);
                    writeFileSync(drainedFile, String(now));
                    // The peer closed before we read again and no end came
                    // with the data: a reset the kernel discarded (its window
                    // was shut) leaves no trace, so probe, and if the kernel
                    // takes the byte wait for the reply it draws.
                    if (peerClosed && !seen.includes("end")) probeWrite(true);
                  }
                  last = now;
                }, 100);
              }, 10);
            }
          }
          if (text.includes("PING")) socket.write("+PONG\\r\\n");
        });
        if (connection !== 1) return;
        socket.on("error", err => {
          seen.push("error " + err.code);
          report("errored");
        });
        socket.on("close", () => report("closed"));
        socket.on("end", () => {
          seen.push("end");
          probeWrite(false);
        });
        function probeWrite(waitForReply) {
          socket.write("x", err => {
            if (err) report("write " + err.code);
            else if (!waitForReply) report("write ok");
          });
        }
      },
    );
    server.listen(0, "127.0.0.1", () => console.log("port", server.address().port));
  `;

  async function spawnTlsStub() {
    const dir = tempDir("valkey-tls-stub", { "key.pem": tlsCert.key, "cert.pem": tlsCert.cert, "stub.js": TLS_STUB });
    const resumeFile = path.join(String(dir), "resume");
    const drainedFile = path.join(String(dir), "drained");
    const proc = Bun.spawn({
      cmd: [nodeExe()!, "stub.js", resumeFile, drainedFile],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    let output = "";
    const gotPort = Promise.withResolvers<number>();
    const gotResult = Promise.withResolvers<{ seen: string; probe: string; bytesRead: number }>();
    (async () => {
      for await (const chunk of proc.stdout) {
        output += Buffer.from(chunk).toString();
        const port = /^port (\d+)$/m.exec(output);
        if (port) gotPort.resolve(Number(port[1]));
        const result = /^saw (.*) \| (.*) \| (\d+)$/m.exec(output);
        if (result) gotResult.resolve({ seen: result[1], probe: result[2], bytesRead: Number(result[3]) });
      }
      // Neither line is coming any more: fail a waiter now rather than at the test timeout.
      const gone = new Error(`tls stub exited with ${await proc.exited}, output: ${JSON.stringify(output)}`);
      gotPort.reject(gone);
      gotResult.reject(gone);
    })();
    // The dispose below also ends the stub when the test failed before it
    // awaited the result, and that rejection must not count as unhandled.
    gotResult.promise.catch(() => {});
    const stop = async () => {
      proc.kill();
      await proc.exited;
      dir[Symbol.dispose]();
    };
    let port: number;
    try {
      port = await gotPort.promise;
    } catch (err) {
      await stop();
      throw err;
    }
    return {
      port,
      result: gotResult.promise,
      // Lets connection 1 read again; blocks until the stub has read `handed`
      // bytes, less one spilled batch, and its count has stopped growing.
      resumeAndDrain(handed: number, peerClosed: boolean): number {
        writeFileSync(resumeFile, `${handed} ${peerClosed ? 1 : 0}`);
        const deadline = Date.now() + 10_000;
        while (!existsSync(drainedFile)) {
          if (Date.now() > deadline) throw new Error("stub never drained");
          Bun.sleepSync(10);
        }
        return Number(readFileSync(drainedFile, "utf8"));
      },
      [Symbol.asyncDispose]: stop,
    };
  }

  test("close() over redis:// while the peer has stopped reading closes the socket at once", async () => {
    // Same stuck flush as the fail() test above, ended by close() instead of
    // a protocol error. Plain TCP never defers a close, so this pins that the
    // close stays graceful: the queued bytes drain and the peer sees a FIN,
    // not an RST.
    const fake = helloServer({
      HELLO: (connection, socket) => {
        if (connection === 1) socket.pause();
        return "+OK\r\n";
      },
      PING: () => "+PONG\r\n",
    });
    const port = await fake.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { autoReconnect: false });
    try {
      let closes = 0;
      client.onclose = () => closes++;
      await client.connect();
      const pending = await writeUntilStuck(client);
      client.close();
      expect({ connected: client.connected, closes }).toEqual({ connected: false, closes: 1 });
      expect(new Set(await Promise.all(pending))).toEqual(new Set(["ERR_REDIS_CONNECTION_CLOSED"]));
      const stuck = fake.sockets[0];
      const ending = endOrError(stuck);
      stuck.resume();
      expect(await ending).toBe("end");
      await client.connect();
      expect(await client.ping()).toBe("PONG");
      expect(fake.connections).toBe(2);
    } finally {
      client.close();
      fake.sockets[0]?.destroy();
      fake.server.close();
    }
  });

  test.skipIf(!nodeExe())(
    "close() over rediss:// while the peer has stopped reading closes the socket at once",
    async () => {
      // The fast shutdown close() asks for is deferred behind the undelivered
      // ciphertext, and a peer that never reads would leave it there; close()
      // finishes it with a reset. The stub, once it reads again, must find the
      // connection reset.
      await using stub = await spawnTlsStub();
      const client = new RedisClient(`rediss://127.0.0.1:${stub.port}`, {
        autoReconnect: false,
        tls: { ca: tlsCert.cert },
      });
      try {
        let closes = 0;
        client.onclose = () => closes++;
        await client.connect();
        const pending = await writeUntilStuck(client);
        client.close();
        expect({ connected: client.connected, closes }).toEqual({ connected: false, closes: 1 });
        expect(new Set(await Promise.all(pending))).toEqual(new Set(["ERR_REDIS_CONNECTION_CLOSED"]));
        stub.resumeAndDrain(0, true);
        const { seen, probe } = await stub.result;
        // No close_notify got out past the full kernel buffer, and the reset
        // reaches the stub as a read error or refuses its write.
        expect(seen).not.toContain("end");
        expect(`${seen} ${probe}`).toMatch(/E(PIPE|CONNRESET)/);
        await client.connect();
        expect(await client.ping()).toBe("PONG");
      } finally {
        client.close();
      }
    },
  );

  test.skipIf(!nodeExe())("close() over rediss:// after the peer drained the backlog still ends in a FIN", async () => {
    // The socket holds spilled ciphertext from a stall the peer has since
    // recovered from, but this loop has not turned since, so nothing has
    // flushed it yet. The fast shutdown drains it and is not deferred; the
    // peer must see the rest of the data and a clean end, and its write
    // probe must be taken, not refused by a reset.
    await using stub = await spawnTlsStub();
    const client = new RedisClient(`rediss://127.0.0.1:${stub.port}`, {
      autoReconnect: false,
      tls: { ca: tlsCert.cert },
    });
    try {
      let closes = 0;
      client.onclose = () => closes++;
      await client.connect();
      const pending = await writeUntilStuck(client);
      // Bytes handed to the socket so far: everything written less what the
      // client still holds as plaintext.
      const handed = pending.length * STUCK_COMMAND_BYTES - client.bufferedAmount;
      const drained = stub.resumeAndDrain(handed, false);
      client.close();
      expect({ connected: client.connected, closes }).toEqual({ connected: false, closes: 1 });
      expect(new Set(await Promise.all(pending))).toEqual(new Set(["ERR_REDIS_CONNECTION_CLOSED"]));
      const { seen, probe, bytesRead } = await stub.result;
      expect({ seen, probe }).toEqual({ seen: "end", probe: "write ok" });
      // The spilled ciphertext reached the peer before the FIN.
      expect(bytesRead).toBeGreaterThan(drained);
    } finally {
      client.close();
    }
  });
});

describe("Valkey: Offline Queue", () => {
  // Answers each complete command in the order it arrives: HELLO with `+OK`
  // and everything else with `+PONG`. With `answer: false` nothing is ever
  // answered, so the connection never becomes ready and everything the client
  // sends stays in its offline queue.
  function stubServer({ answer = true } = {}) {
    const sockets: net.Socket[] = [];
    const server = net.createServer(socket => {
      sockets.push(socket);
      const state = { buffer: Buffer.alloc(0) };
      socket.on("data", chunk => {
        if (!answer) return;
        state.buffer = Buffer.concat([state.buffer, chunk]);
        const replies = readCommands(state).map(args =>
          (args[0] ?? "").toUpperCase() === "HELLO" ? "+OK\r\n" : "+PONG\r\n",
        );
        if (replies.length > 0) socket.write(replies.join(""));
      });
      socket.on("error", () => {});
    });
    return {
      server,
      listen: async () => {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        return (server.address() as net.AddressInfo).port;
      },
      close: () => {
        for (const socket of sockets) socket.destroy();
        return new Promise(resolve => server.close(resolve));
      },
    };
  }

  test("estimated memory counts every queued command after the queue was drained and refilled", async () => {
    const stub = stubServer();
    const port = await stub.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { autoReconnect: false });
    try {
      await client.connect();
      // Six commands go through the queue and are answered. The queue is empty
      // again, but its read position has moved to slot 6 of the 8 it grew to,
      // so the next five commands wrap around to the start of its storage.
      await Promise.all(Array.from({ length: 6 }, () => client.ping()));
      const idleCost = estimateShallowMemoryUsageOf(client);

      // Five more commands are queued in one turn, before the pipeline
      // flushes them. Their serialized bytes must all show up in the estimate.
      const key = Buffer.alloc(1000, "k").toString();
      const pending = Promise.all(Array.from({ length: 5 }, () => client.get(key)));
      const queuedCost = estimateShallowMemoryUsageOf(client);

      expect(await pending).toEqual(Array(5).fill("PONG"));
      expect(queuedCost - idleCost).toBeGreaterThanOrEqual(5 * key.length);
    } finally {
      client.close();
      await stub.close();
    }
  });

  test("commands queued after the queue wrapped reach the server in one write", async () => {
    // The client runs in a child process with nothing else live and queues
    // the GETs from a setImmediate callback, so the flush runs at the end of
    // that tick and the loop then parks. A client that only flushes the part
    // of the queue before the wrap point writes two GETs there and the other
    // three on a later, unrelated wake. The stub records how many GETs the
    // first read carrying a GET held, and holds the GET replies until it has
    // all five so no reply can wake the child in between. It then answers all
    // five, so the child exits and the count is asserted however the GETs
    // arrived.
    let getsSeen = 0;
    let getsInFirstRead = 0;
    const server = Bun.listen<{ buffer: Buffer }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = { buffer: Buffer.alloc(0) };
        },
        error() {},
        close() {},
        data(socket, chunk) {
          const state = socket.data;
          state.buffer = Buffer.concat([state.buffer, chunk]);
          let replies = "";
          let gets = 0;
          for (const args of readCommands(state)) {
            const name = (args[0] ?? "").toUpperCase();
            if (name === "GET") {
              gets += 1;
            } else {
              replies += name === "HELLO" ? "+OK\r\n" : "+PONG\r\n";
            }
          }
          if (replies) socket.write(replies);
          if (gets > 0 && getsSeen === 0) getsInFirstRead = gets;
          const getsSeenBefore = getsSeen;
          getsSeen += gets;
          if (getsSeenBefore < 5 && getsSeen >= 5) socket.write("$1\r\nv\r\n".repeat(getsSeen));
        },
      },
    });
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const client = new Bun.RedisClient("redis://127.0.0.1:${server.port}", { autoReconnect: false });
          await client.connect();
          await Promise.all(Array.from({ length: 6 }, () => client.ping()));
          await new Promise(resolve => setImmediate(resolve));
          const values = await Promise.all(Array.from({ length: 5 }, () => client.get("k")));
          console.log(values.length, "replies");
          client.close();
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ getsInFirstRead, stdout, stderr, exitCode }).toEqual({
        getsInFirstRead: 5,
        stdout: "5 replies\n",
        stderr: "",
        exitCode: 0,
      });
    } finally {
      server.stop(true);
    }
  });

  test("close() rejects every command queued while the connection never became ready", async () => {
    const stub = stubServer({ answer: false });
    const port = await stub.listen();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { autoReconnect: false });
    try {
      const outcomes = Array.from({ length: 40 }, (_, i) =>
        client.get(`key-${i}`).then(
          () => "fulfilled",
          (err: Error & { code?: string }) => err.code,
        ),
      );
      client.close();
      expect(await Promise.all(outcomes)).toEqual(Array(40).fill("ERR_REDIS_CONNECTION_CLOSED"));
    } finally {
      client.close();
      await stub.close();
    }
  });
});
