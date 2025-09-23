import { randomUUIDv7 } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, isEnabled } from "../test-utils";

/**
 * Test suite for error handling, protocol failures, and edge cases
 * - Command errors (wrong arguments, invalid syntax)
 * - Protocol parsing failures
 * - Null/undefined/invalid input handling
 * - Type errors
 * - Edge cases
 */
describe.skipIf(!isEnabled)("Valkey: Error Handling", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });
  describe("Command Errors", () => {
    test("should handle invalid command arguments", async () => {
      const client = ctx.redis;

      // Wrong number of arguments

      expect(async () => await client.send("SET", ["key"])).toThrowErrorMatchingInlineSnapshot(
        `"ERR wrong number of arguments for 'set' command"`,
      ); // Missing value argument
      expect(async () => await client.send("INVALID_COMMAND", ["a"])).toThrowErrorMatchingInlineSnapshot(
        `"ERR unknown command 'INVALID_COMMAND', with args beginning with: 'a' "`,
      ); // Invalid command
    });

    describe("should handle special character keys and values", async () => {
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
          test(`should handle special characters in key "${key}" and value "${value}"`, async () => {
            const client = ctx.redis;
            // Set and get should work with special characters
            await client.set(testKey, value);
            const result = await client.get(testKey);
            expect(result).toBe(value);
          });
        }
      }
    });
  });

  describe("Null/Undefined/Invalid Input Handling", () => {
    test("should handle undefined/null command arguments", async () => {
      const client = ctx.redis;

      // undefined key
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.get(undefined)).toThrowErrorMatchingInlineSnapshot(
        `"Expected key to be a string or buffer for 'get'."`,
      );

      // null key
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.get(null)).toThrowErrorMatchingInlineSnapshot(
        `"Expected key to be a string or buffer for 'get'."`,
      );

      // undefined value
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.set("valid-key", undefined)).toThrowErrorMatchingInlineSnapshot(
        `"Expected value to be a string or buffer or number for 'set'."`,
      );

      expect(async () => await client.set("valid-key", null)).toThrowErrorMatchingInlineSnapshot(
        `"Expected value to be a string or buffer or number for 'set'."`,
      );
    });

    test("should handle invalid sendCommand inputs", async () => {
      const client = ctx.redis;

      // Undefined command
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.send(undefined, [])).toThrowErrorMatchingInlineSnapshot(
        `"ERR unknown command 'undefined', with args beginning with: "`,
      );

      // Invalid args type
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.send("GET", "not-an-array")).toThrowErrorMatchingInlineSnapshot(
        `"Arguments must be an array"`,
      );

      // Non-string command
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.send(123, [])).toThrowErrorMatchingInlineSnapshot(
        `"ERR unknown command '123', with args beginning with: "`,
      );
    });
  });

  describe("Protocol and Parser Edge Cases", () => {
    test("should handle various data types correctly", async () => {
      const client = ctx.redis;

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
      const client = ctx.redis;

      // HGETALL returns object in RESP3
      const hashKey = `hash-${randomUUIDv7()}`;
      await client.send("HSET", [hashKey, "field1", "value1", "field2", "value2"]);

      const hashResult = await client.send("HGETALL", [hashKey]);

      // Hash results should be objects in RESP3
      expect(typeof hashResult).toBe("object");
      expect(hashResult).not.toBeNull();

      if (hashResult !== null) {
        expect(hashResult.field1).toBe("value1");
        expect(hashResult.field2).toBe("value2");
      }

      // Error type handling
      expect(async () => await client.send("HGET", [])).toThrowErrorMatchingInlineSnapshot(
        `"ERR wrong number of arguments for 'hget' command"`,
      ); // Missing key and field

      // NULL handling from various commands
      const nullResult = await client.send("HGET", [hashKey, "nonexistent"]);
      expect(nullResult).toBeNull();
    });

    test("should handle RESP protocol boundaries", async () => {
      const client = ctx.redis;

      // Mix of command types to stress protocol parser
      const commands = [
        client.set("key1", "value1"),
        client.get("key1"),
        client.send("PING", []),
        client.incr("counter"),
        client.exists("key1"),
        client.send("HSET", ["hash", "field", "value"]),
        client.send("HGETALL", ["hash"]),
        client.set("key2", "x".repeat(1000)), // Larger value
        client.get("key2"),
      ];

      // Run all commands in parallel to stress protocol handling
      await Promise.all(commands);

      // Verify data integrity

      expect(await client.get("key1")).toBe("value1");
      expect(await client.exists("key1")).toBe(true);
      expect(await client.get("key2")).toBe("x".repeat(1000));
      expect(await client.send("HGET", ["hash", "field"])).toBe("value");
    });
  });

  describe("Resource Management and Edge Cases", () => {
    test("should handle very large number of parallel commands", async () => {
      const client = ctx.redis;

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
      const client = ctx.redis;

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
      const client = ctx.redis;

      // Set initial value
      const key = `reconnect-key-${randomUUIDv7()}`;
      await client.set(key, "initial-value");

      // Disconnect explicitly
      client.close();

      // This command should fail
      expect(async () => await client.get(key)).toThrowErrorMatchingInlineSnapshot(`"Connection has failed"`);
    });

    test("should handle binary data", async () => {
      // Binary data in both keys and values
      const client = ctx.redis;

      // Create Uint8Array with binary data
      const binaryData = new Uint8Array([0, 1, 2, 3, 255, 254, 253, 252]);
      const binaryString = String.fromCharCode(...binaryData);

      await client.set("binary-key", binaryString);

      // Get it back
      const result = await client.get("binary-key");

      // Compare binary data
      expect(result).toBe(binaryString);
    });
  });
});
