import { RedisClient } from "bun";
import { describe, expect, mock, test } from "bun:test";
import net from "node:net";
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

// With autoReconnect enabled, commands that were written to the socket but
// never answered before it closed must be rejected. Before the fix they
// stayed at the head of the in-flight queue, so on the new connection every
// command resolved with some other command's reply and the last N never
// settled. Uses a scripted RESP server so it does not depend on a real
// Redis instance.
describe("Valkey: Connection Failures (mock server)", () => {
  function parseCommandFrame(buf: Buffer, offset: number): { argv: string[]; end: number } | null {
    if (buf[offset] !== 0x2a) return null;
    const i = buf.indexOf("\r\n", offset);
    if (i < 0) return null;
    const n = parseInt(buf.toString("latin1", offset + 1, i), 10);
    let p = i + 2;
    const argv: string[] = [];
    for (let k = 0; k < n; k++) {
      if (buf[p] !== 0x24) return null;
      const j = buf.indexOf("\r\n", p);
      if (j < 0) return null;
      const len = parseInt(buf.toString("latin1", p + 1, j), 10);
      if (buf.length < j + 2 + len + 2) return null;
      argv.push(buf.toString("latin1", j + 2, j + 2 + len));
      p = j + 2 + len + 2;
    }
    return { argv, end: p };
  }

  type Conn = { n: number; write: (s: string) => void; end: () => void };

  function startRespServer(
    onCommand: (argv: string[], conn: Conn) => string | null | undefined,
  ): Promise<{ port: number; close: () => void }> {
    const blk = (s: string) => `$${Buffer.byteLength(s, "latin1")}\r\n${s}\r\n`;
    let nConn = 0;
    return new Promise((resolve, reject) => {
      const server = net.createServer(sock => {
        sock.setNoDelay(true);
        const conn: Conn = {
          n: ++nConn,
          write: s => {
            try {
              sock.write(Buffer.from(s, "latin1"));
            } catch {}
          },
          end: () => sock.destroy(),
        };
        let buf = Buffer.alloc(0);
        sock.on("error", () => {});
        sock.on("data", (d: Buffer) => {
          buf = buf.length ? Buffer.concat([buf, d]) : d;
          for (;;) {
            const frame = parseCommandFrame(buf, 0);
            if (!frame) return;
            buf = buf.subarray(frame.end);
            const name = frame.argv[0].toUpperCase();
            let out = onCommand(frame.argv, conn);
            if (out === undefined) {
              if (name === "HELLO") {
                out =
                  "%7\r\n" +
                  [
                    [blk("server"), blk("redis")],
                    [blk("version"), blk("7.4.0")],
                    [blk("proto"), ":3\r\n"],
                    [blk("id"), ":1\r\n"],
                    [blk("mode"), blk("standalone")],
                    [blk("role"), blk("master")],
                    [blk("modules"), "*0\r\n"],
                  ]
                    .map(([k, v]) => k + v)
                    .join("");
              } else if (name === "PING") {
                out = "+PONG\r\n";
              } else if (["AUTH", "SELECT", "CLIENT", "RESET"].includes(name)) {
                out = "+OK\r\n";
              } else {
                out = `-ERR unscripted '${name}'\r\n`;
              }
            }
            if (out !== null) conn.write(out);
          }
        });
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() });
      });
    });
  }

  async function settle(p: Promise<unknown>): Promise<{ status: "fulfilled" | "rejected"; value: unknown }> {
    try {
      return { status: "fulfilled", value: await p };
    } catch (e) {
      return { status: "rejected", value: e };
    }
  }

  test("rejects in-flight commands when the connection drops and does not cross-match replies after auto-reconnect", async () => {
    const blk = (s: string) => `$${Buffer.byteLength(s, "latin1")}\r\n${s}\r\n`;

    const srv = await startRespServer((argv, conn) => {
      if (argv[0].toUpperCase() !== "GET") return undefined;
      const key = argv[1];
      if (conn.n === 1) {
        if (key === "a") return blk("val1:a");
        if (key === "b") return null; // swallow: stays in flight
        if (key === "c") {
          // swallow, then drop the connection once the write loop unwinds
          queueMicrotask(() => conn.end());
          return null;
        }
      }
      return blk(`val${conn.n}:${key}`);
    });

    const client = new RedisClient(`redis://127.0.0.1:${srv.port}`, {
      autoReconnect: true,
      maxRetries: 10,
      enableOfflineQueue: true,
      enableAutoPipelining: true,
    });
    try {
      let connects = 0;
      const { promise: reconnected, resolve: onReconnected } = Promise.withResolvers<void>();
      client.onconnect = () => {
        if (++connects === 2) onReconnected();
      };
      client.onclose = () => {};

      await client.connect();

      // a gets a reply on connection 1; b and c are written but swallowed
      // and remain in flight when the server drops the socket.
      const pA = settle(client.get("a"));
      const pB = settle(client.get("b"));
      const pC = settle(client.get("c"));

      await reconnected;

      // Two commands on the new connection, matching the two stale in-flight
      // entries. Before the fix the server's replies for d and e were
      // dequeued by the stale b and c pairs, so b and c still settle (with
      // the wrong values) and the assertion below fails.
      const pD = settle(client.get("d"));
      const pE = settle(client.get("e"));

      const [a, b, c] = await Promise.all([pA, pB, pC]);

      // a was answered before the drop.
      expect(a).toEqual({ status: "fulfilled", value: "val1:a" });

      // b and c were in flight when the connection dropped: rejected with a
      // connection error. Before the fix these resolved with "val2:d" /
      // "val2:e", so the test fails here.
      expect({
        b: { status: b.status, value: b.status === "fulfilled" ? b.value : (b.value as { code?: string })?.code },
        c: { status: c.status, value: c.status === "fulfilled" ? c.value : (c.value as { code?: string })?.code },
      }).toEqual({
        b: { status: "rejected", value: "ERR_REDIS_CONNECTION_CLOSED" },
        c: { status: "rejected", value: "ERR_REDIS_CONNECTION_CLOSED" },
      });

      // d and e each resolve with their own key's value from connection 2.
      // Before the fix these never settled because their replies were
      // consumed by the stale pairs above.
      const [d, e] = await Promise.all([pD, pE]);
      expect({ d, e }).toEqual({
        d: { status: "fulfilled", value: "val2:d" },
        e: { status: "fulfilled", value: "val2:e" },
      });
    } finally {
      client.close();
      srv.close();
    }
  });
});
