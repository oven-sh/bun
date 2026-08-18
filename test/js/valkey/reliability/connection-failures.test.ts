import { RedisClient } from "bun";
import { describe, expect, mock, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, isWindows, tempDir, tls as tlsCert } from "harness";
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
      // Use a non-routable IP address with a very short timeout
      const client = new RedisClient("redis://192.0.2.1:6379", {
        connectionTimeout: 2, // 2ms second timeout
        autoReconnect: false,
      });
      expect(async () => {
        await client.get("any-key");
      }).toThrowErrorMatchingInlineSnapshot(`"Connection timeout reached after 2ms"`);
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

describe("Valkey: Auto-Reconnect In-Flight Commands", () => {
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
    // The timer armed by connect() carries connectionTimeout; the accepted
    // HELLO re-arms it with idleTimeout and every chunk from the server re-arms
    // it again. What is pinned here is what happens when it fires on an idle
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
      const value = Buffer.alloc(256 * 1024, "x").toString();
      const pending: Promise<unknown>[] = [];
      // Each SET is flushed as soon as it is queued; once two flushes in a row
      // hand nothing at all to the socket, the kernel buffers on both ends are
      // full and the socket is stuck behind its undelivered ciphertext.
      let stuckFlushes = 0;
      while (stuckFlushes < 2 && pending.length < 256) {
        const before = client.bufferedAmount;
        pending.push(client.set("key", value).catch(() => {}));
        await new Promise(resolve => setImmediate(resolve));
        const added = client.bufferedAmount - before;
        stuckFlushes = added >= value.length ? stuckFlushes + 1 : 0;
      }
      expect(stuckFlushes).toBe(2);
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

  test("a message listener that closes and reconnects is not fed the pushes buffered behind its message", async () => {
    // RESP3 push frames as the server writes them for SUBSCRIBE and for messages.
    const push = (...items: (string | number)[]) =>
      `>${items.length}\r\n` +
      items.map(item => (typeof item === "number" ? `:${item}\r\n` : `$${item.length}\r\n${item}\r\n`)).join("");
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
});
