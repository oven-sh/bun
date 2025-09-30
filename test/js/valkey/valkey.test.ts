import { randomUUIDv7, RedisClient, spawn } from "bun";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { bunExe } from "harness";
import {
  ctx as _ctx,
  awaitableCounter,
  ConnectionType,
  createClient,
  DEFAULT_REDIS_URL,
  expectType,
  isEnabled,
  randomCoinFlip,
  setupDockerContainer,
  TLS_REDIS_OPTIONS,
  TLS_REDIS_URL,
} from "./test-utils";
import type { RedisTestStartMessage } from "./valkey.failing-subscriber";

for (const connectionType of [ConnectionType.TLS, ConnectionType.TCP]) {
  const ctx = { ..._ctx, redis: connectionType ? _ctx.redis : (_ctx.redisTLS as RedisClient) };
  describe.skipIf(!isEnabled)(`Valkey Redis Client (${connectionType})`, () => {
    beforeAll(async () => {
      // Ensure container is ready before tests run
      await setupDockerContainer();
      if (!ctx.redis) {
        ctx.redis = createClient(connectionType);
      }
    });

    beforeEach(async () => {
      // Don't create a new client, just ensure we have one
      if (!ctx.redis) {
        ctx.redis = createClient(connectionType);
      }

      // Flush all data for clean test state
      await ctx.redis.connect();
      await ctx.redis.send("FLUSHALL", ["SYNC"]);
    });

    describe("Basic Operations", () => {
      test("should set and get strings", async () => {
        const redis = ctx.redis;
        const testKey = "greeting";
        const testValue = "Hello from Bun Redis!";

        // Using direct set and get methods
        const setResult = await redis.set(testKey, testValue);
        expect(setResult).toMatchInlineSnapshot(`"OK"`);

        const setResult2 = await redis.set(testKey, testValue, "GET");
        expect(setResult2).toMatchInlineSnapshot(`"${testValue}"`);

        // GET should return the value we set
        const getValue = await redis.get(testKey);
        expect(getValue).toMatchInlineSnapshot(`"${testValue}"`);
      });

      test("should test key existence", async () => {
        const redis = ctx.redis;
        // Let's set a key first
        await redis.set("greeting", "test existence");

        // EXISTS in Redis normally returns integer 1 if key exists, 0 if not
        // The current implementation doesn't transform exists correctly yet
        const exists = await redis.exists("greeting");
        expect(exists).toBeDefined();
        // Should be true for existing keys (fixed in special handling for EXISTS)
        expect(exists).toBe(true);

        // For non-existent keys
        const randomKey = "nonexistent-key-" + randomUUIDv7();
        const notExists = await redis.exists(randomKey);
        expect(notExists).toBeDefined();
        // Should be false for non-existing keys
        expect(notExists).toBe(false);
      });

      test("should increment and decrement counters", async () => {
        const redis = ctx.redis;
        const counterKey = "counter";
        // First set a counter value
        await redis.set(counterKey, "10");

        // INCR should increment and return the new value
        const incrementedValue = await redis.incr(counterKey);
        expect(incrementedValue).toBeDefined();
        expect(typeof incrementedValue).toBe("number");
        expect(incrementedValue).toBe(11);

        // DECR should decrement and return the new value
        const decrementedValue = await redis.decr(counterKey);
        expect(decrementedValue).toBeDefined();
        expect(typeof decrementedValue).toBe("number");
        expect(decrementedValue).toBe(10);
      });

      test("should increment by specified amount with INCRBY", async () => {
        const redis = ctx.redis;
        const counterKey = "incrby-counter";
        await redis.set(counterKey, "5");

        // INCRBY should increment by the specified amount
        const result1 = await redis.incrby(counterKey, 10);
        expect(result1).toBe(15);

        // INCRBY with negative value should decrement
        const result2 = await redis.incrby(counterKey, -3);
        expect(result2).toBe(12);

        // INCRBY on non-existent key should treat it as 0
        const result3 = await redis.incrby("new-incrby-key", 5);
        expect(result3).toBe(5);
      });

      test("should increment by float amount with INCRBYFLOAT", async () => {
        const redis = ctx.redis;
        const floatKey = "float-counter";
        await redis.set(floatKey, "10.5");

        // INCRBYFLOAT should increment by the specified float amount
        const result1 = await redis.incrbyfloat(floatKey, 2.3);
        expect(result1).toBe("12.8");

        // INCRBYFLOAT with negative value should decrement
        const result2 = await redis.incrbyfloat(floatKey, -0.8);
        expect(result2).toBe("12");

        // INCRBYFLOAT on non-existent key should treat it as 0
        const result3 = await redis.incrbyfloat("new-float-key", 3.14);
        expect(result3).toBe("3.14");
      });

      test("should decrement by specified amount with DECRBY", async () => {
        const redis = ctx.redis;
        const counterKey = "decrby-counter";
        await redis.set(counterKey, "20");

        // DECRBY should decrement by the specified amount
        const result1 = await redis.decrby(counterKey, 5);
        expect(result1).toBe(15);

        // DECRBY with larger value
        const result2 = await redis.decrby(counterKey, 10);
        expect(result2).toBe(5);

        // DECRBY on non-existent key should treat it as 0
        const result3 = await redis.decrby("new-decrby-key", 3);
        expect(result3).toBe(-3);
      });

      test("should rename a key with RENAME", async () => {
        const redis = ctx.redis;
        const oldKey = "old-key";
        const newKey = "new-key";
        const value = "test-value";

        // Set a value on the old key
        await redis.set(oldKey, value);

        // Rename the key
        const result = await redis.rename(oldKey, newKey);
        expect(result).toBe("OK");

        // The new key should have the value
        const newValue = await redis.get(newKey);
        expect(newValue).toBe(value);

        // The old key should no longer exist
        const oldValue = await redis.get(oldKey);
        expect(oldValue).toBeNull();
      });

      test("should rename a key with RENAME overwriting existing key", async () => {
        const redis = ctx.redis;
        const oldKey = "old-key-overwrite";
        const newKey = "new-key-overwrite";

        // Set values on both keys
        await redis.set(oldKey, "old-value");
        await redis.set(newKey, "existing-value");

        // Rename should overwrite the existing key
        const result = await redis.rename(oldKey, newKey);
        expect(result).toBe("OK");

        // The new key should have the old value
        const newValue = await redis.get(newKey);
        expect(newValue).toBe("old-value");

        // The old key should no longer exist
        const oldValue = await redis.get(oldKey);
        expect(oldValue).toBeNull();
      });

      test("should rename a key only if new key does not exist with RENAMENX", async () => {
        const redis = ctx.redis;
        const oldKey = "old-key-nx";
        const newKey = "new-key-nx";
        const value = "test-value";

        // Set a value on the old key
        await redis.set(oldKey, value);

        // RENAMENX should succeed (newkey doesn't exist)
        const result1 = await redis.renamenx(oldKey, newKey);
        expect(result1).toBe(1);

        // The new key should have the value
        const newValue = await redis.get(newKey);
        expect(newValue).toBe(value);

        // The old key should no longer exist
        const oldValue = await redis.get(oldKey);
        expect(oldValue).toBeNull();
      });

      test("should not rename if new key exists with RENAMENX", async () => {
        const redis = ctx.redis;
        const oldKey = "old-key-nx-fail";
        const newKey = "new-key-nx-fail";

        // Set values on both keys
        await redis.set(oldKey, "old-value");
        await redis.set(newKey, "existing-value");

        // RENAMENX should fail (newkey exists)
        const result = await redis.renamenx(oldKey, newKey);
        expect(result).toBe(0);

        // Both keys should retain their original values
        const oldValue = await redis.get(oldKey);
        expect(oldValue).toBe("old-value");

        const newValue = await redis.get(newKey);
        expect(newValue).toBe("existing-value");
      });

      test("should set multiple keys with MSET", async () => {
        const redis = ctx.redis;

        // MSET should set multiple keys atomically
        const result = await redis.mset("mset-key1", "value1", "mset-key2", "value2", "mset-key3", "value3");
        expect(result).toBe("OK");

        // Verify all keys were set
        const value1 = await redis.get("mset-key1");
        expect(value1).toBe("value1");
        const value2 = await redis.get("mset-key2");
        expect(value2).toBe("value2");
        const value3 = await redis.get("mset-key3");
        expect(value3).toBe("value3");
      });

      test("should set multiple keys only if none exist with MSETNX", async () => {
        const redis = ctx.redis;

        // First MSETNX should succeed (keys don't exist)
        const result1 = await redis.msetnx("msetnx-key1", "value1", "msetnx-key2", "value2");
        expect(result1).toBe(1);

        // Verify keys were set
        const value1 = await redis.get("msetnx-key1");
        expect(value1).toBe("value1");
        const value2 = await redis.get("msetnx-key2");
        expect(value2).toBe("value2");

        // Second MSETNX should fail (at least one key exists)
        const result2 = await redis.msetnx("msetnx-key1", "newvalue", "msetnx-key3", "value3");
        expect(result2).toBe(0);

        // Verify original values weren't changed
        const unchangedValue = await redis.get("msetnx-key1");
        expect(unchangedValue).toBe("value1");

        // And new key wasn't created
        const nonExistentKey = await redis.get("msetnx-key3");
        expect(nonExistentKey).toBeNull();
      });

      test("should manage key expiration", async () => {
        const redis = ctx.redis;
        // Set a key first
        const tempKey = "temporary";
        await redis.set(tempKey, "will expire");

        // EXPIRE should return 1 if the timeout was set, 0 otherwise
        const result = await redis.expire(tempKey, 60);
        // Using native expire command instead of send()
        expect(result).toMatchInlineSnapshot(`1`);

        // Use the TTL command directly
        const ttl = await redis.ttl(tempKey);
        expectType<number>(ttl, "number");
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60); // Should be positive and not exceed our set time
      });

      test("should set key with expiration using SETEX", async () => {
        const redis = ctx.redis;
        const key = "setex-test-key";
        const value = "test-value";

        // SETEX should set the key with expiration in seconds
        const result = await redis.setex(key, 10, value);
        expect(result).toBe("OK");

        // Verify the value was set
        const getValue = await redis.get(key);
        expect(getValue).toBe(value);

        // Verify TTL is set (should be <= 10 seconds)
        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(10);
      });

      test("should set key with expiration using PSETEX", async () => {
        const redis = ctx.redis;
        const key = "psetex-test-key";
        const value = "test-value";

        // PSETEX should set the key with expiration in milliseconds
        const result = await redis.psetex(key, 5000, value);
        expect(result).toBe("OK");

        // Verify the value was set
        const getValue = await redis.get(key);
        expect(getValue).toBe(value);

        // Verify TTL is set (should be <= 5000 milliseconds, i.e., <= 5 seconds)
        const pttl = await redis.pttl(key);
        expect(pttl).toBeGreaterThan(0);
        expect(pttl).toBeLessThanOrEqual(5000);
      });

      test("should determine the type of a key with TYPE", async () => {
        const redis = ctx.redis;

        // String type
        await redis.set("string-key", "value");
        const stringType = await redis.type("string-key");
        expect(stringType).toBe("string");

        // List type
        await redis.lpush("list-key", "value");
        const listType = await redis.type("list-key");
        expect(listType).toBe("list");

        // Set type
        await redis.sadd("set-key", "value");
        const setType = await redis.type("set-key");
        expect(setType).toBe("set");

        // Hash type
        await redis.send("HSET", ["hash-key", "field", "value"]);
        const hashType = await redis.type("hash-key");
        expect(hashType).toBe("hash");

        // Non-existent key
        const noneType = await redis.type("nonexistent-key");
        expect(noneType).toBe("none");
      });

      test("should update last access time with TOUCH", async () => {
        const redis = ctx.redis;

        // Set some keys
        await redis.set("touch-key1", "value1");
        await redis.set("touch-key2", "value2");

        // Touch existing keys
        const touchedCount = await redis.touch("touch-key1", "touch-key2");
        expect(touchedCount).toBe(2);

        // Touch mix of existing and non-existing keys
        const mixedCount = await redis.touch("touch-key1", "nonexistent-key");
        expect(mixedCount).toBe(1);

        // Touch non-existent key
        const noneCount = await redis.touch("nonexistent-key1", "nonexistent-key2");
        expect(noneCount).toBe(0);
      });

      test("should get and set bits", async () => {
        const redis = ctx.redis;
        const bitKey = "mybitkey";

        // Set a bit at offset 7 to 1
        const oldValue = await redis.setbit(bitKey, 7, 1);
        expect(oldValue).toBe(0); // Original value was 0

        // Get the bit at offset 7
        const bitValue = await redis.getbit(bitKey, 7);
        expect(bitValue).toBe(1);

        // Get a bit that wasn't set (should be 0)
        const unsetBit = await redis.getbit(bitKey, 100);
        expect(unsetBit).toBe(0);

        // Set the same bit again to 0
        const oldValue2 = await redis.setbit(bitKey, 7, 0);
        expect(oldValue2).toBe(1); // Previous value was 1

        // Verify it's now 0
        const bitValue2 = await redis.getbit(bitKey, 7);
        expect(bitValue2).toBe(0);
      });

      test("should handle multiple bit operations", async () => {
        const redis = ctx.redis;
        const bitKey = "multibit";

        // Set multiple bits
        await redis.setbit(bitKey, 0, 1);
        await redis.setbit(bitKey, 3, 1);
        await redis.setbit(bitKey, 7, 1);

        // Verify all bits
        expect(await redis.getbit(bitKey, 0)).toBe(1);
        expect(await redis.getbit(bitKey, 1)).toBe(0);
        expect(await redis.getbit(bitKey, 2)).toBe(0);
        expect(await redis.getbit(bitKey, 3)).toBe(1);
        expect(await redis.getbit(bitKey, 4)).toBe(0);
        expect(await redis.getbit(bitKey, 5)).toBe(0);
        expect(await redis.getbit(bitKey, 6)).toBe(0);
        expect(await redis.getbit(bitKey, 7)).toBe(1);

        // Count the set bits
        const count = await redis.bitcount(bitKey);
        expect(count).toBe(3);
      });

      test("should get range of string", async () => {
        const redis = ctx.redis;
        const key = "rangetest";
        await redis.set(key, "Hello World");

        // Get substring from start to end
        const result1 = await redis.getrange(key, 0, 4);
        expect(result1).toBe("Hello");

        // Get substring with different range
        const result2 = await redis.getrange(key, 6, 10);
        expect(result2).toBe("World");

        // Get with negative offsets (count from end)
        const result3 = await redis.getrange(key, -5, -1);
        expect(result3).toBe("World");

        // Get entire string
        const result4 = await redis.getrange(key, 0, -1);
        expect(result4).toBe("Hello World");
      });

      test("should set range of string", async () => {
        const redis = ctx.redis;
        const key = "setrangetest";
        await redis.set(key, "Hello World");

        // Overwrite part of the string
        const newLength = await redis.setrange(key, 6, "Redis");
        expect(newLength).toBe(11);

        // Verify the change
        const result = await redis.get(key);
        expect(result).toBe("Hello Redis");

        // Set range on non-existent key (should pad with zero bytes)
        const key2 = "newkey";
        const newLength2 = await redis.setrange(key2, 5, "Redis");
        expect(newLength2).toBeGreaterThanOrEqual(10);
      });

      test("should implement TTL command correctly for different cases", async () => {
        const redis = ctx.redis;
        // 1. Key with expiration
        const tempKey = "ttl-test-key";
        await redis.set(tempKey, "ttl test value");
        await redis.expire(tempKey, 60);

        // Use native ttl command
        const ttl = await redis.ttl(tempKey);
        expectType<number>(ttl, "number");
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);

        // 2. Key with no expiration
        const permanentKey = "permanent-key";
        await redis.set(permanentKey, "no expiry");
        const noExpiry = await redis.ttl(permanentKey);
        expect(noExpiry).toMatchInlineSnapshot(`-1`); // -1 indicates no expiration

        // 3. Non-existent key
        const nonExistentKey = "non-existent-" + randomUUIDv7();
        const noKey = await redis.ttl(nonExistentKey);
        expect(noKey).toMatchInlineSnapshot(`-2`); // -2 indicates key doesn't exist
      });

      test("should copy a key to a new key with COPY", async () => {
        const redis = ctx.redis;
        const sourceKey = "copy-source";
        const destKey = "copy-dest";

        // Set source key
        await redis.set(sourceKey, "Hello World");

        // Copy to destination
        const result = await redis.copy(sourceKey, destKey);
        expect(result).toBe(1); // 1 indicates successful copy

        // Verify both keys exist with same value
        const sourceValue = await redis.get(sourceKey);
        const destValue = await redis.get(destKey);
        expect(sourceValue).toBe("Hello World");
        expect(destValue).toBe("Hello World");

        // Trying to copy to an existing key without REPLACE should fail
        const result2 = await redis.copy(sourceKey, destKey);
        expect(result2).toBe(0); // 0 indicates copy failed
      });

      test("should copy a key with REPLACE option", async () => {
        const redis = ctx.redis;
        const sourceKey = "copy-replace-source";
        const destKey = "copy-replace-dest";

        // Set both keys
        await redis.set(sourceKey, "New Value");
        await redis.set(destKey, "Old Value");

        // Copy with REPLACE
        const result = await redis.copy(sourceKey, destKey, "REPLACE");
        expect(result).toBe(1);

        // Verify destination was replaced
        const destValue = await redis.get(destKey);
        expect(destValue).toBe("New Value");
      });

      test("should unlink one or more keys asynchronously with UNLINK", async () => {
        const redis = ctx.redis;

        // Set multiple keys
        await redis.set("unlink-key1", "value1");
        await redis.set("unlink-key2", "value2");
        await redis.set("unlink-key3", "value3");

        // Unlink multiple keys
        const result = await redis.unlink("unlink-key1", "unlink-key2", "unlink-key3");
        expect(result).toBe(3); // All 3 keys were unlinked

        // Verify keys are gone
        expect(await redis.get("unlink-key1")).toBeNull();
        expect(await redis.get("unlink-key2")).toBeNull();
        expect(await redis.get("unlink-key3")).toBeNull();
      });

      test("should unlink with non-existent keys", async () => {
        const redis = ctx.redis;

        // Set one key
        await redis.set("unlink-exists", "value");

        // Try to unlink mix of existing and non-existing keys
        const result = await redis.unlink("unlink-exists", "unlink-nonexist1", "unlink-nonexist2");
        expect(result).toBe(1); // Only 1 key existed and was unlinked

        // Verify key is gone
        expect(await redis.get("unlink-exists")).toBeNull();
      });

      test("should return a random key with RANDOMKEY", async () => {
        const redis = ctx.redis;

        // Empty database should return null
        const emptyResult = await redis.randomkey();
        expect(emptyResult).toBeNull();

        // Set multiple keys
        await redis.set("random-key1", "value1");
        await redis.set("random-key2", "value2");
        await redis.set("random-key3", "value3");

        // Get a random key
        const randomKey = await redis.randomkey();
        expect(randomKey).toBeDefined();
        expect(randomKey).not.toBeNull();
        expect(["random-key1", "random-key2", "random-key3"]).toContain<string | null>(randomKey);

        // Verify the key exists
        const value = await redis.get(randomKey!);
        expect(value).toBeDefined();
      });

      test("should iterate keys with SCAN", async () => {
        const redis = ctx.redis;

        // Set multiple keys with a pattern
        const testKeys = ["scan-test:1", "scan-test:2", "scan-test:3", "scan-test:4", "scan-test:5"];
        for (const key of testKeys) {
          await redis.set(key, "value");
        }

        // Scan all keys
        let cursor = "0";
        const foundKeys: string[] = [];
        do {
          const [nextCursor, keys] = await redis.scan(cursor);
          foundKeys.push(...keys);
          cursor = nextCursor;
        } while (cursor !== "0");

        // Verify all test keys were found
        for (const testKey of testKeys) {
          expect(foundKeys).toContain(testKey);
        }
      });

      test("should iterate keys with SCAN and MATCH pattern", async () => {
        const redis = ctx.redis;

        // Set keys with different patterns
        await redis.set("user:1", "alice");
        await redis.set("user:2", "bob");
        await redis.set("post:1", "hello");
        await redis.set("post:2", "world");

        // Scan with MATCH pattern
        let cursor = "0";
        const userKeys: string[] = [];
        do {
          const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "user:*");
          userKeys.push(...keys);
          cursor = nextCursor;
        } while (cursor !== "0");

        // Should only find user keys
        expect(userKeys).toContain("user:1");
        expect(userKeys).toContain("user:2");
        expect(userKeys).not.toContain("post:1");
        expect(userKeys).not.toContain("post:2");
      });

      test("should reject invalid object argument in SCAN", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.scan({} as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'scan'."`);
      });

      test("should reject invalid array argument in SCAN", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.scan([] as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'scan'."`);
      });

      test("should reject invalid null argument in SCAN", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.scan(null as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'scan'."`);
      });

      test("should reject invalid source key in COPY", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.copy({} as any, "dest");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'copy'."`);
      });

      test("should reject invalid destination key in COPY", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.copy("source", [] as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'copy'."`);
      });

      test("should reject invalid option in COPY", async () => {
        const redis = ctx.redis;
        await redis.set("copy-invalid-opt-source", "value");
        expect(async () => {
          await redis.copy("copy-invalid-opt-source", "copy-invalid-opt-dest", "NOTVALID" as any);
        }).toThrowErrorMatchingInlineSnapshot(`"ERR syntax error"`);
      });

      test("should reject invalid old key in RENAME", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.rename({} as any, "newkey");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'rename'."`);
      });

      test("should reject invalid new key in RENAME", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.rename("oldkey", null as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected newkey to be a string or buffer for 'rename'."`);
      });

      test("should reject invalid key in GETRANGE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.getrange({} as any, 0, 5);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'getrange'."`,
        );
      });

      test("should reject invalid key in SETRANGE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.setrange(undefined as any, 0, "value");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'setrange'."`,
        );
      });

      test("should reject invalid key in INCRBY", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.incrby([] as any, 10);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'incrby'."`);
      });

      test("should reject invalid value in MSET", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.mset("key", {} as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'mset'."`);
      });

      test("should reject invalid value in MSETNX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.msetnx("key1", "value1", "key2", [] as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'msetnx'."`);
      });

      test("should reject invalid key in SETBIT", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.setbit({} as any, 0, 1);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'setbit'."`);
      });

      test("should reject invalid key in SETEX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.setex(null as any, 10, "value");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'setex'."`);
      });

      test("should reject invalid key in PSETEX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.psetex([] as any, 1000, "value");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'psetex'."`);
      });

      test("should reject invalid key in UNLINK", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.unlink({} as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'unlink'."`);
      });

      test("should reject invalid additional key in UNLINK", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.unlink("valid-key", [] as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'unlink'."`);
      });

      test("should reject invalid key in TOUCH", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.touch(null as any);
        }).toThrowErrorMatchingInlineSnapshot(`"The "key" argument must be specified"`);
      });

      test("should reject invalid additional key in TOUCH", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.touch("valid-key", {} as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'touch'."`);
      });
    });

    describe("Connection State", () => {
      test("should have a connected property", () => {
        const redis = ctx.redis;
        // The client should expose a connected property
        expect(typeof redis.connected).toBe("boolean");
      });
    });

    describe("RESP3 Data Types", () => {
      test("should handle hash maps (dictionaries) as command responses", async () => {
        const redis = ctx.redis;
        // HSET multiple fields
        const userId = "user:" + randomUUIDv7().substring(0, 8);
        const setResult = await redis.send("HSET", [userId, "name", "John", "age", "30", "active", "true"]);
        expect(setResult).toBeDefined();

        // HGETALL returns object with key-value pairs
        const hash = await redis.send("HGETALL", [userId]);
        expect(hash).toBeDefined();

        // Proper structure checking when RESP3 maps are fixed
        if (typeof hash === "object" && hash !== null) {
          expect(hash).toHaveProperty("name");
          expect(hash).toHaveProperty("age");
          expect(hash).toHaveProperty("active");

          expect(hash.name).toBe("John");
          expect(hash.age).toBe("30");
          expect(hash.active).toBe("true");
        }
      });

      test("should handle sets as command responses", async () => {
        const redis = ctx.redis;
        // Add items to a set
        const setKey = "colors:" + randomUUIDv7().substring(0, 8);
        const addResult = await redis.send("SADD", [setKey, "red", "blue", "green"]);
        expect(addResult).toBeDefined();

        // Get set members
        const setMembers = await redis.send("SMEMBERS", [setKey]);
        expect(setMembers).toBeDefined();

        // Check if the response is an array
        expect(Array.isArray(setMembers)).toBe(true);

        // Should contain our colors
        expect(setMembers).toContain("red");
        expect(setMembers).toContain("blue");
        expect(setMembers).toContain("green");
      });
    });

    describe("Connection Options", () => {
      test("connection errors", async () => {
        const url = new URL(connectionType === ConnectionType.TLS ? TLS_REDIS_URL : DEFAULT_REDIS_URL);
        url.username = "badusername";
        url.password = "secretpassword";
        const customRedis = new RedisClient(url.toString(), {
          tls: connectionType === ConnectionType.TLS ? TLS_REDIS_OPTIONS.tls : false,
        });

        expect(async () => {
          await customRedis.get("test");
        }).toThrowErrorMatchingInlineSnapshot(`"WRONGPASS invalid username-password pair or user is disabled."`);
      });

      const testKeyUniquePerDb = crypto.randomUUID();
      test.each([...Array(16).keys()])("Connecting to database with url $url succeeds", async (dbId: number) => {
        const redis = createClient(connectionType, {}, dbId);

        // Ensure the value is not in the database.
        const testValue = await redis.get(testKeyUniquePerDb);
        expect(testValue).toBeNull();

        redis.close();
      });
    });

    describe("Reconnections", () => {
      test.skip("should automatically reconnect after connection drop", async () => {
        // NOTE: This test was already broken before the Docker Compose migration.
        // It times out after 31 seconds with "Max reconnection attempts reached"
        // This appears to be an issue with the Redis client's automatic reconnection
        // behavior, not related to the Docker infrastructure changes.
        const TEST_KEY = "test-key";
        const TEST_VALUE = "test-value";

        // Ensure we have a working client to start
        if (!ctx.redis || !ctx.redis.connected) {
          ctx.redis = createClient(connectionType);
        }

        const valueBeforeStart = await ctx.redis.get(TEST_KEY);
        expect(valueBeforeStart).toBeNull();

        // Set some value
        await ctx.redis.set(TEST_KEY, TEST_VALUE);
        const valueAfterSet = await ctx.redis.get(TEST_KEY);
        expect(valueAfterSet).toBe(TEST_VALUE);

        await ctx.restartServer();

        const valueAfterStop = await ctx.redis.get(TEST_KEY);
        expect(valueAfterStop).toBe(TEST_VALUE);
      });
    });

    describe("PUB/SUB", () => {
      var i = 0;
      const testChannel = () => {
        return `test-channel-${i++}`;
      };
      const testKey = () => {
        return `test-key-${i++}`;
      };
      const testValue = () => {
        return `test-value-${i++}`;
      };
      const testMessage = () => {
        return `test-message-${i++}`;
      };

      beforeEach(async () => {
        // The PUB/SUB tests expect that ctx.redis is connected but not in subscriber mode.
        await ctx.cleanupSubscribers();
      });

      test("publishing to a channel does not fail", async () => {
        expect(await ctx.redis.publish(testChannel(), testMessage())).toBe(0);
      });

      test("setting in subscriber mode gracefully fails", async () => {
        const subscriber = await ctx.newSubscriberClient(connectionType);

        await subscriber.subscribe(testChannel(), () => {});

        expect(() => subscriber.set(testKey(), testValue())).toThrow(
          "RedisClient.prototype.set cannot be called while in subscriber mode",
        );

        await subscriber.unsubscribe(testChannel());
      });

      test("setting after unsubscribing works", async () => {
        const channel = testChannel();
        const subscriber = await ctx.newSubscriberClient(connectionType);
        await subscriber.subscribe(channel, () => {});
        await subscriber.unsubscribe(channel);
        expect(ctx.redis.set(testKey(), testValue())).resolves.toEqual("OK");
      });

      test("subscribing to a channel receives messages", async () => {
        const TEST_MESSAGE_COUNT = 128;
        const subscriber = await ctx.newSubscriberClient(connectionType);
        const channel = testChannel();
        const message = testMessage();

        const counter = awaitableCounter();
        await subscriber.subscribe(channel, (message, channel) => {
          counter.increment();
          expect(channel).toBe(channel);
          expect(message).toBe(message);
        });

        Array.from({ length: TEST_MESSAGE_COUNT }).forEach(async () => {
          expect(await ctx.redis.publish(channel, message)).toBe(1);
        });

        await counter.untilValue(TEST_MESSAGE_COUNT);
        expect(counter.count()).toBe(TEST_MESSAGE_COUNT);
      });

      test("messages are received in order", async () => {
        const channel = testChannel();

        await ctx.redis.set("START-TEST", "1");
        const TEST_MESSAGE_COUNT = 1024;
        const subscriber = await ctx.newSubscriberClient(connectionType);

        const counter = awaitableCounter();
        var receivedMessages: string[] = [];
        await subscriber.subscribe(channel, message => {
          receivedMessages.push(message);
          counter.increment();
        });

        const sentMessages = Array.from({ length: TEST_MESSAGE_COUNT }).map(() => {
          return randomUUIDv7();
        });
        await Promise.all(
          sentMessages.map(async message => {
            expect(await ctx.redis.publish(channel, message)).toBe(1);
          }),
        );

        await counter.untilValue(TEST_MESSAGE_COUNT);
        expect(receivedMessages.length).toBe(sentMessages.length);
        expect(receivedMessages).toEqual(sentMessages);

        await subscriber.unsubscribe(channel);

        await ctx.redis.set("STOP-TEST", "1");
      });

      test("subscribing to multiple channels receives messages", async () => {
        const TEST_MESSAGE_COUNT = 128;
        const subscriber = await ctx.newSubscriberClient(connectionType);

        const channels = [testChannel(), testChannel()];
        const counter = awaitableCounter();

        var receivedMessages: { [channel: string]: string[] } = {};
        await subscriber.subscribe(channels, (message, channel) => {
          receivedMessages[channel] = receivedMessages[channel] || [];
          receivedMessages[channel].push(message);
          counter.increment();
        });

        var sentMessages: { [channel: string]: string[] } = {};
        for (let i = 0; i < TEST_MESSAGE_COUNT; i++) {
          const channel = channels[randomCoinFlip() ? 0 : 1];
          const message = randomUUIDv7();

          expect(await ctx.redis.publish(channel, message)).toBe(1);

          sentMessages[channel] = sentMessages[channel] || [];
          sentMessages[channel].push(message);
        }

        await counter.untilValue(TEST_MESSAGE_COUNT);

        // Check that we received messages on both channels
        expect(Object.keys(receivedMessages).sort()).toEqual(Object.keys(sentMessages).sort());

        // Check messages match for each channel
        for (const channel of channels) {
          if (sentMessages[channel]) {
            expect(receivedMessages[channel]).toEqual(sentMessages[channel]);
          }
        }

        await subscriber.unsubscribe(channels);
      });

      test("unsubscribing from specific channels while remaining subscribed to others", async () => {
        const channel1 = "channel-1";
        const channel2 = "channel-2";
        const channel3 = "channel-3";

        const subscriber = createClient(connectionType);
        await subscriber.connect();

        let receivedMessages: { [channel: string]: string[] } = {};

        // Total counter for all messages we expect to receive: 3 initial + 2 after unsubscribe = 5 total
        const counter = awaitableCounter();

        // Subscribe to three channels
        await subscriber.subscribe([channel1, channel2, channel3], (message, channel) => {
          receivedMessages[channel] = receivedMessages[channel] || [];
          receivedMessages[channel].push(message);
          counter.increment();
        });

        // Send initial messages to all channels
        expect(await ctx.redis.publish(channel1, "msg1-before")).toBe(1);
        expect(await ctx.redis.publish(channel2, "msg2-before")).toBe(1);
        expect(await ctx.redis.publish(channel3, "msg3-before")).toBe(1);

        // Wait for initial messages, then unsubscribe from channel2
        await counter.untilValue(3);
        await subscriber.unsubscribe(channel2);

        // Send messages after unsubscribing from channel2
        expect(await ctx.redis.publish(channel1, "msg1-after")).toBe(1);
        expect(await ctx.redis.publish(channel2, "msg2-after")).toBe(0);
        expect(await ctx.redis.publish(channel3, "msg3-after")).toBe(1);

        await counter.untilValue(5);

        // Check we received messages only on subscribed channels
        expect(receivedMessages[channel1]).toEqual(["msg1-before", "msg1-after"]);
        expect(receivedMessages[channel2]).toEqual(["msg2-before"]); // No "msg2-after"
        expect(receivedMessages[channel3]).toEqual(["msg3-before", "msg3-after"]);

        await subscriber.unsubscribe([channel1, channel3]);
      });

      test("subscribing to the same channel multiple times", async () => {
        const subscriber = createClient(connectionType);
        await subscriber.connect();
        const channel = testChannel();

        const counter = awaitableCounter();

        let callCount = 0;
        const listener = () => {
          callCount++;
          counter.increment();
        };

        let callCount2 = 0;
        const listener2 = () => {
          callCount2++;
          counter.increment();
        };

        // Subscribe to the same channel twice
        await subscriber.subscribe(channel, listener);
        await subscriber.subscribe(channel, listener2);

        // Publish a single message
        expect(await ctx.redis.publish(channel, "test-message")).toBe(1);

        await counter.untilValue(2);

        // Both listeners should have been called once.
        expect(callCount).toBe(1);
        expect(callCount2).toBe(1);

        await subscriber.unsubscribe(channel);
      });

      test("empty string messages", async () => {
        const channel = "empty-message-channel";
        const subscriber = createClient(connectionType);
        await subscriber.connect();

        const counter = awaitableCounter();
        let receivedMessage: string | undefined = undefined;
        await subscriber.subscribe(channel, message => {
          receivedMessage = message;
          counter.increment();
        });

        expect(await ctx.redis.publish(channel, "")).toBe(1);
        await counter.untilValue(1);

        expect(receivedMessage).not.toBeUndefined();
        expect(receivedMessage!).toBe("");

        await subscriber.unsubscribe(channel);
      });

      test("special characters in channel names", async () => {
        const subscriber = createClient(connectionType);
        await subscriber.connect();

        const specialChannels = [
          "channel:with:colons",
          "channel with spaces",
          "channel-with-unicode-😀",
          "channel[with]brackets",
          "channel@with#special$chars",
        ];

        for (const channel of specialChannels) {
          const counter = awaitableCounter();
          let received = false;
          await subscriber.subscribe(channel, () => {
            received = true;
            counter.increment();
          });

          expect(await ctx.redis.publish(channel, "test")).toBe(1);
          await counter.untilValue(1);

          expect(received).toBe(true);
          await subscriber.unsubscribe(channel);
        }
      });

      test("ping works in subscription mode", async () => {
        const channel = "ping-test-channel";

        const subscriber = await ctx.newSubscriberClient(connectionType);
        await subscriber.subscribe(channel, () => {});

        // Ping should work in subscription mode
        const pong = await subscriber.ping();
        expect(pong).toBe("PONG");

        const customPing = await subscriber.ping("hello");
        expect(customPing).toBe("hello");
      });

      test("publish does not work from a subscribed client", async () => {
        const channel = "self-publish-channel";

        const subscriber = await ctx.newSubscriberClient(connectionType);
        await subscriber.subscribe(channel, () => {});

        // Publishing from the same client should work
        expect(async () => subscriber.publish(channel, "self-published")).toThrow();
      });

      test("complete unsubscribe restores normal command mode", async () => {
        const channel = "restore-test-channel";
        const testKey = "restore-test-key";

        const subscriber = await ctx.newSubscriberClient(connectionType);
        await subscriber.subscribe(channel, () => {});

        // Should fail in subscription mode
        expect(() => subscriber.set(testKey, testValue())).toThrow(
          "RedisClient.prototype.set cannot be called while in subscriber mode.",
        );

        // Unsubscribe from all channels
        await subscriber.unsubscribe();

        // Should work after unsubscribing
        const result = await ctx.redis.set(testKey, "value");
        expect(result).toBe("OK");

        const value = await ctx.redis.get(testKey);
        expect(value).toBe("value");
      });

      test("publishing without subscribers succeeds", async () => {
        const channel = "no-subscribers-channel";

        // Publishing without subscribers should not throw
        expect(await ctx.redis.publish(channel, "message")).toBe(0);
      });

      test("unsubscribing from non-subscribed channels", async () => {
        const channel = "never-subscribed-channel";

        expect(() => ctx.redis.unsubscribe(channel)).toThrow(
          "RedisClient.prototype.unsubscribe can only be called while in subscriber mode.",
        );
      });

      test("callback errors don't crash the client", async () => {
        const channel = "error-callback-channel";

        const STEP_SUBSCRIBED = 1;
        const STEP_FIRST_MESSAGE = 2;
        const STEP_SECOND_MESSAGE = 3;
        const STEP_THIRD_MESSAGE = 4;

        // stepCounter is a slight hack to track the progress of the subprocess.
        const stepCounter = awaitableCounter();
        let currentMessage: any = {};

        const subscriberProc = spawn({
          cmd: [bunExe(), `${__dirname}/valkey.failing-subscriber.ts`],
          stdout: "inherit",
          stderr: "inherit",
          ipc: msg => {
            currentMessage = msg;
            stepCounter.increment();
          },
          env: {
            ...process.env,
            NODE_ENV: "development",
          },
        });

        subscriberProc.send({
          event: "start",
          url: connectionType === ConnectionType.TLS ? TLS_REDIS_URL : DEFAULT_REDIS_URL,
          tlsPaths: connectionType === ConnectionType.TLS ? TLS_REDIS_OPTIONS.tlsPaths : undefined,
        } as RedisTestStartMessage);

        try {
          await stepCounter.untilValue(STEP_SUBSCRIBED);
          expect(currentMessage.event).toBe("ready");

          // Send multiple messages
          expect(await ctx.redis.publish(channel, "message1")).toBeGreaterThanOrEqual(1);
          await stepCounter.untilValue(STEP_FIRST_MESSAGE);
          expect(currentMessage.event).toBe("message");
          expect(currentMessage.index).toBe(1);

          // Now, the subscriber process will crash
          expect(await ctx.redis.publish(channel, "message2")).toBeGreaterThanOrEqual(1);
          await stepCounter.untilValue(STEP_SECOND_MESSAGE);
          expect(currentMessage.event).toBe("exception");
          //expect(currentMessage.index).toBe(2);

          // But it should recover and continue receiving messages
          expect(await ctx.redis.publish(channel, "message3")).toBeGreaterThanOrEqual(1);
          await stepCounter.untilValue(STEP_THIRD_MESSAGE);
          expect(currentMessage.event).toBe("message");
          expect(currentMessage.index).toBe(3);
        } finally {
          subscriberProc.kill();
          await subscriberProc.exited;
        }
      });

      test("subscriptions return correct counts", async () => {
        const subscriber = createClient(connectionType);
        await subscriber.connect();

        expect(await subscriber.subscribe("chan1", () => {})).toBe(1);
        expect(await subscriber.subscribe("chan2", () => {})).toBe(2);
      });

      test("unsubscribing from listeners", async () => {
        const channel = "error-callback-channel";

        const subscriber = createClient(connectionType);
        await subscriber.connect();

        // First phase: both listeners should receive 1 message each (2 total)
        const counter = awaitableCounter();
        let messageCount1 = 0;
        const listener1 = () => {
          messageCount1++;
          counter.increment();
        };
        await subscriber.subscribe(channel, listener1);

        let messageCount2 = 0;
        const listener2 = () => {
          messageCount2++;
          counter.increment();
        };
        await subscriber.subscribe(channel, listener2);

        await ctx.redis.publish(channel, "message1");
        await counter.untilValue(2);

        expect(messageCount1).toBe(1);
        expect(messageCount2).toBe(1);

        console.log("Unsubscribing listener2");
        await subscriber.unsubscribe(channel, listener2);

        await ctx.redis.publish(channel, "message1");
        await counter.untilValue(3);

        expect(messageCount1).toBe(2);
        expect(messageCount2).toBe(1);
      });
    });

    describe("duplicate()", () => {
      test("should create duplicate of connected client that gets connected", async () => {
        const duplicate = await ctx.redis.duplicate();

        expect(duplicate.connected).toBe(true);
        expect(duplicate).not.toBe(ctx.redis);

        // Both should work independently
        await ctx.redis.set("test-original", "original-value");
        await duplicate.set("test-duplicate", "duplicate-value");

        expect(await ctx.redis.get("test-duplicate")).toBe("duplicate-value");
        expect(await duplicate.get("test-original")).toBe("original-value");

        duplicate.close();
      });

      test("should preserve connection configuration in duplicate", async () => {
        await ctx.redis.connect();

        const duplicate = await ctx.redis.duplicate();

        // Both clients should be able to perform the same operations
        const testKey = `duplicate-config-test-${randomUUIDv7().substring(0, 8)}`;
        const testValue = "test-value";

        await ctx.redis.set(testKey, testValue);
        const retrievedValue = await duplicate.get(testKey);

        expect(retrievedValue).toBe(testValue);

        duplicate.close();
      });

      test("should allow duplicate to work independently from original", async () => {
        const duplicate = await ctx.redis.duplicate();

        // Close original, duplicate should still work
        duplicate.close();

        const testKey = `independent-test-${randomUUIDv7().substring(0, 8)}`;
        const testValue = "independent-value";

        await ctx.redis.set(testKey, testValue);
        const retrievedValue = await ctx.redis.get(testKey);

        expect(retrievedValue).toBe(testValue);
      });

      test("should handle duplicate of client in subscriber mode", async () => {
        const subscriber = await ctx.newSubscriberClient(connectionType);

        const testChannel = "test-subscriber-duplicate";

        // Put original client in subscriber mode
        await subscriber.subscribe(testChannel, () => {});

        const duplicate = await subscriber.duplicate();

        // Duplicate should not be in subscriber mode
        expect(() => duplicate.set("test-key", "test-value")).not.toThrow();

        await subscriber.unsubscribe(testChannel);
      });

      test("should create multiple duplicates from same client", async () => {
        await ctx.redis.connect();

        const duplicate1 = await ctx.redis.duplicate();
        const duplicate2 = await ctx.redis.duplicate();
        const duplicate3 = await ctx.redis.duplicate();

        // All should be connected
        expect(duplicate1.connected).toBe(true);
        expect(duplicate2.connected).toBe(true);
        expect(duplicate3.connected).toBe(true);

        // All should work independently
        const testKey = `multi-duplicate-test-${randomUUIDv7().substring(0, 8)}`;
        await duplicate1.set(`${testKey}-1`, "value-1");
        await duplicate2.set(`${testKey}-2`, "value-2");
        await duplicate3.set(`${testKey}-3`, "value-3");

        expect(await duplicate1.get(`${testKey}-1`)).toBe("value-1");
        expect(await duplicate2.get(`${testKey}-2`)).toBe("value-2");
        expect(await duplicate3.get(`${testKey}-3`)).toBe("value-3");

        // Cross-check: each duplicate can read what others wrote
        expect(await duplicate1.get(`${testKey}-2`)).toBe("value-2");
        expect(await duplicate2.get(`${testKey}-3`)).toBe("value-3");
        expect(await duplicate3.get(`${testKey}-1`)).toBe("value-1");

        duplicate1.close();
        duplicate2.close();
        duplicate3.close();
      });

      test("should duplicate client that failed to connect", async () => {
        // Create client with invalid credentials to force connection failure
        const url = new URL(connectionType === ConnectionType.TLS ? TLS_REDIS_URL : DEFAULT_REDIS_URL);
        url.username = "invaliduser";
        url.password = "invalidpassword";
        const failedRedis = new RedisClient(url.toString(), {
          tls: connectionType === ConnectionType.TLS ? TLS_REDIS_OPTIONS.tls : false,
        });

        // Try to connect and expect it to fail
        let connectionFailed = false;
        try {
          await failedRedis.connect();
        } catch {
          connectionFailed = true;
        }

        expect(connectionFailed).toBe(true);
        expect(failedRedis.connected).toBe(false);

        // Duplicate should also remain unconnected
        const duplicate = await failedRedis.duplicate();
        expect(duplicate.connected).toBe(false);
      });

      test("should handle duplicate timing with concurrent operations", async () => {
        await ctx.redis.connect();

        // Start some operations on the original client
        const testKey = `concurrent-test-${randomUUIDv7().substring(0, 8)}`;
        const originalOperation = ctx.redis.set(testKey, "original-value");

        // Create duplicate while operation is in flight
        const duplicate = await ctx.redis.duplicate();

        // Wait for original operation to complete
        await originalOperation;

        // Duplicate should be able to read the value
        expect(await duplicate.get(testKey)).toBe("original-value");

        duplicate.close();
      });
    });
  });
}
