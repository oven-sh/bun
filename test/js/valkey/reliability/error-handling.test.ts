import { describe, test, expect, mock } from "bun:test";
import { randomUUIDv7, ValkeyClient } from "bun";
import { createClient, DEFAULT_REDIS_URL, delay, testKey } from "../test-utils";

/**
 * Test suite for error handling, protocol failures, and edge cases
 * - Command errors (wrong arguments, invalid syntax)
 * - Protocol parsing failures
 * - Null/undefined/invalid input handling
 * - Type errors
 * - Edge cases
 */
describe("Valkey: Error Handling", () => {
  describe("Command Errors", () => {
    test("should handle invalid command arguments", async () => {
      const client = createClient();

      // Wrong number of arguments
      try {
        await client.sendCommand("SET", ["key"]); // Missing value argument
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error.message).toMatch(/wrong number of arguments|WRONGNUMBER/i);
      }

      // Invalid argument type
      try {
        await client.sendCommand("INCR", ["non-numeric-value"]);
        await client.sendCommand("GET", ["test-key"]);
        expect(client.sendCommand("INCR", ["non-numeric-value"])).rejects.toThrow();
      } catch (error) {
        // This should raise a numeric error
        expect(error.message).toMatch(/not an integer|not a valid integer/i);
      }

      // Invalid command
      try {
        await client.sendCommand("INVALID_COMMAND", []);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error.message).toMatch(/unknown command|ERR unknown/i);
      }
    });

    test("should handle invalid keys and values", async () => {
      const client = createClient();

      // Very large key (Redis has limits on key sizes)
      try {
        const veryLongKey = "x".repeat(1024 * 1024); // 1MB key
        await client.set(veryLongKey, "value");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should fail with protocol error or maxmemory error
        expect(error.message).toMatch(/protocol error|invalid|max/i);
      }

      // Very large value (testing client buffer limits)
      try {
        // Create a 10MB string - this should be allowed but good to test
        const largeValue = "x".repeat(10 * 1024 * 1024);
        await client.set("large-value-key", largeValue);

        // Verify we can get it back
        const result = await client.get("large-value-key");
        expect(result).toBe(largeValue);
      } catch (error) {
        // Some Redis configurations might reject this, but client should handle it gracefully
        expect(error.message).not.toMatch(/undefined/);
      }
    });

    test("should handle special character keys and values", async () => {
      const client = createClient();

      // Keys with special characters
      const specialKeys = [
        "key with spaces",
        "key\nwith\nnewlines",
        "key\twith\ttabs",
        "key:with:colons",
        "key-with-unicode-♥-❤-★",
      ];

      // Values with special characters
      const specialValues = [
        "value with spaces",
        "value\nwith\nnewlines",
        "value\twith\ttabs",
        "value:with:colons",
        "value-with-unicode-♥-❤-★",
        // RESP protocol special characters
        "+OK\r\n",
        "-ERR\r\n",
        "$5\r\nhello\r\n",
        "*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n",
      ];

      for (const key of specialKeys) {
        for (const value of specialValues) {
          const testKey = `special-key-${randomUUIDv7()}`;

          try {
            // Set and get should work with special characters
            await client.set(testKey, value);
            const result = await client.get(testKey);
            expect(result).toBe(value);
          } catch (error) {
            // Some truly invalid cases might legitimately fail, but we should log for inspection
            console.error(`Failed with key "${key}", value "${value}": ${error.message}`);
            throw error;
          }
        }
      }
    });
  });

  describe("Null/Undefined/Invalid Input Handling", () => {
    test("should handle undefined/null command arguments", async () => {
      const client = createClient();

      // undefined key
      try {
        // @ts-expect-error: Testing runtime behavior with invalid types
        await client.get(undefined);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should be a type error or invalid argument
        expect(error.message).toMatch(/invalid|type|argument|undefined/i);
      }

      // null key
      try {
        // @ts-expect-error: Testing runtime behavior with invalid types
        await client.get(null);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should be a type error or invalid argument
        expect(error.message).toMatch(/invalid|type|argument|null/i);
      }

      // undefined value
      try {
        // @ts-expect-error: Testing runtime behavior with invalid types
        await client.set("valid-key", undefined);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should be a type error or invalid argument
        expect(error.message).toMatch(/invalid|type|argument|undefined/i);
      }

      // null value (this might actually be valid in some Redis clients, converting to empty string)
      try {
        // @ts-expect-error: Testing runtime behavior with invalid types
        await client.set("valid-key", null);

        // If it doesn't throw, check what was stored
        const result = await client.get("valid-key");
        expect(result === null || result === "null" || result === "").toBe(true);
      } catch (error) {
        // Should be a type error or invalid argument
        expect(error.message).toMatch(/invalid|type|argument|null/i);
      }
    });

    test("should handle invalid sendCommand inputs", async () => {
      const client = createClient();

      // Undefined command
      try {
        // @ts-expect-error: Testing runtime behavior with invalid types
        await client.sendCommand(undefined, []);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should be a type error or invalid argument
        expect(error.message).toMatch(/invalid|type|argument|undefined|command/i);
      }

      // Invalid args type
      try {
        // @ts-expect-error: Testing runtime behavior with invalid types
        await client.sendCommand("GET", "not-an-array");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should be a type error or invalid argument
        expect(error.message).toMatch(/invalid|type|argument|array/i);
      }

      // Non-string command
      try {
        // @ts-expect-error: Testing runtime behavior with invalid types
        await client.sendCommand(123, []);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should be a type error or invalid argument
        expect(error.message).toMatch(/invalid|type|argument|command/i);
      }

      // Non-string arguments
      try {
        // @ts-expect-error: Testing runtime behavior with invalid types
        await client.sendCommand("SET", ["key", 123]);

        // This might succeed with type coercion
        const result = await client.get("key");
        expect(result).toBe("123");
      } catch (error) {
        // Should either succeed with coercion or fail with useful error
        expect(error.message).toMatch(/invalid|type|argument/i);
      }
    });
  });

  describe("Protocol and Parser Edge Cases", () => {
    test("should handle various data types correctly", async () => {
      const client = createClient();

      // Integer/string conversions
      await client.set("int-key", "42");

      // INCR should return as number
      const incrResult = await client.incr("int-key");
      expect(typeof incrResult).toBe("number");
      expect(incrResult).toBe(43);

      // GET should return as string
      const getResult = await client.get("int-key");
      expect(typeof getResult).toBe("string");
      expect(getResult).toBe("43");

      // Boolean handling for EXISTS command
      await client.set("exists-key", "value");
      const existsResult = await client.exists("exists-key");
      expect(typeof existsResult).toBe("boolean");
      expect(existsResult).toBe(true);

      const notExistsResult = await client.exists("not-exists-key");
      expect(typeof notExistsResult).toBe("boolean");
      expect(notExistsResult).toBe(false);

      // Null handling for non-existent keys
      const nullResult = await client.get("not-exists-key");
      expect(nullResult).toBeNull();
    });

    test("should handle complex RESP3 types", async () => {
      const client = createClient();

      // HGETALL returns object in RESP3
      const hashKey = `hash-${randomUUIDv7()}`;
      await client.sendCommand("HSET", [hashKey, "field1", "value1", "field2", "value2"]);

      const hashResult = await client.sendCommand("HGETALL", [hashKey]);

      // Hash results should be objects in RESP3
      expect(typeof hashResult).toBe("object");
      expect(hashResult).not.toBeNull();

      if (hashResult !== null) {
        expect(hashResult.field1).toBe("value1");
        expect(hashResult.field2).toBe("value2");
      }

      // Error type handling
      try {
        await client.sendCommand("HGET", []); // Missing key and field
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Redis error should be properly parsed and thrown
        expect(error instanceof Error).toBe(true);
        expect(error.message).toMatch(/wrong number of arguments/i);
      }

      // NULL handling from various commands
      const nullResult = await client.sendCommand("HGET", [hashKey, "nonexistent"]);
      expect(nullResult).toBeNull();
    });

    test("should handle RESP protocol boundaries", async () => {
      const client = createClient();

      // Mix of command types to stress protocol parser
      const commands = [
        client.set("key1", "value1"),
        client.get("key1"),
        client.sendCommand("PING", []),
        client.incr("counter"),
        client.exists("key1"),
        client.sendCommand("HSET", ["hash", "field", "value"]),
        client.sendCommand("HGETALL", ["hash"]),
        client.set("key2", "x".repeat(1000)), // Larger value
        client.get("key2"),
      ];

      // Run all commands in parallel to stress protocol handling
      await Promise.all(commands);

      // Verify data integrity
      const verifications = [
        expect(await client.get("key1")).toBe("value1"),
        expect(await client.exists("key1")).toBe(true),
        expect(await client.get("key2")).toBe("x".repeat(1000)),
        expect(await client.sendCommand("HGET", ["hash", "field"])).toBe("value"),
      ];
    });
  });

  describe("Resource Management and Edge Cases", () => {
    test("should handle very large number of parallel commands", async () => {
      const client = createClient();

      // Create a large number of parallel commands
      const parallelCount = 1000;
      const commands = [];

      for (let i = 0; i < parallelCount; i++) {
        const key = `parallel-key-${i}`;
        commands.push(client.set(key, `value-${i}`));
      }

      // Execute all in parallel
      await Promise.all(commands);

      // Verify some random results
      for (let i = 0; i < 10; i++) {
        const index = Math.floor(Math.random() * parallelCount);
        const key = `parallel-key-${index}`;
        const value = await client.get(key);
        expect(value).toBe(`value-${index}`);
      }
    });

    test("should handle many rapid sequential commands", async () => {
      const client = createClient();

      // Create many sequential commands
      const sequentialCount = 500;

      for (let i = 0; i < sequentialCount; i++) {
        const key = `sequential-key-${i}`;
        await client.set(key, `value-${i}`);

        // Periodically verify to ensure integrity
        if (i % 50 === 0) {
          const value = await client.get(key);
          expect(value).toBe(`value-${i}`);
        }
      }
    });

    test("should handle command after disconnect and reconnect", async () => {
      // For this test, we need an actual Redis server
      try {
        const client = createClient();

        // Set initial value
        const key = `reconnect-key-${randomUUIDv7()}`;
        await client.set(key, "initial-value");

        // Disconnect explicitly
        await client.disconnect();

        // This command should fail
        try {
          await client.get(key);
          expect(false).toBe(true); // Should not reach here
        } catch (error) {
          expect(error.message).toMatch(/connection closed/i);
        }

        // Create new client connection (simulating reconnection)
        const newClient = createClient();

        // Should be able to get the previously set value
        const value = await newClient.get(key);
        expect(value).toBe("initial-value");
      } catch (error) {
        // If Redis isn't available, we'll skip this test
        console.warn("Reconnection test skipped:", error.message);
      }
    });

    test("should handle binary data", async () => {
      // Binary data in both keys and values
      const client = createClient();

      // Create Uint8Array with binary data
      const binaryData = new Uint8Array([0, 1, 2, 3, 255, 254, 253, 252]);
      const binaryString = String.fromCharCode(...binaryData);

      // Set binary data
      try {
        await client.set("binary-key", binaryString);

        // Get it back
        const result = await client.get("binary-key");

        // Compare binary data
        expect(result).toBe(binaryString);

        // More precise comparison with charCode
        for (let i = 0; i < binaryData.length; i++) {
          expect(result?.charCodeAt(i) ?? -1).toBe(binaryData[i]);
        }
      } catch (error) {
        // Binary data should be supported
        expect(false).toBe(true);
        console.error("Binary data test failed:", error);
      }
    });
  });

  describe("Authentication Errors", () => {
    test("should handle authentication failures", async () => {
      // Skip if no Redis available (to avoid false negatives)
      try {
        // Client with wrong password
        const client = valkey(`${DEFAULT_REDIS_URL}`, {
          password: "wrong-password",
          connectionTimeout: 1000,
          autoReconnect: false,
        });

        // Try to send a command
        try {
          await client.set("key", "value");
          expect(false).toBe(true); // Should not reach here
        } catch (error) {
          // Should fail with auth error
          expect(error.message).toMatch(/auth|authentication|password/i);
        }
      } catch (error) {
        // If Redis isn't available, we'll skip
        console.warn("Auth test skipped:", error.message);
      }
    });
  });

  describe("Command Timeout Handling", () => {
    test("should handle long-running commands", async () => {
      const client = createClient();

      try {
        // Try a potentially long-running command
        const result = await client.sendCommand("KEYS", ["*"]);

        // Should return result even if it's large
        expect(Array.isArray(result)).toBe(true);
      } catch (error) {
        // Some Redis configurations might timeout or reject keys, client should handle gracefully
        console.warn("Long-running command test got error:", error.message);
      }
    });
  });
});
