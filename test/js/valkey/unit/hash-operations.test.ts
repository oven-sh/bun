import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, expectType, isEnabled } from "../test-utils";

/**
 * Test suite covering Redis hash operations
 * - Single field operations (HSET, HGET, HDEL)
 * - Multiple field operations (HMSET, HMGET)
 * - Incremental operations (HINCRBY, HINCRBYFLOAT)
 * - Hash scanning operations (HGETALL, HKEYS, HVALS)
 */
describe.skipIf(!isEnabled)("Valkey: Hash Data Type Operations", () => {
  beforeEach(async () => {
    if (ctx.redis?.connected) {
      try {
        ctx.redis.close();
      } catch (e) {}
    }
    ctx.redis = createClient?.(ConnectionType.TCP);
  });

  describe("Basic Hash Commands", () => {
    test("HSET and HGET commands", async () => {
      const key = ctx.generateKey("hash-test");

      // HSET a single field
      const setResult = await ctx.redis.send("HSET", [key, "name", "John"]);
      expectType<number>(setResult, "number");
      expect(setResult).toBe(1); // 1 new field was set

      // HGET the field
      const getResult = await ctx.redis.send("HGET", [key, "name"]);
      expect(getResult).toBe("John");

      // HGET non-existent field should return null
      const nonExistentField = await ctx.redis.send("HGET", [key, "nonexistent"]);
      expect(nonExistentField).toBeNull();
    });

    test("HMSET and HMGET commands", async () => {
      const key = ctx.generateKey("hmset-test");

      // HMSET multiple fields
      const hmsetResult = await ctx.redis.hmset(key, ["name", "Alice", "age", "30", "active", "true"]);
      expect(hmsetResult).toBe("OK");

      // HMGET specific fields
      const hmgetResult = await ctx.redis.hmget(key, ["name", "age"]);
      expect(Array.isArray(hmgetResult)).toBe(true);
      expect(hmgetResult).toEqual(["Alice", "30"]);

      // HMGET with non-existent fields
      const mixedResult = await ctx.redis.hmget(key, ["name", "nonexistent"]);
      expect(Array.isArray(mixedResult)).toBe(true);
      expect(mixedResult).toEqual(["Alice", null]);
    });

    test("HMSET with object-style syntax", async () => {
      const key = ctx.generateKey("hmset-object-test");

      // We'll use sendCommand for this test since the native hmset doesn't support this syntax yet
      await ctx.redis.send("HMSET", [key, "name", "Bob", "age", "25", "email", "bob@example.com"]);

      // Verify all fields were set
      const allFields = await ctx.redis.send("HGETALL", [key]);
      expect(allFields).toBeDefined();

      if (typeof allFields === "object" && allFields !== null) {
        expect(allFields).toEqual({
          name: "Bob",
          age: "25",
          email: "bob@example.com",
        });
      }
    });

    test("HDEL command", async () => {
      const key = ctx.generateKey("hdel-test");

      // Set multiple fields
      await ctx.redis.send("HSET", [key, "field1", "value1", "field2", "value2", "field3", "value3"]);

      // Delete a single field
      const singleDelResult = await ctx.redis.send("HDEL", [key, "field1"]);
      expectType<number>(singleDelResult, "number");
      expect(singleDelResult).toBe(1); // 1 field deleted

      // Delete multiple fields
      const multiDelResult = await ctx.redis.send("HDEL", [key, "field2", "field3", "nonexistent"]);
      expectType<number>(multiDelResult, "number");
      expect(multiDelResult).toBe(2); // 2 fields deleted, non-existent field ignored

      // Verify all fields are gone
      const allFields = await ctx.redis.send("HKEYS", [key]);
      expect(Array.isArray(allFields)).toBe(true);
      expect(allFields.length).toBe(0);
    });

    test("HEXISTS command", async () => {
      const key = ctx.generateKey("hexists-test");

      // Set a field
      await ctx.redis.send("HSET", [key, "field1", "value1"]);

      // Check if field exists
      const existsResult = await ctx.redis.send("HEXISTS", [key, "field1"]);
      expectType<number>(existsResult, "number");
      expect(existsResult).toBe(1); // 1 indicates field exists

      // Check non-existent field
      const nonExistsResult = await ctx.redis.send("HEXISTS", [key, "nonexistent"]);
      expectType<number>(nonExistsResult, "number");
      expect(nonExistsResult).toBe(0); // 0 indicates field does not exist
    });
  });

  describe("Hash Incremental Operations", () => {
    test("HINCRBY command", async () => {
      const key = ctx.generateKey("hincrby-test");

      // Set initial value
      await ctx.redis.send("HSET", [key, "counter", "10"]);

      // Increment by a value
      const incrResult = await ctx.redis.hincrby(key, "counter", 5);
      expectType<number>(incrResult, "number");
      expect(incrResult).toBe(15);

      // Decrement by using negative increment
      const decrResult = await ctx.redis.hincrby(key, "counter", -7);
      expectType<number>(decrResult, "number");
      expect(decrResult).toBe(8);

      // Increment non-existent field (creates it with value 0 first)
      const newFieldResult = await ctx.redis.hincrby(key, "new-counter", 3);
      expectType<number>(newFieldResult, "number");
      expect(newFieldResult).toBe(3);
    });

    test("HINCRBYFLOAT command", async () => {
      const key = ctx.generateKey("hincrbyfloat-test");

      // Set initial value
      await ctx.redis.send("HSET", [key, "counter", "10.5"]);

      // Increment by float value
      const incrResult = await ctx.redis.hincrbyfloat(key, "counter", 1.5);
      expect(incrResult).toBe("12");

      // Decrement by using negative increment
      const decrResult = await ctx.redis.hincrbyfloat(key, "counter", -2.5);
      expect(decrResult).toBe("9.5");

      // Increment non-existent field (creates it with value 0 first)
      const newFieldResult = await ctx.redis.hincrbyfloat(key, "new-counter", 3.75);
      expect(newFieldResult).toBe("3.75");
    });
  });

  describe("Hash Scanning and Retrieval", () => {
    test("HGETALL command", async () => {
      const key = ctx.generateKey("hgetall-test");

      // Set multiple fields
      await ctx.redis.send("HSET", [
        key,
        "name",
        "Charlie",
        "age",
        "40",
        "email",
        "charlie@example.com",
        "active",
        "true",
      ]);

      // Get all fields and values
      const result = await ctx.redis.send("HGETALL", [key]);
      expect(result).toBeDefined();
      const res = await ctx.redis.set("ok", "123", "GET");

      // When using RESP3, HGETALL returns a map/object
      if (typeof result === "object" && result !== null) {
        expect(result.name).toBe("Charlie");
        expect(result.age).toBe("40");
        expect(result.email).toBe("charlie@example.com");
        expect(result.active).toBe("true");
      }
    });

    test("HKEYS command", async () => {
      const key = ctx.generateKey("hkeys-test");

      // Set multiple fields
      await ctx.redis.send("HSET", [key, "name", "Dave", "age", "35", "email", "dave@example.com"]);

      // Get all field names
      const result = await ctx.redis.send("HKEYS", [key]);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result).toContain("name");
      expect(result).toContain("age");
      expect(result).toContain("email");
    });

    test("HVALS command", async () => {
      const key = ctx.generateKey("hvals-test");

      // Set multiple fields
      await ctx.redis.send("HSET", [key, "name", "Eve", "age", "28", "email", "eve@example.com"]);

      // Get all field values
      const result = await ctx.redis.send("HVALS", [key]);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result).toContain("Eve");
      expect(result).toContain("28");
      expect(result).toContain("eve@example.com");
    });

    test("HLEN command", async () => {
      const key = ctx.generateKey("hlen-test");

      // Set multiple fields
      await ctx.redis.send("HSET", [key, "field1", "value1", "field2", "value2", "field3", "value3"]);

      // Get number of fields
      const result = await ctx.redis.send("HLEN", [key]);
      expectType<number>(result, "number");
      expect(result).toBe(3);

      // Delete a field and check again
      await ctx.redis.send("HDEL", [key, "field1"]);
      const updatedResult = await ctx.redis.send("HLEN", [key]);
      expectType<number>(updatedResult, "number");
      expect(updatedResult).toBe(2);
    });

    test("HSCAN command", async () => {
      const key = ctx.generateKey("hscan-test");

      // Create a hash with many fields
      const fieldCount = 20; // Reduced count for faster tests
      const fieldArgs = [];
      for (let i = 0; i < fieldCount; i++) {
        fieldArgs.push(`field:${i}`, `value:${i}`);
      }

      await ctx.redis.send("HSET", [key, ...fieldArgs]);

      // Use HSCAN to iterate through keys
      const scanResult = await ctx.redis.send("HSCAN", [key, "0", "COUNT", "10"]);

      // Validate scan result structure
      expect(Array.isArray(scanResult)).toBe(true);
      expect(scanResult.length).toBe(2);

      // First element is cursor
      expect(typeof scanResult[0]).toBe("string");

      // Second element is the key-value pairs array
      const pairs = scanResult[1];
      expect(Array.isArray(pairs)).toBe(true);

      // Should have key-value pairs (even number of elements)
      expect(pairs.length % 2).toBe(0);

      // Verify we have the expected pattern in our results
      for (let i = 0; i < pairs.length; i += 2) {
        const key = pairs[i];
        const value = pairs[i + 1];
        expect(key).toMatch(/^field:\d+$/);
        expect(value).toMatch(/^value:\d+$/);
      }
    });
  });
});
