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

    test("HSET native method", async () => {
      const key = ctx.generateKey("hset-native-test");

      const setResult = await ctx.redis.hset(key, "username", "johndoe");
      expectType<number>(setResult, "number");
      expect(setResult).toBe(1);

      const updateResult = await ctx.redis.hset(key, "username", "janedoe");
      expectType<number>(updateResult, "number");
      expect(updateResult).toBe(0);

      const getValue = await ctx.redis.hget(key, "username");
      expect(getValue).toBe("janedoe");

      const multiSetResult = await ctx.redis.hset(key, "email", "jane@example.com", "age", "25");
      expectType<number>(multiSetResult, "number");
      expect(multiSetResult).toBe(2);

      const allFields = await ctx.redis.hgetall(key);
      expect(allFields).toEqual({
        username: "janedoe",
        email: "jane@example.com",
        age: "25",
      });

      const bufferKey = ctx.generateKey("hset-buffer-test");
      const bufferValue = Buffer.from("binary data");
      const bufferSetResult = await ctx.redis.hset(bufferKey, "data", bufferValue);
      expect(bufferSetResult).toBe(1);

      const retrievedBuffer = await ctx.redis.hget(bufferKey, "data");
      expect(retrievedBuffer).toBe("binary data");
    });

    test("HSET with 8 field-value pairs", async () => {
      const key = ctx.generateKey("hset-8-pairs-test");

      const result = await ctx.redis.hset(
        key,
        "field1",
        "value1",
        "field2",
        "value2",
        "field3",
        "value3",
        "field4",
        "value4",
        "field5",
        "value5",
        "field6",
        "value6",
        "field7",
        "value7",
        "field8",
        "value8",
      );

      expectType<number>(result, "number");
      expect(result).toBe(8);

      const allFields = await ctx.redis.hgetall(key);
      expect(allFields).toEqual({
        field1: "value1",
        field2: "value2",
        field3: "value3",
        field4: "value4",
        field5: "value5",
        field6: "value6",
        field7: "value7",
        field8: "value8",
      });
    });

    test("HSET stress test with 1000 field-value pairs", async () => {
      const key = ctx.generateKey("hset-stress-test");
      const args = [key];
      const expectedObject: Record<string, string> = {};

      for (let i = 0; i < 1000; i++) {
        const field = `field_${i}`;
        const value = `value_${i}_${Math.random().toString(36).substring(2, 15)}`;
        args.push(field, value);
        expectedObject[field] = value;
      }

      const result = await ctx.redis.hset(...args);
      expectType<number>(result, "number");
      expect(result).toBe(1000);

      const size = await ctx.redis.hlen(key);
      expect(size).toBe(1000);

      const value500 = await ctx.redis.hget(key, "field_500");
      expect(value500).toBe(expectedObject.field_500);

      const value999 = await ctx.redis.hget(key, "field_999");
      expect(value999).toBe(expectedObject.field_999);

      const allFields = await ctx.redis.hgetall(key);
      expect(Object.keys(allFields).length).toBe(1000);
      expect(allFields.field_0).toBe(expectedObject.field_0);
      expect(allFields.field_999).toBe(expectedObject.field_999);
    });

    test("HSET extreme stress test with 10000 field-value pairs", async () => {
      const key = ctx.generateKey("hset-extreme-stress-test");
      const args = [key];

      for (let i = 0; i < 10000; i++) {
        args.push(`f${i}`, `v${i}`);
      }

      const result = await ctx.redis.hset(...args);
      expectType<number>(result, "number");
      expect(result).toBe(10000);

      const size = await ctx.redis.hlen(key);
      expect(size).toBe(10000);

      const first = await ctx.redis.hget(key, "f0");
      expect(first).toBe("v0");

      const middle = await ctx.redis.hget(key, "f5000");
      expect(middle).toBe("v5000");

      const last = await ctx.redis.hget(key, "f9999");
      expect(last).toBe("v9999");
    });

    test("HSET error handling", async () => {
      const key = ctx.generateKey("hset-error-test");

      let thrown;
      try {
        // @ts-expect-error
        await ctx.redis.hset(key);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect(thrown.message).toContain("hset requires at least 3 arguments");

      thrown = undefined;
      try {
        // @ts-expect-error
        await ctx.redis.hset(key, "field1");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect(thrown.message).toContain("hset requires field-value pairs");

      thrown = undefined;
      try {
        // @ts-expect-error
        await ctx.redis.hset(key, "field1", "value1", "field2");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect(thrown.message).toContain("hset requires field-value pairs");

      // Numbers are coerced to strings by Redis, which is valid behavior

      thrown = undefined;
      try {
        // @ts-expect-error
        await ctx.redis.hset(key, "field", null);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect(thrown.message).toMatch(/value.*string or buffer/i);

      thrown = undefined;
      try {
        // @ts-expect-error
        await ctx.redis.hset(key, "field1", "value1", undefined, "value2");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect(thrown.message).toMatch(/field.*string or buffer/i);
    });

    test("HGET native method", async () => {
      const key = ctx.generateKey("hget-native-test");

      // Set a hash field
      await ctx.redis.send("HSET", [key, "username", "johndoe"]);

      // Test native hget method - single value return
      const result = await ctx.redis.hget(key, "username");
      expectType<string>(result, "string");
      expect(result).toBe("johndoe");

      // HGET non-existent field should return null
      const nonExistent = await ctx.redis.hget(key, "nonexistent");
      expect(nonExistent).toBeNull();

      // HGET non-existent key should return null
      const nonExistentKey = await ctx.redis.hget("nonexistentkey", "field");
      expect(nonExistentKey).toBeNull();
    });

    test("HGET vs HMGET return value differences", async () => {
      const key = ctx.generateKey("hget-vs-hmget");

      // Set a single field
      await ctx.redis.send("HSET", [key, "field1", "value1"]);

      // HGET returns a single value (string or null)
      const hgetResult = await ctx.redis.hget(key, "field1");
      expect(hgetResult).toBe("value1");
      expect(typeof hgetResult).toBe("string");

      // HMGET with single field returns an array
      const hmgetResult = await ctx.redis.hmget(key, ["field1"]);
      expect(hmgetResult).toEqual(["value1"]);
      expect(Array.isArray(hmgetResult)).toBe(true);

      // This demonstrates the key difference - no need to access [0] with HGET
      expect(hgetResult).toBe(hmgetResult[0]);
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
