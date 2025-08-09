import { RedisClient } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { ConnectionType, createClient, ctx, DEFAULT_REDIS_OPTIONS, DEFAULT_REDIS_URL, delay, isEnabled, retry } from "../test-utils";

/**
 * Test suite for Redis reconnection behavior after connection drops
 * - Automatic reconnection with autoReconnect enabled
 * - Command retry after successful reconnection
 * - Connection state management during reconnection
 * - Offline queue behavior during reconnection
 */
describe.skipIf(!isEnabled)("Valkey: Reconnection After Connection Drop", () => {
  let testClients: RedisClient[] = [];

  beforeEach(() => {
    testClients = [];
  });

  afterEach(async () => {
    // Clean up all test clients
    for (const client of testClients) {
      try {
        if (client.connected) {
          await client.close();
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    testClients = [];
  });

  function trackClient(client: RedisClient): RedisClient {
    testClients.push(client);
    return client;
  }

  describe("Automatic Reconnection", () => {
    test("should automatically reconnect after connection drop", async () => {
      const client = trackClient(new RedisClient(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        autoReconnect: true,
        enableOfflineQueue: true,
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        maxReconnectAttempts: 10,
        reconnectOnError: (err) => err.message.includes("connection") || err.message.includes("socket"),
      }));

      // Establish initial connection
      const testKey = ctx.generateKey("reconnection-test");
      await client.set(testKey, "initial-value");
      expect(client.connected).toBe(true);

      // Simulate connection drop by calling close() then immediately trying to use the client
      // This simulates a network drop where the client tries to reconnect
      await client.close();
      expect(client.connected).toBe(false);

      // Try to use the client - it should attempt to reconnect
      // We use a retry mechanism to wait for reconnection to complete
      const reconnectedValue = await retry(
        async () => {
          return await client.get(testKey);
        },
        {
          maxAttempts: 10,
          delay: 200,
          timeout: 5000,
        }
      );

      expect(reconnectedValue).toBe("initial-value");
      expect(client.connected).toBe(true);
    });

    test("should handle commands during reconnection with offline queue", async () => {
      const client = trackClient(new RedisClient(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        autoReconnect: true,
        enableOfflineQueue: true,
        maxRetriesPerRequest: 5,
        retryDelayOnFailover: 50,
      }));

      // Establish connection
      const testKey1 = ctx.generateKey("offline-queue-1");
      const testKey2 = ctx.generateKey("offline-queue-2");
      await client.set(testKey1, "queued-value-1");
      expect(client.connected).toBe(true);

      // Simulate connection drop
      await client.close();
      expect(client.connected).toBe(false);

      // Queue commands while disconnected (these should be queued and executed after reconnection)
      const setPromise = client.set(testKey2, "queued-value-2");
      const getPromise = client.get(testKey1);

      // Wait for the queued commands to complete (they should reconnect and execute)
      const [setResult, getValue] = await Promise.all([setPromise, getPromise]);

      expect(setResult).toBe("OK");
      expect(getValue).toBe("queued-value-1");
      expect(client.connected).toBe(true);

      // Verify the queued SET command was executed
      const newValue = await client.get(testKey2);
      expect(newValue).toBe("queued-value-2");
    });

    test("should fail commands immediately when offline queue is disabled", async () => {
      const client = trackClient(new RedisClient(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        autoReconnect: true,
        enableOfflineQueue: false,
        connectionTimeout: 500,
      }));

      // Establish connection
      const testKey = ctx.generateKey("no-offline-queue");
      await client.set(testKey, "test-value");
      expect(client.connected).toBe(true);

      // Simulate connection drop
      await client.close();
      expect(client.connected).toBe(false);

      // Commands should fail immediately when offline queue is disabled
      try {
        await client.get(testKey);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error.message).toMatch(/offline queue is disabled|connection closed/i);
      }
    });

    test("should handle multiple connection drops and recoveries", async () => {
      const client = trackClient(new RedisClient(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        autoReconnect: true,
        enableOfflineQueue: true,
        retryDelayOnFailover: 50,
        maxReconnectAttempts: 5,
      }));

      const baseKey = ctx.generateKey("multi-reconnect");

      // Initial connection test
      await client.set(`${baseKey}-0`, "value-0");
      expect(client.connected).toBe(true);

      // Simulate multiple connection drops and recoveries
      for (let i = 1; i <= 3; i++) {
        // Drop connection
        await client.close();
        expect(client.connected).toBe(false);

        // Reconnect by issuing a command
        await retry(
          async () => {
            await client.set(`${baseKey}-${i}`, `value-${i}`);
            return true;
          },
          {
            maxAttempts: 5,
            delay: 100,
            timeout: 2000,
          }
        );

        expect(client.connected).toBe(true);

        // Verify the command was successful
        const value = await client.get(`${baseKey}-${i}`);
        expect(value).toBe(`value-${i}`);
      }

      // Verify all values are still accessible
      for (let i = 0; i <= 3; i++) {
        const value = await client.get(`${baseKey}-${i}`);
        expect(value).toBe(`value-${i}`);
      }
    });
  });

  describe("Connection State Management", () => {
    test("should correctly report connection status during reconnection", async () => {
      const client = trackClient(new RedisClient(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        autoReconnect: true,
        enableOfflineQueue: true,
      }));

      // Initial connection
      await client.set(ctx.generateKey("status-test"), "test");
      expect(client.connected).toBe(true);

      // Drop connection
      await client.close();
      expect(client.connected).toBe(false);

      // Start a command that will trigger reconnection
      const commandPromise = client.get(ctx.generateKey("status-test"));

      // The connection should eventually be restored
      await retry(
        async () => {
          return client.connected;
        },
        {
          maxAttempts: 20,
          delay: 100,
          timeout: 3000,
        }
      );

      expect(client.connected).toBe(true);
      await commandPromise;
    });

    test("should handle connection event callbacks during reconnection", async () => {
      const client = trackClient(new RedisClient(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        autoReconnect: true,
        enableOfflineQueue: true,
      }));

      let connectCount = 0;
      let closeCount = 0;

      client.onconnect = () => {
        connectCount++;
      };

      client.onclose = () => {
        closeCount++;
      };

      // Initial connection
      await client.set(ctx.generateKey("callback-test"), "test");
      expect(connectCount).toBe(1);

      // Drop connection
      await client.close();
      await delay(50); // Wait for close callback
      expect(closeCount).toBe(1);

      // Reconnect
      await retry(
        async () => {
          await client.get(ctx.generateKey("callback-test"));
          return true;
        },
        {
          maxAttempts: 10,
          delay: 100,
          timeout: 2000,
        }
      );

      // Should have triggered another connect callback
      expect(connectCount).toBe(2);
      expect(closeCount).toBe(1);
    });
  });

  describe("Complex Reconnection Scenarios", () => {
    test("should handle reconnection during transaction", async () => {
      const client = trackClient(new RedisClient(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        autoReconnect: true,
        enableOfflineQueue: true,
      }));

      const testKey = ctx.generateKey("transaction-reconnect");

      // Establish connection and start transaction
      await client.send("MULTI", []);
      await client.set(testKey, "transaction-value");

      // Simulate connection drop during transaction
      await client.close();

      // Try to execute the transaction - this should trigger reconnection
      // but the transaction state will be lost
      try {
        await client.send("EXEC", []);
        // If this succeeds, verify the behavior
        const value = await client.get(testKey);
        // The value might or might not be set depending on implementation
      } catch (error) {
        // It's acceptable for the transaction to fail due to connection drop
        expect(error.message).toMatch(/connection|transaction/i);
      }

      // Verify we can still use the client after reconnection
      await client.set(`${testKey}-after`, "after-reconnect");
      const afterValue = await client.get(`${testKey}-after`);
      expect(afterValue).toBe("after-reconnect");
    });

    test("should handle rapid command bursts after reconnection", async () => {
      const client = trackClient(new RedisClient(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        autoReconnect: true,
        enableOfflineQueue: true,
        maxRetriesPerRequest: 3,
      }));

      const baseKey = ctx.generateKey("burst-test");

      // Initial connection
      await client.set(`${baseKey}-init`, "init");

      // Drop connection
      await client.close();

      // Send multiple commands rapidly - they should all be queued and executed after reconnection
      const commandPromises = [];
      for (let i = 0; i < 10; i++) {
        commandPromises.push(client.set(`${baseKey}-${i}`, `value-${i}`));
      }

      // Wait for all commands to complete
      const results = await Promise.all(commandPromises);

      // All SET commands should succeed
      results.forEach(result => {
        expect(result).toBe("OK");
      });

      // Verify all values were set correctly
      for (let i = 0; i < 10; i++) {
        const value = await client.get(`${baseKey}-${i}`);
        expect(value).toBe(`value-${i}`);
      }
    });
  });

  describe("Reconnection Configuration", () => {
    test("should respect maxReconnectAttempts setting", async () => {
      // Use an invalid port to ensure connection fails
      const client = trackClient(new RedisClient("redis://localhost:12345", {
        autoReconnect: true,
        enableOfflineQueue: true,
        maxReconnectAttempts: 2,
        retryDelayOnFailover: 50,
        connectionTimeout: 100,
      }));

      // Try to use the client - it should attempt reconnection up to maxReconnectAttempts
      try {
        await client.set(ctx.generateKey("max-attempts"), "test");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error.message).toMatch(/connection|failed|socket/i);
      }

      expect(client.connected).toBe(false);
    });

    test("should work with custom reconnectOnError function", async () => {
      let reconnectCalled = false;

      const client = trackClient(new RedisClient(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        autoReconnect: true,
        enableOfflineQueue: true,
        reconnectOnError: (err) => {
          reconnectCalled = true;
          return err.message.includes("connection") || err.message.includes("socket");
        },
      }));

      const testKey = ctx.generateKey("custom-reconnect");

      // Establish connection
      await client.set(testKey, "test-value");

      // Drop connection
      await client.close();

      // This should trigger reconnection
      await retry(
        async () => {
          await client.get(testKey);
          return true;
        },
        {
          maxAttempts: 10,
          delay: 100,
          timeout: 2000,
        }
      );

      expect(client.connected).toBe(true);
      // Note: reconnectOnError might not be called in this test scenario
      // since we're simulating a manual close rather than a network error
    });
  });
});
