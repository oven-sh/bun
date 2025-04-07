import { describe, test, expect } from "bun:test";
import { randomUUIDv7 } from "bun";
import { setupTestContext, skipIfNotInitialized, expectType } from "../test-utils";

/**
 * Test suite covering Redis hash operations
 * - Single field operations (HSET, HGET, HDEL)
 * - Multiple field operations (HMSET, HMGET)
 * - Incremental operations (HINCRBY, HINCRBYFLOAT)
 * - Hash scanning operations (HGETALL, HKEYS, HVALS)
 */
describe("Valkey: Hash Data Type Operations", () => {
  const ctx = setupTestContext();

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
      const hmsetResult = await ctx.redis.hmset(key, ["name", "age", "active"], ["Alice", "30", "true"]);
      expect(hmsetResult).toBe("OK");

      // HMGET specific fields
      const hmgetResult = await ctx.redis.hmget(key, ["name", "age"]);
      expect(Array.isArray(hmgetResult)).toBe(true);
      expect(hmgetResult).toMatchInlineSnapshot(`
        [
          "Alice",
          "30",
        ]
      `);

      // HMGET with non-existent fields
      const mixedResult = await ctx.redis.hmget(key, ["name", "nonexistent"]);
      expect(Array.isArray(mixedResult)).toBe(true);
      expect(mixedResult).toMatchInlineSnapshot(`
        [
          "Alice",
          null,
        ]
      `);
    });

    test("HMSET with object-style syntax", async () => {
      const key = ctx.generateKey("hmset-object-test");

      // We'll use sendCommand for this test since the native hmset doesn't support this syntax yet
      await ctx.redis.send("HMSET", [key, "name", "Bob", "age", "25", "email", "bob@example.com"]);

      // Verify all fields were set
      const allFields = await ctx.redis.send("HGETALL", [key]);
      expect(allFields).toBeDefined();

      if (typeof allFields === "object" && allFields !== null) {
        // Use snapshot to verify the entire object structure
        expect(allFields).toMatchInlineSnapshot(`
          {
            "age": "25",
            "email": "bob@example.com",
            "name": "Bob",
          }
        `);
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
      const fieldCount = 100;
      const fieldArgs = [];
      for (let i = 0; i < fieldCount; i++) {
        fieldArgs.push(`field:${i}`, `value:${i}`);
      }

      await ctx.redis.send("HSET", [key, ...fieldArgs]);

      // Use HSCAN to iterate through keys
      const scanResult = await ctx.redis.send("HSCAN", [key, "0", "COUNT", "20"]);
      expect(scanResult).toMatchInlineSnapshot(`
        [
          "0",
          [
            "field:0",
            "value:0",
            "field:1",
            "value:1",
            "field:2",
            "value:2",
            "field:3",
            "value:3",
            "field:4",
            "value:4",
            "field:5",
            "value:5",
            "field:6",
            "value:6",
            "field:7",
            "value:7",
            "field:8",
            "value:8",
            "field:9",
            "value:9",
            "field:10",
            "value:10",
            "field:11",
            "value:11",
            "field:12",
            "value:12",
            "field:13",
            "value:13",
            "field:14",
            "value:14",
            "field:15",
            "value:15",
            "field:16",
            "value:16",
            "field:17",
            "value:17",
            "field:18",
            "value:18",
            "field:19",
            "value:19",
            "field:20",
            "value:20",
            "field:21",
            "value:21",
            "field:22",
            "value:22",
            "field:23",
            "value:23",
            "field:24",
            "value:24",
            "field:25",
            "value:25",
            "field:26",
            "value:26",
            "field:27",
            "value:27",
            "field:28",
            "value:28",
            "field:29",
            "value:29",
            "field:30",
            "value:30",
            "field:31",
            "value:31",
            "field:32",
            "value:32",
            "field:33",
            "value:33",
            "field:34",
            "value:34",
            "field:35",
            "value:35",
            "field:36",
            "value:36",
            "field:37",
            "value:37",
            "field:38",
            "value:38",
            "field:39",
            "value:39",
            "field:40",
            "value:40",
            "field:41",
            "value:41",
            "field:42",
            "value:42",
            "field:43",
            "value:43",
            "field:44",
            "value:44",
            "field:45",
            "value:45",
            "field:46",
            "value:46",
            "field:47",
            "value:47",
            "field:48",
            "value:48",
            "field:49",
            "value:49",
            "field:50",
            "value:50",
            "field:51",
            "value:51",
            "field:52",
            "value:52",
            "field:53",
            "value:53",
            "field:54",
            "value:54",
            "field:55",
            "value:55",
            "field:56",
            "value:56",
            "field:57",
            "value:57",
            "field:58",
            "value:58",
            "field:59",
            "value:59",
            "field:60",
            "value:60",
            "field:61",
            "value:61",
            "field:62",
            "value:62",
            "field:63",
            "value:63",
            "field:64",
            "value:64",
            "field:65",
            "value:65",
            "field:66",
            "value:66",
            "field:67",
            "value:67",
            "field:68",
            "value:68",
            "field:69",
            "value:69",
            "field:70",
            "value:70",
            "field:71",
            "value:71",
            "field:72",
            "value:72",
            "field:73",
            "value:73",
            "field:74",
            "value:74",
            "field:75",
            "value:75",
            "field:76",
            "value:76",
            "field:77",
            "value:77",
            "field:78",
            "value:78",
            "field:79",
            "value:79",
            "field:80",
            "value:80",
            "field:81",
            "value:81",
            "field:82",
            "value:82",
            "field:83",
            "value:83",
            "field:84",
            "value:84",
            "field:85",
            "value:85",
            "field:86",
            "value:86",
            "field:87",
            "value:87",
            "field:88",
            "value:88",
            "field:89",
            "value:89",
            "field:90",
            "value:90",
            "field:91",
            "value:91",
            "field:92",
            "value:92",
            "field:93",
            "value:93",
            "field:94",
            "value:94",
            "field:95",
            "value:95",
            "field:96",
            "value:96",
            "field:97",
            "value:97",
            "field:98",
            "value:98",
            "field:99",
            "value:99",
          ],
        ]
      `);
    });
  });
});
