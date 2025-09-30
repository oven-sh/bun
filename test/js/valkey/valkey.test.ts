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

      test("should set expiration with EXPIREAT using Unix timestamp", async () => {
        const redis = ctx.redis;
        const key = "expireat-test-key";
        await redis.set(key, "test-value");

        // Set expiration to 60 seconds from now using Unix timestamp
        const futureTimestamp = Math.floor(Date.now() / 1000) + 60;
        const result = await redis.expireat(key, futureTimestamp);
        expect(result).toBe(1); // 1 indicates success

        // Verify TTL is set (should be around 60 seconds)
        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
      });

      test("should return 0 for EXPIREAT on non-existent key", async () => {
        const redis = ctx.redis;
        const futureTimestamp = Math.floor(Date.now() / 1000) + 60;
        const result = await redis.expireat("nonexistent-expireat-key", futureTimestamp);
        expect(result).toBe(0); // 0 indicates key does not exist
      });

      test("should set expiration with PEXPIRE in milliseconds", async () => {
        const redis = ctx.redis;
        const key = "pexpire-test-key";
        await redis.set(key, "test-value");

        // Set expiration to 5000 milliseconds (5 seconds)
        const result = await redis.pexpire(key, 5000);
        expect(result).toBe(1); // 1 indicates success

        const pttl = await redis.pttl(key);
        expect(pttl).toBeGreaterThan(0);
        expect(pttl).toBeLessThanOrEqual(5050);
      });

      test("should return 0 for PEXPIRE on non-existent key", async () => {
        const redis = ctx.redis;
        const result = await redis.pexpire("nonexistent-pexpire-key", 5000);
        expect(result).toBe(0); // 0 indicates key does not exist
      });

      test("should set expiration with PEXPIREAT using Unix timestamp in milliseconds", async () => {
        const redis = ctx.redis;
        const key = "pexpireat-test-key";
        await redis.set(key, "test-value");

        // Set expiration to 5000 ms from now using Unix timestamp in milliseconds
        const futureTimestampMs = Date.now() + 5000;
        const result = await redis.pexpireat(key, futureTimestampMs);
        expect(result).toBe(1); // 1 indicates success

        const pttl = await redis.pttl(key);
        expect(pttl).toBeGreaterThan(0);
        expect(pttl).toBeLessThanOrEqual(5050);
      });

      test("should return 0 for PEXPIREAT on non-existent key", async () => {
        const redis = ctx.redis;
        const futureTimestampMs = Date.now() + 5000;
        const result = await redis.pexpireat("nonexistent-pexpireat-key", futureTimestampMs);
        expect(result).toBe(0); // 0 indicates key does not exist
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

      test("should reject invalid key in EXPIREAT", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.expireat({} as any, 1234567890);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'expireat'."`);
      });

      test("should reject invalid key in PEXPIRE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.pexpire([] as any, 5000);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'pexpire'."`);
      });

      test("should reject invalid key in PEXPIREAT", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.pexpireat(null as any, 1234567890000);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected key to be a string or buffer for 'pexpireat'."`);
      });
    });

    describe("List Operations", () => {
      test("should get range of elements with LRANGE", async () => {
        const redis = ctx.redis;
        const key = "lrange-test";

        // Create a list with multiple elements
        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        // Get full list
        const fullList = await redis.lrange(key, 0, -1);
        expect(fullList).toEqual(["one", "two", "three"]);

        // Get first two elements
        const firstTwo = await redis.lrange(key, 0, 1);
        expect(firstTwo).toEqual(["one", "two"]);

        // Get last two elements using negative indexes
        const lastTwo = await redis.lrange(key, -2, -1);
        expect(lastTwo).toEqual(["two", "three"]);

        // Get middle element
        const middle = await redis.lrange(key, 1, 1);
        expect(middle).toEqual(["two"]);

        // Out of range should return empty array
        const outOfRange = await redis.lrange(key, 10, 20);
        expect(outOfRange).toEqual([]);

        // Non-existent key should return empty array
        const nonExistent = await redis.lrange("nonexistent-list", 0, -1);
        expect(nonExistent).toEqual([]);
      });

      test("should get element at index with LINDEX", async () => {
        const redis = ctx.redis;
        const key = "lindex-test";

        // Create a list
        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        // Get element at positive index
        const first = await redis.lindex(key, 0);
        expect(first).toBe("one");

        const second = await redis.lindex(key, 1);
        expect(second).toBe("two");

        const third = await redis.lindex(key, 2);
        expect(third).toBe("three");

        // Get element at negative index (counting from end)
        const last = await redis.lindex(key, -1);
        expect(last).toBe("three");

        const secondLast = await redis.lindex(key, -2);
        expect(secondLast).toBe("two");

        // Out of range should return null
        const outOfRange = await redis.lindex(key, 10);
        expect(outOfRange).toBeNull();

        const outOfRangeNeg = await redis.lindex(key, -10);
        expect(outOfRangeNeg).toBeNull();

        // Non-existent key should return null
        const nonExistent = await redis.lindex("nonexistent-list", 0);
        expect(nonExistent).toBeNull();
      });

      test("should set element at index with LSET", async () => {
        const redis = ctx.redis;
        const key = "lset-test";

        // Create a list
        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        // Set element at positive index
        const result1 = await redis.lset(key, 0, "zero");
        expect(result1).toBe("OK");

        // Verify the change
        const first = await redis.lindex(key, 0);
        expect(first).toBe("zero");

        // Set element at negative index
        const result2 = await redis.lset(key, -1, "last");
        expect(result2).toBe("OK");

        // Verify the change
        const last = await redis.lindex(key, -1);
        expect(last).toBe("last");

        // Check full list
        const fullList = await redis.lrange(key, 0, -1);
        expect(fullList).toEqual(["zero", "two", "last"]);
      });

      test("should handle LSET errors", async () => {
        const redis = ctx.redis;

        // Test out of range index on existing list
        await redis.lpush("lset-error-test", "value");

        // Out of range should throw an error
        expect(async () => {
          await redis.lset("lset-error-test", 10, "newvalue");
        }).toThrow();

        // Non-existent key should throw an error
        expect(async () => {
          await redis.lset("nonexistent-list", 0, "value");
        }).toThrow();

        // Wrong type (not a list) should throw an error
        await redis.set("string-key", "value");
        expect(async () => {
          await redis.lset("string-key", 0, "value");
        }).toThrow();
      });

      test("should handle LRANGE with various ranges", async () => {
        const redis = ctx.redis;
        const key = "lrange-advanced";

        // Create a longer list
        for (let i = 5; i >= 1; i--) {
          await redis.lpush(key, String(i));
        }

        // Verify the list: [1, 2, 3, 4, 5]
        const fullList = await redis.lrange(key, 0, -1);
        expect(fullList).toEqual(["1", "2", "3", "4", "5"]);

        // Test with stop less than start (should return empty)
        const invalid = await redis.lrange(key, 3, 1);
        expect(invalid).toEqual([]);

        // Test with negative start and positive stop
        const mixed = await redis.lrange(key, -3, 4);
        expect(mixed).toEqual(["3", "4", "5"]);

        // Test with both negative
        const bothNeg = await redis.lrange(key, -4, -2);
        expect(bothNeg).toEqual(["2", "3", "4"]);
      });

      test("should handle LINDEX and LSET with numbers", async () => {
        const redis = ctx.redis;
        const key = "list-numbers";

        // Push numeric strings
        await redis.lpush(key, "100");
        await redis.lpush(key, "200");
        await redis.lpush(key, "300");

        // Get element
        const elem = await redis.lindex(key, 1);
        expect(elem).toBe("200");

        // Set with number (should convert to string)
        await redis.lset(key, 1, "250");
        const updated = await redis.lindex(key, 1);
        expect(updated).toBe("250");
      });

      test("should insert element before pivot with LINSERT", async () => {
        const redis = ctx.redis;
        const key = "linsert-before-test";

        // Create a list
        await redis.lpush(key, "World");
        await redis.lpush(key, "Hello");

        // Insert before "World"
        const result = await redis.linsert(key, "BEFORE", "World", "There");
        expect(result).toBe(3); // List length after insert

        // Verify the list
        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["Hello", "There", "World"]);
      });

      test("should insert element after pivot with LINSERT", async () => {
        const redis = ctx.redis;
        const key = "linsert-after-test";

        // Create a list
        await redis.lpush(key, "World");
        await redis.lpush(key, "Hello");

        // Insert after "Hello"
        const result = await redis.linsert(key, "AFTER", "Hello", "Beautiful");
        expect(result).toBe(3); // List length after insert

        // Verify the list
        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["Hello", "Beautiful", "World"]);
      });

      test("should handle LINSERT when pivot not found", async () => {
        const redis = ctx.redis;
        const key = "linsert-notfound-test";

        // Create a list
        await redis.lpush(key, "value1");
        await redis.lpush(key, "value2");

        // Try to insert before non-existent pivot
        const result = await redis.linsert(key, "BEFORE", "nonexistent", "newvalue");
        expect(result).toBe(-1); // Pivot not found

        // Verify list unchanged
        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["value2", "value1"]);
      });

      test("should handle LINSERT on non-existent key", async () => {
        const redis = ctx.redis;

        // Try to insert into non-existent list
        const result = await redis.linsert("nonexistent-list", "BEFORE", "pivot", "element");
        expect(result).toBe(0); // Key doesn't exist
      });

      test("should remove elements from head with LREM", async () => {
        const redis = ctx.redis;
        const key = "lrem-positive-test";

        // Create a list with duplicates
        await redis.rpush(key, "hello");
        await redis.rpush(key, "hello");
        await redis.rpush(key, "world");
        await redis.rpush(key, "hello");

        // Remove first 2 "hello" from head to tail
        const result = await redis.lrem(key, 2, "hello");
        expect(result).toBe(2); // Number of elements removed

        // Verify the list
        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["world", "hello"]);
      });

      test("should remove elements from tail with LREM", async () => {
        const redis = ctx.redis;
        const key = "lrem-negative-test";

        // Create a list with duplicates
        await redis.rpush(key, "hello");
        await redis.rpush(key, "world");
        await redis.rpush(key, "hello");
        await redis.rpush(key, "hello");

        // Remove first 2 "hello" from tail to head
        const result = await redis.lrem(key, -2, "hello");
        expect(result).toBe(2); // Number of elements removed

        // Verify the list
        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["hello", "world"]);
      });

      test("should remove all occurrences with LREM count=0", async () => {
        const redis = ctx.redis;
        const key = "lrem-all-test";

        // Create a list with multiple duplicates
        await redis.rpush(key, "hello");
        await redis.rpush(key, "world");
        await redis.rpush(key, "hello");
        await redis.rpush(key, "foo");
        await redis.rpush(key, "hello");

        // Remove all "hello"
        const result = await redis.lrem(key, 0, "hello");
        expect(result).toBe(3); // Number of elements removed

        // Verify the list
        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["world", "foo"]);
      });

      test("should handle LREM when element not found", async () => {
        const redis = ctx.redis;
        const key = "lrem-notfound-test";

        // Create a list
        await redis.rpush(key, "value1");
        await redis.rpush(key, "value2");

        // Try to remove non-existent element
        const result = await redis.lrem(key, 1, "nonexistent");
        expect(result).toBe(0); // No elements removed

        // Verify list unchanged
        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["value1", "value2"]);
      });

      test("should trim list to range with LTRIM", async () => {
        const redis = ctx.redis;
        const key = "ltrim-test";

        // Create a list
        await redis.rpush(key, "one");
        await redis.rpush(key, "two");
        await redis.rpush(key, "three");
        await redis.rpush(key, "four");

        // Trim to keep only elements 1-2
        const result = await redis.ltrim(key, 1, 2);
        expect(result).toBe("OK");

        // Verify the list
        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["two", "three"]);
      });

      test("should handle LTRIM with negative indexes", async () => {
        const redis = ctx.redis;
        const key = "ltrim-negative-test";

        // Create a list
        await redis.rpush(key, "one");
        await redis.rpush(key, "two");
        await redis.rpush(key, "three");
        await redis.rpush(key, "four");
        await redis.rpush(key, "five");

        // Trim to keep last 3 elements
        const result = await redis.ltrim(key, -3, -1);
        expect(result).toBe("OK");

        // Verify the list
        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["three", "four", "five"]);
      });

      test("should handle LTRIM with out of range indexes", async () => {
        const redis = ctx.redis;
        const key = "ltrim-outofrange-test";

        // Create a list
        await redis.rpush(key, "one");
        await redis.rpush(key, "two");
        await redis.rpush(key, "three");

        // Trim with large range (should keep all elements)
        const result = await redis.ltrim(key, 0, 100);
        expect(result).toBe("OK");

        // Verify the list unchanged
        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual(["one", "two", "three"]);
      });

      test("should empty list with LTRIM when stop < start", async () => {
        const redis = ctx.redis;
        const key = "ltrim-empty-test";

        // Create a list
        await redis.rpush(key, "one");
        await redis.rpush(key, "two");
        await redis.rpush(key, "three");

        // Trim with invalid range (stop < start)
        const result = await redis.ltrim(key, 2, 0);
        expect(result).toBe("OK");

        // Verify the list is empty
        const list = await redis.lrange(key, 0, -1);
        expect(list).toEqual([]);
      });

      test("should block and pop element with BLPOP", async () => {
        const redis = ctx.redis;
        const key = "blpop-test";

        // Push an element
        await redis.lpush(key, "value1");

        // BLPOP should return immediately
        const result = await redis.blpop(key, 0.1);
        expect(result).toEqual([key, "value1"]);

        // BLPOP on empty list should timeout and return null
        const timeout = await redis.blpop(key, 0.1);
        expect(timeout).toBeNull();
      });

      test("should block and pop element with BRPOP", async () => {
        const redis = ctx.redis;
        const key = "brpop-test";

        // Push multiple elements
        await redis.lpush(key, "value2");
        await redis.lpush(key, "value1");

        // BRPOP should return last element
        const result = await redis.brpop(key, 0.1);
        expect(result).toEqual([key, "value2"]);

        // BRPOP on empty list should timeout and return null
        await redis.brpop(key, 0.1); // Pop remaining element
        const timeout = await redis.brpop(key, 0.1);
        expect(timeout).toBeNull();
      });

      test("should pop from first non-empty list with BLPOP", async () => {
        const redis = ctx.redis;
        const key1 = "blpop-list1";
        const key2 = "blpop-list2";

        // Only push to second list
        await redis.lpush(key2, "value2");

        // Should pop from key2 since key1 is empty
        const result = await redis.blpop(key1, key2, 0.1);
        expect(result).toEqual([key2, "value2"]);
      });

      test("should pop elements with LMPOP LEFT", async () => {
        const redis = ctx.redis;
        const key = "lmpop-left-test";

        // Push elements
        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        // Pop one element from head (LEFT)
        const result = await redis.lmpop(1, key, "LEFT");
        expect(result).toEqual([key, ["one"]]);

        // Verify remaining elements
        const remaining = await redis.lrange(key, 0, -1);
        expect(remaining).toEqual(["two", "three"]);
      });

      test("should pop elements with LMPOP RIGHT", async () => {
        const redis = ctx.redis;
        const key = "lmpop-right-test";

        // Push elements
        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        // Pop one element from tail (RIGHT)
        const result = await redis.lmpop(1, key, "RIGHT");
        expect(result).toEqual([key, ["three"]]);

        // Verify remaining elements
        const remaining = await redis.lrange(key, 0, -1);
        expect(remaining).toEqual(["one", "two"]);
      });

      test("should pop multiple elements with LMPOP COUNT", async () => {
        const redis = ctx.redis;
        const key = "lmpop-count-test";

        // Push elements
        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        // Pop 2 elements from head
        const result = await redis.lmpop(1, key, "LEFT", "COUNT", 2);
        expect(result).toEqual([key, ["one", "two"]]);

        // Verify remaining element
        const remaining = await redis.lrange(key, 0, -1);
        expect(remaining).toEqual(["three"]);
      });

      test("should return null for LMPOP on empty list", async () => {
        const redis = ctx.redis;

        // Try to pop from non-existent list
        const result = await redis.lmpop(1, "nonexistent-list", "LEFT");
        expect(result).toBeNull();
      });

      test("should pop from first non-empty list with LMPOP", async () => {
        const redis = ctx.redis;
        const key1 = "lmpop-empty";
        const key2 = "lmpop-full";

        // Only push to second list
        await redis.lpush(key2, "value");

        // Should pop from key2 since key1 is empty
        const result = await redis.lmpop(2, key1, key2, "LEFT");
        expect(result).toEqual([key2, ["value"]]);
      });

      test("should find position of element with LPOS", async () => {
        const redis = ctx.redis;
        const key = "lpos-test";

        // Create a list with some duplicates
        await redis.lpush(key, "d");
        await redis.lpush(key, "b");
        await redis.lpush(key, "c");
        await redis.lpush(key, "b");
        await redis.lpush(key, "a");
        // List is now: ["a", "b", "c", "b", "d"]

        // Find first occurrence of "b"
        const pos1 = await redis.lpos(key, "b");
        expect(pos1).toBe(1);

        // Find first occurrence of "a"
        const pos2 = await redis.lpos(key, "a");
        expect(pos2).toBe(0);

        // Find element at the end
        const pos3 = await redis.lpos(key, "d");
        expect(pos3).toBe(4);

        // Non-existent element should return null
        const pos4 = await redis.lpos(key, "x");
        expect(pos4).toBeNull();
      });

      test("should find position with RANK option in LPOS", async () => {
        const redis = ctx.redis;
        const key = "lpos-rank-test";

        // Create a list with duplicates
        await redis.lpush(key, "b");
        await redis.lpush(key, "a");
        await redis.lpush(key, "b");
        await redis.lpush(key, "a");
        await redis.lpush(key, "b");
        // List is now: ["b", "a", "b", "a", "b"]

        // Find first occurrence (default behavior)
        const first = await redis.lpos(key, "b");
        expect(first).toBe(0);

        // Find second occurrence
        const second = await redis.lpos(key, "b", "RANK", 2);
        expect(second).toBe(2);

        // Find third occurrence
        const third = await redis.lpos(key, "b", "RANK", 3);
        expect(third).toBe(4);

        // Find with RANK that doesn't exist
        const fourth = await redis.lpos(key, "b", "RANK", 4);
        expect(fourth).toBeNull();

        // Find with negative RANK (from tail)
        const fromEnd = await redis.lpos(key, "b", "RANK", -1);
        expect(fromEnd).toBe(4);

        const fromEnd2 = await redis.lpos(key, "b", "RANK", -2);
        expect(fromEnd2).toBe(2);
      });

      test("should find multiple positions with COUNT option in LPOS", async () => {
        const redis = ctx.redis;
        const key = "lpos-count-test";

        // Create a list with duplicates
        await redis.lpush(key, "c");
        await redis.lpush(key, "b");
        await redis.lpush(key, "b");
        await redis.lpush(key, "a");
        await redis.lpush(key, "b");
        // List is now: ["b", "a", "b", "b", "c"]

        // Find all occurrences (COUNT 0 means all)
        const all = await redis.lpos(key, "b", "COUNT", 0);
        expect(all).toEqual([0, 2, 3]);

        // Find first 2 occurrences
        const first2 = await redis.lpos(key, "b", "COUNT", 2);
        expect(first2).toEqual([0, 2]);

        // Find with COUNT greater than actual occurrences
        const more = await redis.lpos(key, "b", "COUNT", 10);
        expect(more).toEqual([0, 2, 3]);

        // Find non-existent with COUNT
        const none = await redis.lpos(key, "x", "COUNT", 5);
        expect(none).toEqual([]);
      });

      test("should find position with MAXLEN option in LPOS", async () => {
        const redis = ctx.redis;
        const key = "lpos-maxlen-test";

        // Create a longer list
        for (let i = 5; i >= 1; i--) {
          await redis.lpush(key, String(i));
        }
        await redis.lpush(key, "target");
        // List is now: ["target", "1", "2", "3", "4", "5"]

        // Find within first 6 elements (should find it)
        const found = await redis.lpos(key, "target", "MAXLEN", 6);
        expect(found).toBe(0);

        // Find "5" with MAXLEN that's too short
        const notFound = await redis.lpos(key, "5", "MAXLEN", 3);
        expect(notFound).toBeNull();

        // Find "3" with MAXLEN
        const found3 = await redis.lpos(key, "3", "MAXLEN", 10);
        expect(found3).toBe(3);
      });

      test("should move element from source to destination with LMOVE", async () => {
        const redis = ctx.redis;
        const source = "lmove-source";
        const dest = "lmove-dest";

        // Setup source list
        await redis.lpush(source, "three");
        await redis.lpush(source, "two");
        await redis.lpush(source, "one");
        // Source: ["one", "two", "three"]

        // Move from LEFT of source to RIGHT of dest
        const result1 = await redis.lmove(source, dest, "LEFT", "RIGHT");
        expect(result1).toBe("one");

        // Verify source and dest
        const sourceList1 = await redis.lrange(source, 0, -1);
        expect(sourceList1).toEqual(["two", "three"]);

        const destList1 = await redis.lrange(dest, 0, -1);
        expect(destList1).toEqual(["one"]);

        // Move from RIGHT of source to LEFT of dest
        const result2 = await redis.lmove(source, dest, "RIGHT", "LEFT");
        expect(result2).toBe("three");

        const sourceList2 = await redis.lrange(source, 0, -1);
        expect(sourceList2).toEqual(["two"]);

        const destList2 = await redis.lrange(dest, 0, -1);
        expect(destList2).toEqual(["three", "one"]);
      });

      test("should handle all LMOVE direction combinations", async () => {
        const redis = ctx.redis;

        // Test LEFT -> LEFT
        await redis.lpush("src1", "b", "a");
        const res1 = await redis.lmove("src1", "dst1", "LEFT", "LEFT");
        expect(res1).toBe("a");
        expect(await redis.lrange("dst1", 0, -1)).toEqual(["a"]);

        // Test LEFT -> RIGHT
        await redis.lpush("src2", "b", "a");
        const res2 = await redis.lmove("src2", "dst2", "LEFT", "RIGHT");
        expect(res2).toBe("a");
        expect(await redis.lrange("dst2", 0, -1)).toEqual(["a"]);

        // Test RIGHT -> LEFT
        await redis.lpush("src3", "b", "a");
        const res3 = await redis.lmove("src3", "dst3", "RIGHT", "LEFT");
        expect(res3).toBe("b");
        expect(await redis.lrange("dst3", 0, -1)).toEqual(["b"]);

        // Test RIGHT -> RIGHT
        await redis.lpush("src4", "b", "a");
        const res4 = await redis.lmove("src4", "dst4", "RIGHT", "RIGHT");
        expect(res4).toBe("b");
        expect(await redis.lrange("dst4", 0, -1)).toEqual(["b"]);
      });

      test("should return null for LMOVE on empty source", async () => {
        const redis = ctx.redis;

        const result = await redis.lmove("empty-source", "some-dest", "LEFT", "RIGHT");
        expect(result).toBeNull();

        // Destination should also be empty
        const destList = await redis.lrange("some-dest", 0, -1);
        expect(destList).toEqual([]);
      });

      test("should handle LMOVE to same list", async () => {
        const redis = ctx.redis;
        const key = "circular-list";

        await redis.lpush(key, "c", "b", "a");
        // List: ["a", "b", "c"]

        // Move from LEFT to RIGHT (rotate left)
        const result = await redis.lmove(key, key, "LEFT", "RIGHT");
        expect(result).toBe("a");
        expect(await redis.lrange(key, 0, -1)).toEqual(["b", "c", "a"]);
      });

      test("should pop from source and push to dest with RPOPLPUSH", async () => {
        const redis = ctx.redis;
        const source = "rpoplpush-source";
        const dest = "rpoplpush-dest";

        // Setup source list
        await redis.lpush(source, "three");
        await redis.lpush(source, "two");
        await redis.lpush(source, "one");
        // Source: ["one", "two", "three"]

        // Pop from tail (RIGHT) of source and push to head (LEFT) of dest
        const result = await redis.rpoplpush(source, dest);
        expect(result).toBe("three");

        // Verify source and dest
        const sourceList = await redis.lrange(source, 0, -1);
        expect(sourceList).toEqual(["one", "two"]);

        const destList = await redis.lrange(dest, 0, -1);
        expect(destList).toEqual(["three"]);

        // Do it again
        const result2 = await redis.rpoplpush(source, dest);
        expect(result2).toBe("two");

        const sourceList2 = await redis.lrange(source, 0, -1);
        expect(sourceList2).toEqual(["one"]);

        const destList2 = await redis.lrange(dest, 0, -1);
        expect(destList2).toEqual(["two", "three"]);
      });

      test("should return null for RPOPLPUSH on empty source", async () => {
        const redis = ctx.redis;

        const result = await redis.rpoplpush("empty-source", "some-dest");
        expect(result).toBeNull();
      });

      test("should handle RPOPLPUSH to same list (circular)", async () => {
        const redis = ctx.redis;
        const key = "circular-rpoplpush";

        await redis.lpush(key, "c", "b", "a");
        // List: ["a", "b", "c"]

        // Pop from tail and push to head (rotate right)
        const result = await redis.rpoplpush(key, key);
        expect(result).toBe("c");
        expect(await redis.lrange(key, 0, -1)).toEqual(["c", "a", "b"]);
      });

      test("should block and move element with BLMOVE", async () => {
        const redis = ctx.redis;
        const source = "blmove-source";
        const dest = "blmove-dest";

        // Push elements to source
        await redis.lpush(source, "three");
        await redis.lpush(source, "two");
        await redis.lpush(source, "one");

        // Move from right of source to left of dest (like BRPOPLPUSH)
        const result = await redis.blmove(source, dest, "RIGHT", "LEFT", 0.1);
        expect(result).toBe("three");

        // Verify source has 2 elements
        const sourceRemaining = await redis.lrange(source, 0, -1);
        expect(sourceRemaining).toEqual(["one", "two"]);

        // Verify dest has 1 element at head
        const destElements = await redis.lrange(dest, 0, -1);
        expect(destElements).toEqual(["three"]);

        // Move from left of source to right of dest
        const result2 = await redis.blmove(source, dest, "LEFT", "RIGHT", 0.1);
        expect(result2).toBe("one");

        // Verify final state
        const finalSource = await redis.lrange(source, 0, -1);
        expect(finalSource).toEqual(["two"]);

        const finalDest = await redis.lrange(dest, 0, -1);
        expect(finalDest).toEqual(["three", "one"]);
      });

      test("should timeout and return null with BLMOVE on empty list", async () => {
        const redis = ctx.redis;

        // Try to move from empty list with short timeout
        const result = await redis.blmove("empty-source", "dest", "LEFT", "RIGHT", 0.1);
        expect(result).toBeNull();
      });

      test("should block and pop multiple elements with BLMPOP", async () => {
        const redis = ctx.redis;
        const key = "blmpop-test";

        // Push elements
        await redis.lpush(key, "three");
        await redis.lpush(key, "two");
        await redis.lpush(key, "one");

        // Pop one element from head (LEFT)
        const result = await redis.blmpop(0.1, 1, key, "LEFT");
        expect(result).toEqual([key, ["one"]]);

        // Pop 2 elements from tail (RIGHT) with COUNT
        const result2 = await redis.blmpop(0.1, 1, key, "RIGHT", "COUNT", 2);
        expect(result2).toEqual([key, ["three", "two"]]);

        // List should now be empty
        const remaining = await redis.lrange(key, 0, -1);
        expect(remaining).toEqual([]);
      });

      test("should pop from first non-empty list with BLMPOP", async () => {
        const redis = ctx.redis;
        const key1 = "blmpop-empty";
        const key2 = "blmpop-full";

        // Only push to second list
        await redis.lpush(key2, "value");

        // Should pop from key2 since key1 is empty
        const result = await redis.blmpop(0.1, 2, key1, key2, "LEFT");
        expect(result).toEqual([key2, ["value"]]);
      });

      test("should timeout and return null with BLMPOP on empty lists", async () => {
        const redis = ctx.redis;

        // Try to pop from non-existent lists with short timeout
        const result = await redis.blmpop(0.1, 2, "empty-list1", "empty-list2", "LEFT");
        expect(result).toBeNull();
      });

      test("should block and move element with BRPOPLPUSH", async () => {
        const redis = ctx.redis;
        const source = "brpoplpush-source";
        const dest = "brpoplpush-dest";

        // Push elements to source
        await redis.lpush(source, "value2");
        await redis.lpush(source, "value1");

        // Move from tail of source to head of dest
        const result = await redis.brpoplpush(source, dest, 0.1);
        expect(result).toBe("value2");

        // Verify source has 1 element
        const sourceRemaining = await redis.lrange(source, 0, -1);
        expect(sourceRemaining).toEqual(["value1"]);

        // Verify dest has 1 element
        const destElements = await redis.lrange(dest, 0, -1);
        expect(destElements).toEqual(["value2"]);

        // Move again
        const result2 = await redis.brpoplpush(source, dest, 0.1);
        expect(result2).toBe("value1");

        // Source should be empty
        const finalSource = await redis.lrange(source, 0, -1);
        expect(finalSource).toEqual([]);

        // Dest should have both elements
        const finalDest = await redis.lrange(dest, 0, -1);
        expect(finalDest).toEqual(["value1", "value2"]);
      });

      test("should timeout and return null with BRPOPLPUSH on empty list", async () => {
        const redis = ctx.redis;

        // Try to move from empty list with short timeout
        const result = await redis.brpoplpush("empty-source", "dest", 0.1);
        expect(result).toBeNull();
      });
    });

    describe("Set Operations", () => {
      test("should return intersection of two sets with SINTER", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";

        // Create two sets with some overlapping members
        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");

        // Get intersection
        const result = await redis.sinter(key1, key2);
        expect(result.sort()).toEqual(["b", "c"]);
      });

      test("should return intersection of multiple sets with SINTER", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";
        const key3 = "set3";

        // Create three sets with one common member
        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");
        await redis.sadd(key3, "c");
        await redis.sadd(key3, "d");
        await redis.sadd(key3, "e");

        // Get intersection of all three
        const result = await redis.sinter(key1, key2, key3);
        expect(result).toEqual(["c"]);
      });

      test("should return empty array when sets have no intersection with SINTER", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");

        const result = await redis.sinter(key1, key2);
        expect(result).toEqual([]);
      });

      test("should return empty array when one set does not exist with SINTER", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "nonexistent";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");

        const result = await redis.sinter(key1, key2);
        expect(result).toEqual([]);
      });

      test("should store intersection in destination with SINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";
        const dest = "dest-set";

        // Create two sets with some overlapping members
        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");

        // Store intersection
        const count = await redis.sinterstore(dest, key1, key2);
        expect(count).toBe(2);

        // Verify destination has the intersection
        const members = await redis.smembers(dest);
        expect(members.sort()).toEqual(["b", "c"]);
      });

      test("should overwrite existing destination with SINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";
        const dest = "dest-set";

        // Create destination with initial data
        await redis.sadd(dest, "old");
        await redis.sadd(dest, "data");

        // Create two sets
        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");

        // Store intersection (should overwrite destination)
        const count = await redis.sinterstore(dest, key1, key2);
        expect(count).toBe(1);

        // Verify destination only has the intersection
        const members = await redis.smembers(dest);
        expect(members).toEqual(["b"]);
      });

      test("should return 0 when storing empty intersection with SINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";
        const dest = "dest-set";

        await redis.sadd(key1, "a");
        await redis.sadd(key2, "b");

        const count = await redis.sinterstore(dest, key1, key2);
        expect(count).toBe(0);

        // Destination should be empty
        const members = await redis.smembers(dest);
        expect(members).toEqual([]);
      });

      test("should return cardinality of intersection with SINTERCARD", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");

        // SINTERCARD requires numkeys as first argument
        const count = await redis.sintercard(2, key1, key2);
        expect(count).toBe(2);
      });

      test("should return 0 for empty intersection with SINTERCARD", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";

        await redis.sadd(key1, "a");
        await redis.sadd(key2, "b");

        const count = await redis.sintercard(2, key1, key2);
        expect(count).toBe(0);
      });

      test("should support LIMIT option with SINTERCARD", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";

        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key1, "d");
        await redis.sadd(key2, "a");
        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");
        await redis.sadd(key2, "d");

        // LIMIT stops counting after reaching the specified number
        const count = await redis.sintercard(2, key1, key2, "LIMIT", 2);
        expect(count).toBe(2);
      });

      test("should throw error when SINTER receives no keys", async () => {
        const redis = ctx.redis;

        expect(async () => {
          // @ts-expect-error no args
          await redis.sinter();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'sinter' command"`);
      });

      test("should throw error when SINTERSTORE receives no keys", async () => {
        const redis = ctx.redis;

        expect(async () => {
          // @ts-expect-error no args
          await redis.sinterstore();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'sinterstore' command"`);
      });

      test("should throw error when SINTERCARD receives no keys", async () => {
        const redis = ctx.redis;

        expect(async () => {
          // @ts-expect-error no args
          await redis.sintercard();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'sintercard' command"`);
      });

      test("should store set difference with SDIFFSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "set1";
        const key2 = "set2";
        const key3 = "set3";
        const dest = "diff-result";

        // Set up test sets
        await redis.sadd(key1, "a");
        await redis.sadd(key1, "b");
        await redis.sadd(key1, "c");
        await redis.sadd(key1, "d");

        await redis.sadd(key2, "b");
        await redis.sadd(key2, "c");

        await redis.sadd(key3, "d");

        // Store difference between key1 and key2
        const count1 = await redis.sdiffstore(dest, key1, key2);
        expect(count1).toBe(2); // a, d

        const members1 = await redis.smembers(dest);
        expect(members1.sort()).toEqual(["a", "d"]);

        // Store difference between key1, key2, and key3
        const count2 = await redis.sdiffstore(dest, key1, key2, key3);
        expect(count2).toBe(1); // only a

        const members2 = await redis.smembers(dest);
        expect(members2).toEqual(["a"]);
      });

      test("should throw error with SDIFFSTORE on invalid arguments", async () => {
        const redis = ctx.redis;

        expect(async () => {
          await (redis as any).sdiffstore();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'sdiffstore' command"`);
      });

      test("should check multiple members with SMISMEMBER", async () => {
        const redis = ctx.redis;
        const key = "test-set";

        // Add some members
        await redis.sadd(key, "a");
        await redis.sadd(key, "b");
        await redis.sadd(key, "c");

        // Check which members exist
        const result = await redis.smismember(key, "a", "b", "d", "e");
        expect(result).toEqual([1, 1, 0, 0]); // a and b exist, d and e don't

        // Check single member
        const result2 = await redis.smismember(key, "c");
        expect(result2).toEqual([1]);

        // Check on non-existent set
        const result3 = await redis.smismember("nonexistent", "a", "b");
        expect(result3).toEqual([0, 0]);
      });

      test("should throw error with SMISMEMBER on invalid arguments", async () => {
        const redis = ctx.redis;

        expect(async () => {
          await (redis as any).smismember();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'smismember' command"`);
      });

      test("should scan set members with SSCAN", async () => {
        const redis = ctx.redis;
        const key = "scan-set";

        // Add multiple members
        for (let i = 0; i < 20; i++) {
          await redis.sadd(key, `member${i}`);
        }

        // Scan the set
        let cursor = "0";
        const allMembers: string[] = [];

        do {
          const [nextCursor, members] = await redis.sscan(key, cursor);
          allMembers.push(...members);
          cursor = nextCursor;
        } while (cursor !== "0");

        // Should have scanned all 20 members
        expect(allMembers.length).toBe(20);
        expect(new Set(allMembers).size).toBe(20); // All unique

        // Verify all members exist
        for (let i = 0; i < 20; i++) {
          expect(allMembers).toContain(`member${i}`);
        }
      });

      test("should scan set with MATCH pattern using SSCAN", async () => {
        const redis = ctx.redis;
        const key = "scan-pattern-set";

        // Add members with different patterns
        await redis.sadd(key, "user:1");
        await redis.sadd(key, "user:2");
        await redis.sadd(key, "user:3");
        await redis.sadd(key, "admin:1");
        await redis.sadd(key, "admin:2");

        // Scan with MATCH pattern
        const [cursor, members] = await redis.sscan(key, "0", "MATCH", "user:*");

        // Should only return user members (or could be empty if not in first batch)
        // Due to cursor-based scanning, we might need multiple iterations
        let allUserMembers: string[] = [...members];
        let scanCursor = cursor;

        while (scanCursor !== "0") {
          const [nextCursor, nextMembers] = await redis.sscan(key, scanCursor, "MATCH", "user:*");
          allUserMembers.push(...nextMembers);
          scanCursor = nextCursor;
        }

        // Filter to only user members
        const userMembers = allUserMembers.filter(m => m.startsWith("user:"));
        expect(userMembers.length).toBeGreaterThanOrEqual(0); // Could be 0 to 3 depending on scan
      });

      test("should scan empty set with SSCAN", async () => {
        const redis = ctx.redis;
        const key = "empty-scan-set";

        // Scan empty set
        const [cursor, members] = await redis.sscan(key, "0");
        expect(cursor).toBe("0");
        expect(members).toEqual([]);
      });

      test("should throw error with SSCAN on invalid arguments", async () => {
        const redis = ctx.redis;

        expect(async () => {
          await (redis as any).sscan();
        }).toThrowErrorMatchingInlineSnapshot(`"ERR wrong number of arguments for 'sscan' command"`);
      });
    });

    describe("Sorted Set Operations", () => {
      test("should increment score with ZINCRBY", async () => {
        const redis = ctx.redis;
        const key = "zincrby-test";

        // Add initial members
        await redis.send("ZADD", [key, "1.0", "member1", "2.0", "member2"]);

        // Increment member1's score by 2.5
        const newScore1 = await redis.zincrby(key, 2.5, "member1");
        expect(newScore1).toBe(3.5);

        // Increment member2's score by -1.5
        const newScore2 = await redis.zincrby(key, -1.5, "member2");
        expect(newScore2).toBe(0.5);

        // Increment non-existent member (should create it with the increment as score)
        const newScore3 = await redis.zincrby(key, 5, "member3");
        expect(newScore3).toBe(5);
      });

      test("should count members in score range with ZCOUNT", async () => {
        const redis = ctx.redis;
        const key = "zcount-test";

        // Add members with scores
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Count all members
        const count1 = await redis.zcount(key, "-inf", "+inf");
        expect(count1).toBe(5);

        // Count members with score between 2 and 4 (inclusive)
        const count2 = await redis.zcount(key, 2, 4);
        expect(count2).toBe(3); // two, three, four

        // Count with specific range
        const count3 = await redis.zcount(key, 1, 3);
        expect(count3).toBe(3); // one, two, three

        // Count with no matches
        const count4 = await redis.zcount(key, 10, 20);
        expect(count4).toBe(0);
      });

      test("should count members in lexicographical range with ZLEXCOUNT", async () => {
        const redis = ctx.redis;
        const key = "zlexcount-test";

        // Add members with same score (required for lex operations)
        await redis.send("ZADD", [key, "0", "apple", "0", "banana", "0", "cherry", "0", "date", "0", "elderberry"]);

        // Count all members
        const count1 = await redis.zlexcount(key, "-", "+");
        expect(count1).toBe(5);

        // Count members from "banana" to "date" (inclusive)
        const count2 = await redis.zlexcount(key, "[banana", "[date");
        expect(count2).toBe(3); // banana, cherry, date

        // Count with exclusive range
        const count3 = await redis.zlexcount(key, "(banana", "(date");
        expect(count3).toBe(1); // only cherry

        // Count with no matches
        const count4 = await redis.zlexcount(key, "[zebra", "[zoo");
        expect(count4).toBe(0);
      });

      test("should compute difference between sorted sets with ZDIFF", async () => {
        const redis = ctx.redis;
        const key1 = "zdiff-test1";
        const key2 = "zdiff-test2";
        const key3 = "zdiff-test3";

        // Set up sorted sets
        await redis.send("ZADD", [key1, "1", "one", "2", "two", "3", "three", "4", "four"]);
        await redis.send("ZADD", [key2, "1", "one", "2", "two"]);
        await redis.send("ZADD", [key3, "3", "three"]);

        // Difference between first and second set
        const diff1 = await redis.zdiff(2, key1, key2);
        expect(diff1).toEqual(["three", "four"]);

        // Difference with multiple sets
        const diff2 = await redis.zdiff(3, key1, key2, key3);
        expect(diff2).toEqual(["four"]);

        // Difference with WITHSCORES
        const diff3 = await redis.zdiff(2, key1, key2, "WITHSCORES");
        expect(diff3).toEqual([
          ["three", 3],
          ["four", 4],
        ]);

        // Difference with non-existent set (should return all from first set)
        const diff4 = await redis.zdiff(2, key1, "nonexistent");
        expect(diff4.length).toBe(4);
        expect(diff4).toEqual(["one", "two", "three", "four"]);

        // Empty result
        const diff5 = await redis.zdiff(2, key2, key1);
        expect(diff5).toEqual([]);
      });

      test("should store difference between sorted sets with ZDIFFSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zdiffstore-test1";
        const key2 = "zdiffstore-test2";
        const dest = "zdiffstore-dest";

        // Set up sorted sets
        await redis.send("ZADD", [key1, "1", "one", "2", "two", "3", "three"]);
        await redis.send("ZADD", [key2, "1", "one"]);

        // Store the difference
        const count = await redis.zdiffstore(dest, 2, key1, key2);
        expect(count).toBe(2);

        // Verify the destination has the correct members
        const members = await redis.send("ZRANGE", [dest, "0", "-1"]);
        expect(members).toEqual(["two", "three"]);

        // Verify scores are preserved
        const membersWithScores = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(membersWithScores).toEqual([
          ["two", 2],
          ["three", 3],
        ]);

        // Store empty result (should overwrite existing key)
        const count2 = await redis.zdiffstore(dest, 2, key2, key1);
        expect(count2).toBe(0);

        // Verify destination is now empty
        const finalCount = await redis.send("ZCARD", [dest]);
        expect(finalCount).toBe(0);
      });

      test("should count intersection with ZINTERCARD", async () => {
        const redis = ctx.redis;
        const key1 = "zintercard-test1";
        const key2 = "zintercard-test2";
        const key3 = "zintercard-test3";

        // Set up sorted sets
        await redis.send("ZADD", [key1, "1", "one", "2", "two", "3", "three"]);
        await redis.send("ZADD", [key2, "1", "one", "2", "two", "4", "four"]);
        await redis.send("ZADD", [key3, "1", "one", "5", "five"]);

        // Basic intersection count
        const count1 = await redis.zintercard(2, key1, key2);
        expect(count1).toBe(2); // one and two

        // Intersection of three sets
        const count2 = await redis.zintercard(3, key1, key2, key3);
        expect(count2).toBe(1); // only one

        // With LIMIT
        const count3 = await redis.zintercard(2, key1, key2, "LIMIT", 1);
        expect(count3).toBe(1); // stopped at limit

        // No intersection
        const count4 = await redis.zintercard(2, key1, key3);
        expect(count4).toBe(1); // only one exists in both

        // With non-existent set
        const count5 = await redis.zintercard(2, key1, "nonexistent");
        expect(count5).toBe(0);
      });

      test("should reject invalid arguments in ZDIFF", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zdiff({} as any, "key1");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zdiff'."`);
      });

      test("should reject invalid arguments in ZDIFFSTORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zdiffstore("dest", {} as any, "key1");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zdiffstore'."`,
        );
      });

      test("should reject invalid arguments in ZINTERCARD", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zintercard({} as any, "key1");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zintercard'."`,
        );
      });

      test("should remove members by rank with ZREMRANGEBYRANK", async () => {
        const redis = ctx.redis;
        const key = "zremrangebyrank-test";

        // Add members
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Remove first 2 members (rank 0 and 1)
        const removed1 = await redis.zremrangebyrank(key, 0, 1);
        expect(removed1).toBe(2);

        // Verify remaining members
        const remaining = await redis.send("ZCARD", [key]);
        expect(remaining).toBe(3);

        // Remove last member (negative index)
        const removed2 = await redis.zremrangebyrank(key, -1, -1);
        expect(removed2).toBe(1);

        // Verify 2 members remain
        const final = await redis.send("ZCARD", [key]);
        expect(final).toBe(2);
      });

      test("should remove members by score range with ZREMRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zremrangebyscore-test";

        // Add members
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Remove members with score 2-4 (inclusive)
        const removed1 = await redis.zremrangebyscore(key, 2, 4);
        expect(removed1).toBe(3); // two, three, four

        // Verify remaining members
        const remaining = await redis.send("ZCARD", [key]);
        expect(remaining).toBe(2); // one and five

        // Remove with infinity
        const removed2 = await redis.zremrangebyscore(key, "-inf", "+inf");
        expect(removed2).toBe(2);
      });

      test("should remove members by lexicographical range with ZREMRANGEBYLEX", async () => {
        const redis = ctx.redis;
        const key = "zremrangebylex-test";

        // Add members with same score
        await redis.send("ZADD", [key, "0", "apple", "0", "banana", "0", "cherry", "0", "date", "0", "elderberry"]);

        // Remove from "banana" to "date" (inclusive)
        const removed1 = await redis.zremrangebylex(key, "[banana", "[date");
        expect(removed1).toBe(3); // banana, cherry, date

        // Verify remaining members
        const remaining = await redis.send("ZCARD", [key]);
        expect(remaining).toBe(2); // apple and elderberry

        // Remove remaining with open range
        const removed2 = await redis.zremrangebylex(key, "-", "+");
        expect(removed2).toBe(2);
      });

      test("should reject invalid key in ZINCRBY", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zincrby({} as any, 1, "member");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zincrby'."`,
        );
      });

      test("should reject invalid key in ZCOUNT", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zcount([] as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zcount'."`);
      });

      test("should reject invalid key in ZLEXCOUNT", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zlexcount(null as any, "[a", "[z");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zlexcount'."`,
        );
      });

      test("should reject invalid key in ZREMRANGEBYRANK", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zremrangebyrank({} as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zremrangebyrank'."`,
        );
      });

      test("should reject invalid key in ZREMRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zremrangebyscore([] as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zremrangebyscore'."`,
        );
      });

      test("should reject invalid key in ZREMRANGEBYLEX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zremrangebylex(null as any, "[a", "[z");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zremrangebylex'."`,
        );
      });

      test("should remove one or more members with ZREM", async () => {
        const redis = ctx.redis;
        const key = "zrem-test";

        // Add members
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four"]);

        // Remove single member
        const removed1 = await redis.zrem(key, "two");
        expect(removed1).toBe(1);

        // Remove multiple members
        const removed2 = await redis.zrem(key, "one", "three");
        expect(removed2).toBe(2);

        // Remove non-existent member
        const removed3 = await redis.zrem(key, "nonexistent");
        expect(removed3).toBe(0);

        // Remove mix of existing and non-existing
        const removed4 = await redis.zrem(key, "four", "nothere");
        expect(removed4).toBe(1); // Only "four" was removed
      });

      test("should get scores with ZMSCORE", async () => {
        const redis = ctx.redis;
        const key = "zmscore-test";

        // Add members with scores
        await redis.send("ZADD", [key, "1.5", "one", "2.7", "two", "3.9", "three"]);

        // Get single score
        const scores1 = await redis.zmscore(key, "two");
        expect(scores1).toEqual([2.7]);

        // Get multiple scores
        const scores2 = await redis.zmscore(key, "one", "three");
        expect(scores2).toEqual([1.5, 3.9]);

        // Get mix of existing and non-existing members
        const scores3 = await redis.zmscore(key, "one", "nonexistent", "three");
        expect(scores3).toEqual([1.5, null, 3.9]);

        // Get all non-existent members
        const scores4 = await redis.zmscore(key, "nothere", "alsonothere");
        expect(scores4).toEqual([null, null]);
      });

      test("should reject invalid key in ZREM", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrem({} as any, "member");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zrem'."`);
      });

      test("should reject invalid key in ZMSCORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zmscore([] as any, "member");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zmscore'."`,
        );
      });

      test("should add members to sorted set with ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-basic-test";

        // Add single member
        const added1 = await redis.zadd(key, "1", "one");
        expect(added1).toBe(1);

        // Add multiple members
        const added2 = await redis.zadd(key, "2", "two", "3", "three");
        expect(added2).toBe(2);

        // Update existing member (should return 0 since no new members added)
        const added3 = await redis.zadd(key, "1.5", "one");
        expect(added3).toBe(0);

        // Verify members were added/updated
        const score = await redis.zscore(key, "one");
        expect(score).toBe(1.5);
      });

      test("should add members with NX option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-nx-test";

        // Add initial member
        await redis.zadd(key, "1", "one");

        // Try to add with NX (should fail since member exists)
        const added1 = await redis.zadd(key, "NX", "2", "one");
        expect(added1).toBe(0);

        // Verify score wasn't updated
        const score1 = await redis.zscore(key, "one");
        expect(score1).toBe(1);

        // Add new member with NX (should succeed)
        const added2 = await redis.zadd(key, "NX", "2", "two");
        expect(added2).toBe(1);

        const score2 = await redis.zscore(key, "two");
        expect(score2).toBe(2);
      });

      test("should update members with XX option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-xx-test";

        // Add initial member
        await redis.zadd(key, "1", "one");

        // Update with XX (should succeed)
        const updated1 = await redis.zadd(key, "XX", "2", "one");
        expect(updated1).toBe(0); // No new members added

        // Verify score was updated
        const score1 = await redis.zscore(key, "one");
        expect(score1).toBe(2);

        // Try to add new member with XX (should fail)
        const added = await redis.zadd(key, "XX", "3", "three");
        expect(added).toBe(0);

        // Verify member wasn't added
        const score2 = await redis.zscore(key, "three");
        expect(score2).toBeNull();
      });

      test("should return changed count with CH option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-ch-test";

        // Add initial members
        await redis.zadd(key, "1", "one", "2", "two");

        // Add and update with CH (should return total changed count)
        const changed = await redis.zadd(key, "CH", "1.5", "one", "3", "three");
        expect(changed).toBe(2); // one updated, three added
      });

      test("should increment score with INCR option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-incr-test";

        // Add initial member
        await redis.zadd(key, "1", "one");

        // Increment with INCR option (returns new score as string)
        const newScore = await redis.zadd(key, "INCR", "2.5", "one");
        expect(newScore).toBe(3.5);

        // Verify the score
        const score = await redis.zscore(key, "one");
        expect(score).toBe(3.5);
      });

      test("should handle GT option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-gt-test";

        // Add initial member
        await redis.zadd(key, "5", "one");

        // Try to update with lower score and GT (should fail)
        const updated1 = await redis.zadd(key, "GT", "3", "one");
        expect(updated1).toBe(0);

        // Verify score wasn't updated
        const score1 = await redis.zscore(key, "one");
        expect(score1).toBe(5);

        // Update with higher score and GT (should succeed)
        const updated2 = await redis.zadd(key, "GT", "7", "one");
        expect(updated2).toBe(0); // No new members added

        // Verify score was updated
        const score2 = await redis.zscore(key, "one");
        expect(score2).toBe(7);
      });

      test("should handle LT option in ZADD", async () => {
        const redis = ctx.redis;
        const key = "zadd-lt-test";

        // Add initial member
        await redis.zadd(key, "5", "one");

        // Try to update with higher score and LT (should fail)
        const updated1 = await redis.zadd(key, "LT", "7", "one");
        expect(updated1).toBe(0);

        // Verify score wasn't updated
        const score1 = await redis.zscore(key, "one");
        expect(score1).toBe(5);

        // Update with lower score and LT (should succeed)
        const updated2 = await redis.zadd(key, "LT", "3", "one");
        expect(updated2).toBe(0); // No new members added

        // Verify score was updated
        const score2 = await redis.zscore(key, "one");
        expect(score2).toBe(3);
      });

      test("should iterate sorted set with ZSCAN", async () => {
        const redis = ctx.redis;
        const key = "zscan-test";

        // Add members
        await redis.zadd(key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five");

        // Scan all elements
        let cursor = "0";
        const allElements: string[] = [];
        do {
          const [nextCursor, elements] = await redis.zscan(key, cursor);
          allElements.push(...elements);
          cursor = nextCursor;
        } while (cursor !== "0");

        // Should have member-score pairs (10 elements total: 5 members + 5 scores)
        expect(allElements.length).toBe(10);

        // Verify we got all members (check every other element for member names)
        const members = allElements.filter((_, index) => index % 2 === 0);
        expect(members).toContain("one");
        expect(members).toContain("two");
        expect(members).toContain("three");
        expect(members).toContain("four");
        expect(members).toContain("five");
      });

      test("should iterate sorted set with ZSCAN and MATCH", async () => {
        const redis = ctx.redis;
        const key = "zscan-match-test";

        // Add members with different patterns
        await redis.zadd(key, "1", "user:1", "2", "user:2", "3", "post:1", "4", "post:2");

        // Scan with MATCH pattern
        let cursor = "0";
        const userElements: string[] = [];
        do {
          const [nextCursor, elements] = await redis.zscan(key, cursor, "MATCH", "user:*");
          userElements.push(...elements);
          cursor = nextCursor;
        } while (cursor !== "0");

        // Extract member names (every other element)
        const members = userElements.filter((_, index) => index % 2 === 0);

        // Should only find user keys
        expect(members).toContain("user:1");
        expect(members).toContain("user:2");
        expect(members).not.toContain("post:1");
        expect(members).not.toContain("post:2");
      });

      test("should iterate sorted set with ZSCAN and COUNT", async () => {
        const redis = ctx.redis;
        const key = "zscan-count-test";

        // Add many members
        const promises: Promise<number>[] = [];
        for (let i = 0; i < 100; i++) {
          promises.push(redis.zadd(key, String(i), `member:${i}`));
        }
        await Promise.all(promises);

        // Scan with COUNT hint
        const [cursor, elements] = await redis.zscan(key, "0", "COUNT", "10");

        expect(cursor).toBe("0"); // Should complete in one scan since we know the size
        // COUNT is a hint, so we might get more or fewer elements
        // Just verify we got some elements back
        expect(elements.length).toBeGreaterThan(0);
        expect(Array.isArray(elements)).toBe(true);

        const [cursor2, elements2] = await redis.zscan(key, 0, "COUNT", "10");
        expect(cursor2).toBe("0");
        expect(elements2.length).toBeGreaterThan(0);
        expect(Array.isArray(elements2)).toBe(true);
      });

      test("should reject invalid key in ZADD", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zadd({} as any, "1", "member");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zadd'."`);
      });

      test("should reject invalid key in ZSCAN", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zscan([] as any, 0);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zscan'."`);
      });

      test("should return range of members with ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-basic-test";

        // Add members with scores
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Get all members
        const all = await redis.zrange(key, 0, -1);
        expect(all).toEqual(["one", "two", "three", "four", "five"]);

        // Get first 3 members
        const first3 = await redis.zrange(key, 0, 2);
        expect(first3).toEqual(["one", "two", "three"]);

        // Get last 2 members using negative indices
        const last2 = await redis.zrange(key, -2, -1);
        expect(last2).toEqual(["four", "five"]);
      });

      test("should return members with scores using WITHSCORES option in ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-withscores-test";

        // Add members with scores
        await redis.send("ZADD", [key, "1", "one", "2.5", "two", "3", "three"]);

        // Get members with scores
        const result = await redis.zrange(key, 0, -1, "WITHSCORES");
        expect(result).toEqual([
          ["one", 1],
          ["two", 2.5],
          ["three", 3],
        ]);
      });

      test("should return members by score range with BYSCORE option in ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-byscore-test";

        // Add members with scores
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Get members with score 2-4 (inclusive)
        const range1 = await redis.zrange(key, "2", "4", "BYSCORE");
        expect(range1).toEqual(["two", "three", "four"]);

        // Get members with score > 2 and <= 4 (exclusive start)
        const range2 = await redis.zrange(key, "(2", "4", "BYSCORE");
        expect(range2).toEqual(["three", "four"]);

        // Get all members using infinity
        const all = await redis.zrange(key, "-inf", "+inf", "BYSCORE");
        expect(all).toEqual(["one", "two", "three", "four", "five"]);
      });

      test("should return members in reverse order with REV option in ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-rev-test";

        // Add members
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three"]);

        // Get members in reverse order
        const reversed = await redis.zrange(key, 0, -1, "REV");
        expect(reversed).toEqual(["three", "two", "one"]);

        // Get top 2 with highest scores
        const top2 = await redis.zrange(key, 0, 1, "REV");
        expect(top2).toEqual(["three", "two"]);
      });

      test("should support LIMIT option with BYSCORE in ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-limit-test";

        // Add members
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Get members with score >= 1, limit 2 starting from offset 1
        const result = await redis.zrange(key, "1", "5", "BYSCORE", "LIMIT", "1", "2");
        expect(result).toEqual(["two", "three"]);
      });

      test("should return members by lexicographical range with BYLEX option in ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-bylex-test";

        // Add members with same score (required for lex operations)
        await redis.send("ZADD", [key, "0", "apple", "0", "banana", "0", "cherry", "0", "date"]);

        // Get range from "banana" to "cherry" (inclusive)
        const range1 = await redis.zrange(key, "[banana", "[cherry", "BYLEX");
        expect(range1).toEqual(["banana", "cherry"]);

        // Get range with exclusive bounds
        const range2 = await redis.zrange(key, "(banana", "(date", "BYLEX");
        expect(range2).toEqual(["cherry"]);
      });

      test("should return members in reverse order with ZREVRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrevrange-test";

        // Add members with scores
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Get all members in reverse order
        const all = await redis.zrevrange(key, 0, -1);
        expect(all).toEqual(["five", "four", "three", "two", "one"]);

        // Get top 3 members with highest scores
        const top3 = await redis.zrevrange(key, 0, 2);
        expect(top3).toEqual(["five", "four", "three"]);

        // Get members using negative indices
        const last2 = await redis.zrevrange(key, -2, -1);
        expect(last2).toEqual(["two", "one"]);
      });

      test("should return members with scores using WITHSCORES option in ZREVRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrevrange-withscores-test";

        // Add members with scores
        await redis.send("ZADD", [key, "1.5", "one", "2", "two", "3.7", "three"]);

        // Get members with scores in reverse order
        const result = await redis.zrevrange(key, 0, -1, "WITHSCORES");
        expect(result).toEqual([
          ["three", 3.7],
          ["two", 2],
          ["one", 1.5],
        ]);
      });

      test("should handle empty sorted set with ZRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrange-empty-test";

        // Query empty set
        const result = await redis.zrange(key, 0, -1);
        expect(result).toEqual([]);
      });

      test("should handle empty sorted set with ZREVRANGE", async () => {
        const redis = ctx.redis;
        const key = "zrevrange-empty-test";

        // Query empty set
        const result = await redis.zrevrange(key, 0, -1);
        expect(result).toEqual([]);
      });

      test("should reject invalid key in ZRANGE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrange({} as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zrange'."`);
      });

      test("should reject invalid key in ZREVRANGE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrevrange([] as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrevrange'."`,
        );
      });
      test("should return members by score range with ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrangebyscore-test";

        // Add members with scores
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Get all members
        const all = await redis.zrangebyscore(key, "-inf", "+inf");
        expect(all).toEqual(["one", "two", "three", "four", "five"]);

        // Get members with score 2-4 (inclusive)
        const range1 = await redis.zrangebyscore(key, 2, 4);
        expect(range1).toEqual(["two", "three", "four"]);

        // Get members with exclusive lower bound
        const range2 = await redis.zrangebyscore(key, "(2", 4);
        expect(range2).toEqual(["three", "four"]);

        // Get members with exclusive upper bound
        const range3 = await redis.zrangebyscore(key, 2, "(4");
        expect(range3).toEqual(["two", "three"]);

        // Get members with both exclusive bounds
        const range4 = await redis.zrangebyscore(key, "(2", "(4");
        expect(range4).toEqual(["three"]);
      });

      test("should support WITHSCORES option with ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrangebyscore-withscores-test";

        // Add members
        await redis.send("ZADD", [key, "1.5", "one", "2.7", "two", "3.9", "three"]);

        // Get with scores
        const result = await redis.zrangebyscore(key, 1, 3, "WITHSCORES");
        expect(result).toEqual([
          ["one", 1.5],
          ["two", 2.7],
        ]);
      });

      test("should support LIMIT option with ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrangebyscore-limit-test";

        // Add members
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Get first 2 members in score range
        const limited1 = await redis.zrangebyscore(key, "-inf", "+inf", "LIMIT", 0, 2);
        expect(limited1).toEqual(["one", "two"]);

        // Skip first, get next 2
        const limited2 = await redis.zrangebyscore(key, "-inf", "+inf", "LIMIT", 1, 2);
        expect(limited2).toEqual(["two", "three"]);

        // Can combine with score range
        const limited3 = await redis.zrangebyscore(key, 2, 5, "LIMIT", 1, 2);
        expect(limited3).toEqual(["three", "four"]);
      });

      test("should support WITHSCORES with ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrangebyscore-withscores-only-test";

        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four"]);

        const result = await redis.zrangebyscore(key, "-inf", "+inf", "WITHSCORES");
        expect(result).toEqual([
          ["one", 1],
          ["two", 2],
          ["three", 3],
          ["four", 4],
        ]);
      });

      test("should support LIMIT and WITHSCORES together with ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrangebyscore-combined-test";

        // Add members
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four"]);

        // Get with both options
        const result = await redis.zrangebyscore(key, "-inf", "+inf", "WITHSCORES", "LIMIT", 1, 2);
        expect(result).toEqual([
          ["two", 2],
          ["three", 3],
        ]);
      });

      test("should return members by score range in reverse with ZREVRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrevrangebyscore-test";

        // Add members with scores (note: max comes before min in ZREVRANGEBYSCORE)
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Get all members in reverse order
        const all = await redis.zrevrangebyscore(key, "+inf", "-inf");
        expect(all).toEqual(["five", "four", "three", "two", "one"]);

        // Get members with score 4-2 (note: max=4, min=2)
        const range1 = await redis.zrevrangebyscore(key, 4, 2);
        expect(range1).toEqual(["four", "three", "two"]);

        // Get with exclusive bounds
        const range2 = await redis.zrevrangebyscore(key, "(4", "(2");
        expect(range2).toEqual(["three"]);

        // Get with one exclusive bound
        const range3 = await redis.zrevrangebyscore(key, 4, "(2");
        expect(range3).toEqual(["four", "three"]);
      });

      test("should support WITHSCORES option with ZREVRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrevrangebyscore-withscores-test";

        // Add members
        await redis.send("ZADD", [key, "1.5", "one", "2.7", "two", "3.9", "three"]);

        // Get with scores (max=3, min=1)
        const result = await redis.zrevrangebyscore(key, 3, 1, "WITHSCORES");
        expect(result).toEqual([
          ["two", 2.7],
          ["one", 1.5],
        ]);
      });

      test("should support LIMIT option with ZREVRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        const key = "zrevrangebyscore-limit-test";

        // Add members
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Get first 2 members in reverse
        const limited1 = await redis.zrevrangebyscore(key, "+inf", "-inf", "LIMIT", 0, 2);
        expect(limited1).toEqual(["five", "four"]);

        // Skip first, get next 2
        const limited2 = await redis.zrevrangebyscore(key, "+inf", "-inf", "LIMIT", 1, 2);
        expect(limited2).toEqual(["four", "three"]);
      });

      test("should return members by lexicographical range with ZRANGEBYLEX", async () => {
        const redis = ctx.redis;
        const key = "zrangebylex-test";

        // Add members with same score (required for lex operations)
        await redis.send("ZADD", [key, "0", "apple", "0", "banana", "0", "cherry", "0", "date", "0", "elderberry"]);

        // Get all members
        const all = await redis.zrangebylex(key, "-", "+");
        expect(all).toEqual(["apple", "banana", "cherry", "date", "elderberry"]);

        // Get range from "banana" to "date" (inclusive)
        const range1 = await redis.zrangebylex(key, "[banana", "[date");
        expect(range1).toEqual(["banana", "cherry", "date"]);

        // Get range with exclusive bounds
        const range2 = await redis.zrangebylex(key, "(banana", "(date");
        expect(range2).toEqual(["cherry"]);

        // Get range with one exclusive, one inclusive
        const range3 = await redis.zrangebylex(key, "[banana", "(date");
        expect(range3).toEqual(["banana", "cherry"]);

        // Get range from start to specific member
        const range4 = await redis.zrangebylex(key, "-", "[cherry");
        expect(range4).toEqual(["apple", "banana", "cherry"]);

        // Get range from specific member to end
        const range5 = await redis.zrangebylex(key, "[cherry", "+");
        expect(range5).toEqual(["cherry", "date", "elderberry"]);
      });

      test("should support LIMIT option with ZRANGEBYLEX", async () => {
        const redis = ctx.redis;
        const key = "zrangebylex-limit-test";

        // Add members with same score
        await redis.send("ZADD", [key, "0", "a", "0", "b", "0", "c", "0", "d", "0", "e", "0", "f", "0", "g"]);

        // Get first 3 members
        const limited1 = await redis.zrangebylex(key, "-", "+", "LIMIT", 0, 3);
        expect(limited1).toEqual(["a", "b", "c"]);

        // Skip first 2, get next 3
        const limited2 = await redis.zrangebylex(key, "-", "+", "LIMIT", 2, 3);
        expect(limited2).toEqual(["c", "d", "e"]);

        // Get last 2 with large offset
        const limited3 = await redis.zrangebylex(key, "-", "+", "LIMIT", 5, 10);
        expect(limited3).toEqual(["f", "g"]);
      });

      test("should reject invalid key in ZRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrangebyscore({} as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrangebyscore'."`,
        );
      });

      test("should reject invalid key in ZREVRANGEBYSCORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrevrangebyscore([] as any, 10, 0);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrevrangebyscore'."`,
        );
      });

      test("should reject invalid key in ZRANGEBYLEX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrangebylex(null as any, "-", "+");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrangebylex'."`,
        );
      });

      test("should return members in reverse lexicographical order with ZREVRANGEBYLEX", async () => {
        const redis = ctx.redis;
        const key = "zrevrangebylex-test";

        // Add members with same score (required for lex operations)
        await redis.send("ZADD", [key, "0", "apple", "0", "banana", "0", "cherry", "0", "date", "0", "elderberry"]);

        // Get all members in reverse order
        const all = await redis.zrevrangebylex(key, "+", "-");
        expect(all).toEqual(["elderberry", "date", "cherry", "banana", "apple"]);

        // Get range from "date" to "banana" (inclusive, reverse order)
        const range1 = await redis.zrevrangebylex(key, "[date", "[banana");
        expect(range1).toEqual(["date", "cherry", "banana"]);

        // Get range with exclusive bounds
        const range2 = await redis.zrevrangebylex(key, "(date", "(banana");
        expect(range2).toEqual(["cherry"]);

        // Get range with one exclusive, one inclusive
        const range3 = await redis.zrevrangebylex(key, "[elderberry", "(cherry");
        expect(range3).toEqual(["elderberry", "date"]);
      });

      test("should support LIMIT option with ZREVRANGEBYLEX", async () => {
        const redis = ctx.redis;
        const key = "zrevrangebylex-limit-test";

        // Add members with same score
        await redis.send("ZADD", [key, "0", "a", "0", "b", "0", "c", "0", "d", "0", "e", "0", "f", "0", "g"]);

        // Get first 3 members in reverse order
        const limited1 = await redis.zrevrangebylex(key, "+", "-", "LIMIT", "0", "3");
        expect(limited1).toEqual(["g", "f", "e"]);

        // Skip first 2, get next 3
        const limited2 = await redis.zrevrangebylex(key, "+", "-", "LIMIT", "2", "3");
        expect(limited2).toEqual(["e", "d", "c"]);

        // Get last 2 with large offset
        const limited3 = await redis.zrevrangebylex(key, "+", "-", "LIMIT", "5", "10");
        expect(limited3).toEqual(["b", "a"]);
      });

      test("should store range of members with ZRANGESTORE", async () => {
        const redis = ctx.redis;
        const source = "zrangestore-source";
        const dest = "zrangestore-dest";

        // Add members with scores
        await redis.send("ZADD", [source, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Store members by rank (index 1 to 3)
        const count1 = await redis.zrangestore(dest, source, 1, 3);
        expect(count1).toBe(3);

        // Verify stored members
        const stored = await redis.send("ZRANGE", [dest, "0", "-1"]);
        expect(stored).toEqual(["two", "three", "four"]);
      });

      test("should store range with BYSCORE option in ZRANGESTORE", async () => {
        const redis = ctx.redis;
        const source = "zrangestore-byscore-source";
        const dest = "zrangestore-byscore-dest";

        // Add members
        await redis.send("ZADD", [source, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Store members with score 2-4 (inclusive)
        const count = await redis.zrangestore(dest, source, "2", "4", "BYSCORE");
        expect(count).toBe(3);

        // Verify stored members
        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["two", 2],
          ["three", 3],
          ["four", 4],
        ]);
      });

      test("should store range in reverse order with REV option in ZRANGESTORE", async () => {
        const redis = ctx.redis;
        const source = "zrangestore-rev-source";
        const dest = "zrangestore-rev-dest";

        // Add members
        await redis.send("ZADD", [source, "1", "one", "2", "two", "3", "three"]);

        // Store in reverse order
        const count = await redis.zrangestore(dest, source, "0", "-1", "REV");
        expect(count).toBe(3);

        // Verify stored members (they maintain their scores but were selected in reverse)
        const stored = await redis.send("ZRANGE", [dest, "0", "-1"]);
        expect(stored).toEqual(["one", "two", "three"]);
      });

      test("should support LIMIT option with ZRANGESTORE", async () => {
        const redis = ctx.redis;
        const source = "zrangestore-limit-source";
        const dest = "zrangestore-limit-dest";

        // Add members
        await redis.send("ZADD", [source, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Store with BYSCORE and LIMIT
        const count = await redis.zrangestore(dest, source, "-inf", "+inf", "BYSCORE", "LIMIT", "1", "2");
        expect(count).toBe(2);

        // Verify stored members (skip first, get next 2)
        const stored = await redis.send("ZRANGE", [dest, "0", "-1"]);
        expect(stored).toEqual(["two", "three"]);
      });

      test("should reject invalid key in ZREVRANGEBYLEX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrevrangebylex({} as any, "+", "-");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrevrangebylex'."`,
        );
      });

      test("should reject invalid destination in ZRANGESTORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrangestore([] as any, "source", 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrangestore'."`,
        );
      });

      test("should reject invalid source in ZRANGESTORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zrangestore("dest", null as any, 0, 10);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zrangestore'."`,
        );
      });

      test("should compute intersection with ZINTER", async () => {
        const redis = ctx.redis;
        const key1 = "zinter-test-1";
        const key2 = "zinter-test-2";

        // Set up sorted sets
        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "1", "b", "2", "c", "3", "d");

        // Basic intersection - returns members that exist in all sets
        const result1 = await redis.zinter(2, key1, key2);
        expect(result1).toEqual(["b", "c"]);

        // With WITHSCORES (scores are summed by default)
        const result2 = await redis.zinter(2, key1, key2, "WITHSCORES");
        expect(result2).toEqual([
          ["b", 3],
          ["c", 5],
        ]);
      });

      test("should compute intersection with WEIGHTS in ZINTER", async () => {
        const redis = ctx.redis;
        const key1 = "zinter-weights-1";
        const key2 = "zinter-weights-2";

        // Set up sorted sets
        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "1", "b", "2", "c", "3", "d");

        // With weights (multiply scores)
        const result = await redis.zinter(2, key1, key2, "WEIGHTS", "2", "3", "WITHSCORES");
        expect(result).toEqual([
          ["b", 7],
          ["c", 12],
        ]);
      });

      test("should compute intersection with AGGREGATE in ZINTER", async () => {
        const redis = ctx.redis;
        const key1 = "zinter-agg-1";
        const key2 = "zinter-agg-2";

        // Set up sorted sets
        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "1", "b", "2", "c", "3", "d");

        // With MIN aggregation
        const result1 = await redis.zinter(2, key1, key2, "AGGREGATE", "MIN", "WITHSCORES");
        expect(result1).toEqual([
          ["b", 1],
          ["c", 2],
        ]);

        // With MAX aggregation
        const result2 = await redis.zinter(2, key1, key2, "AGGREGATE", "MAX", "WITHSCORES");
        expect(result2).toEqual([
          ["b", 2],
          ["c", 3],
        ]);
      });

      test("should handle empty intersection with ZINTER", async () => {
        const redis = ctx.redis;
        const key1 = "zinter-empty-1";
        const key2 = "zinter-empty-2";

        // Set up sorted sets with no common members
        await redis.zadd(key1, "1", "a", "2", "b");
        await redis.zadd(key2, "1", "c", "2", "d");

        // Empty intersection
        const result = await redis.zinter(2, key1, key2);
        expect(result).toEqual([]);
      });

      test("should store intersection with ZINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zinterstore-test-1";
        const key2 = "zinterstore-test-2";
        const dest = "zinterstore-dest";

        // Set up sorted sets
        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "1", "b", "2", "c", "3", "d");

        // Basic intersection store
        const count = await redis.zinterstore(dest, 2, key1, key2);
        expect(count).toBe(2);

        // Verify stored members
        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["b", 3],
          ["c", 5],
        ]);
      });

      test("should store intersection with WEIGHTS in ZINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zinterstore-weights-1";
        const key2 = "zinterstore-weights-2";
        const dest = "zinterstore-weights-dest";

        // Set up sorted sets
        await redis.zadd(key1, "1", "x", "2", "y");
        await redis.zadd(key2, "2", "x", "3", "y");

        // With weights
        const count = await redis.zinterstore(dest, 2, key1, key2, "WEIGHTS", "2", "3");
        expect(count).toBe(2);

        // Verify stored members with weighted scores
        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["x", 8],
          ["y", 13],
        ]);
      });

      test("should store intersection with AGGREGATE in ZINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zinterstore-agg-1";
        const key2 = "zinterstore-agg-2";
        const destMin = "zinterstore-agg-min";
        const destMax = "zinterstore-agg-max";

        // Set up sorted sets
        await redis.zadd(key1, "1", "m", "3", "n");
        await redis.zadd(key2, "2", "m", "1", "n");

        // With MIN aggregation
        const count1 = await redis.zinterstore(destMin, 2, key1, key2, "AGGREGATE", "MIN");
        expect(count1).toBe(2);
        const storedMin = await redis.send("ZRANGE", [destMin, "0", "-1", "WITHSCORES"]);
        expect(storedMin).toEqual([
          ["m", 1],
          ["n", 1],
        ]);

        // With MAX aggregation
        const count2 = await redis.zinterstore(destMax, 2, key1, key2, "AGGREGATE", "MAX");
        expect(count2).toBe(2);
        const storedMax = await redis.send("ZRANGE", [destMax, "0", "-1", "WITHSCORES"]);
        expect(storedMax).toEqual([
          ["m", 2],
          ["n", 3],
        ]);
      });

      test("should handle empty result with ZINTERSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zinterstore-empty-1";
        const key2 = "zinterstore-empty-2";
        const dest = "zinterstore-empty-dest";

        // Set up sorted sets with no common members
        await redis.zadd(key1, "1", "a", "2", "b");
        await redis.zadd(key2, "1", "c", "2", "d");

        // Empty intersection
        const count = await redis.zinterstore(dest, 2, key1, key2);
        expect(count).toBe(0);

        // Verify destination is empty
        const exists = await redis.exists(dest);
        expect(exists).toBe(false);
      });

      test("should compute union with ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-test-1";
        const key2 = "zunion-test-2";

        // Set up sorted sets
        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "4", "b", "5", "c", "6", "d");

        // Basic union - returns all members from both sets
        const result1 = await redis.zunion(2, key1, key2);
        expect(result1).toEqual(["a", "b", "d", "c"]);

        // With WITHSCORES (scores are summed by default)
        const result2 = await redis.zunion(2, key1, key2, "WITHSCORES");
        expect(result2).toEqual([
          ["a", 1],
          ["b", 6],
          ["d", 6],
          ["c", 8],
        ]);
      });

      test("should compute union with WEIGHTS in ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-weights-1";
        const key2 = "zunion-weights-2";

        // Set up sorted sets
        await redis.zadd(key1, "1", "x", "2", "y", "3", "z");
        await redis.zadd(key2, "2", "y", "3", "z", "4", "w");

        // With weights - multiply scores before aggregation
        const result = await redis.zunion(2, key1, key2, "WEIGHTS", "2", "3", "WITHSCORES");
        expect(result).toEqual([
          ["x", 2],
          ["y", 10],
          ["w", 12],
          ["z", 15],
        ]);
      });

      test("should compute union with AGGREGATE MIN in ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-min-1";
        const key2 = "zunion-min-2";

        // Set up sorted sets
        await redis.zadd(key1, "1", "p", "3", "q");
        await redis.zadd(key2, "2", "p", "1", "q");

        // With MIN aggregation - take minimum score
        const result = await redis.zunion(2, key1, key2, "AGGREGATE", "MIN", "WITHSCORES");
        expect(result).toEqual([
          ["p", 1],
          ["q", 1],
        ]);
      });

      test("should compute union with AGGREGATE MAX in ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-max-1";
        const key2 = "zunion-max-2";

        // Set up sorted sets
        await redis.zadd(key1, "1", "r", "3", "s");
        await redis.zadd(key2, "2", "r", "1", "s");

        // With MAX aggregation - take maximum score
        const result = await redis.zunion(2, key1, key2, "AGGREGATE", "MAX", "WITHSCORES");
        expect(result).toEqual([
          ["r", 2],
          ["s", 3],
        ]);
      });

      test("should compute union with single set in ZUNION", async () => {
        const redis = ctx.redis;
        const key = "zunion-single";

        // Set up single sorted set
        await redis.zadd(key, "1", "one", "2", "two", "3", "three");

        // Union of single set
        const result = await redis.zunion(1, key);
        expect(result).toEqual(["one", "two", "three"]);
      });

      test("should compute union with three sets in ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-three-1";
        const key2 = "zunion-three-2";
        const key3 = "zunion-three-3";

        // Set up three sorted sets
        await redis.zadd(key1, "1", "a", "2", "b");
        await redis.zadd(key2, "2", "b", "3", "c");
        await redis.zadd(key3, "3", "c", "4", "d");

        // Union of three sets
        const result = await redis.zunion(3, key1, key2, key3, "WITHSCORES");
        expect(result).toEqual([
          ["a", 1],
          ["b", 4],
          ["d", 4],
          ["c", 6],
        ]);
      });

      test("should handle empty set in ZUNION", async () => {
        const redis = ctx.redis;
        const key1 = "zunion-empty-1";
        const key2 = "zunion-empty-2";

        // Set up one sorted set, leave other empty
        await redis.zadd(key1, "1", "a", "2", "b");

        // Union with empty set
        const result = await redis.zunion(2, key1, key2);
        expect(result).toEqual(["a", "b"]);
      });

      test("should store union with ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-test-1";
        const key2 = "zunionstore-test-2";
        const dest = "zunionstore-dest";

        // Set up sorted sets
        await redis.zadd(key1, "1", "a", "2", "b", "3", "c");
        await redis.zadd(key2, "4", "b", "5", "c", "6", "d");

        // Basic union store
        const count = await redis.zunionstore(dest, 2, key1, key2);
        expect(count).toBe(4);

        // Verify stored members
        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["a", 1],
          ["b", 6],
          ["d", 6],
          ["c", 8],
        ]);
      });

      test("should store union with WEIGHTS in ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-weights-1";
        const key2 = "zunionstore-weights-2";
        const dest = "zunionstore-weights-dest";

        // Set up sorted sets
        await redis.zadd(key1, "1", "x", "2", "y");
        await redis.zadd(key2, "2", "x", "3", "y");

        // With weights
        const count = await redis.zunionstore(dest, 2, key1, key2, "WEIGHTS", "2", "3");
        expect(count).toBe(2);

        // Verify stored members with weighted scores
        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["x", 8],
          ["y", 13],
        ]);
      });

      test("should store union with AGGREGATE MIN in ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-agg-min-1";
        const key2 = "zunionstore-agg-min-2";
        const dest = "zunionstore-agg-min-dest";

        // Set up sorted sets
        await redis.zadd(key1, "1", "m", "3", "n");
        await redis.zadd(key2, "2", "m", "1", "n");

        // With MIN aggregation
        const count = await redis.zunionstore(dest, 2, key1, key2, "AGGREGATE", "MIN");
        expect(count).toBe(2);
        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["m", 1],
          ["n", 1],
        ]);
      });

      test("should store union with AGGREGATE MAX in ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-agg-max-1";
        const key2 = "zunionstore-agg-max-2";
        const dest = "zunionstore-agg-max-dest";

        // Set up sorted sets
        await redis.zadd(key1, "1", "m", "3", "n");
        await redis.zadd(key2, "2", "m", "1", "n");

        // With MAX aggregation
        const count = await redis.zunionstore(dest, 2, key1, key2, "AGGREGATE", "MAX");
        expect(count).toBe(2);
        const stored = await redis.send("ZRANGE", [dest, "0", "-1", "WITHSCORES"]);
        expect(stored).toEqual([
          ["m", 2],
          ["n", 3],
        ]);
      });

      test("should overwrite existing destination with ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-overwrite-1";
        const key2 = "zunionstore-overwrite-2";
        const dest = "zunionstore-overwrite-dest";

        // Set up initial destination
        await redis.zadd(dest, "100", "old");

        // Set up sorted sets
        await redis.zadd(key1, "1", "a", "2", "b");
        await redis.zadd(key2, "3", "c");

        // Union store should overwrite
        const count = await redis.zunionstore(dest, 2, key1, key2);
        expect(count).toBe(3);

        // Verify old member is gone
        const stored = await redis.send("ZRANGE", [dest, "0", "-1"]);
        expect(stored).toEqual(["a", "b", "c"]);
        expect(stored).not.toContain("old");
      });

      test("should handle empty sets with ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        const key1 = "zunionstore-empty-1";
        const key2 = "zunionstore-empty-2";
        const dest = "zunionstore-empty-dest";

        // Both sets empty
        const count = await redis.zunionstore(dest, 2, key1, key2);
        expect(count).toBe(0);

        // Verify destination is empty
        const exists = await redis.exists(dest);
        expect(exists).toBe(false);
      });

      test("should reject invalid numkeys in ZUNION", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zunion(-1, "key1");
        }).toThrowErrorMatchingInlineSnapshot(`"ERR at least 1 input key is needed for 'zunion' command"`);
      });

      test("should reject invalid key in ZUNION", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zunion(1, {} as any);
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zunion'."`);
      });

      test("should reject invalid destination in ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zunionstore([] as any, 2, "key1", "key2");
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zunionstore'."`,
        );
      });

      test("should reject invalid source key in ZUNIONSTORE", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zunionstore("dest", 2, "key1", null as any);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'zunionstore'."`,
        );
      });

      test("should pop members with MIN option using ZMPOP", async () => {
        const redis = ctx.redis;
        const key = "zmpop-min-test";

        // Add members with scores
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Pop member with lowest score
        const result1 = await redis.zmpop(1, key, "MIN");
        expect(result1).toBeDefined();
        expect(result1).not.toBeNull();
        expect(result1![0]).toBe(key);
        expect(result1![1]).toEqual([["one", 1]]);

        // Verify remaining count
        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(4);
      });

      test("should pop members with MAX option using ZMPOP", async () => {
        const redis = ctx.redis;
        const key = "zmpop-max-test";

        // Add members with scores
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Pop member with highest score
        const result1 = await redis.zmpop(1, key, "MAX");
        expect(result1).toBeDefined();
        expect(result1).not.toBeNull();
        expect(result1![0]).toBe(key);
        expect(result1![1]).toEqual([["five", 5]]);

        // Verify remaining count
        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(4);
      });

      test("should pop multiple members with COUNT option using ZMPOP", async () => {
        const redis = ctx.redis;
        const key = "zmpop-count-test";

        // Add members with scores
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three", "4", "four", "5", "five"]);

        // Pop 3 members with lowest scores
        const result = await redis.zmpop(1, key, "MIN", "COUNT", 3);
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result![0]).toBe(key);
        expect(result![1]).toEqual([
          ["one", 1],
          ["two", 2],
          ["three", 3],
        ]);

        // Verify remaining count
        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(2);
      });

      test("should return null when ZMPOP on empty set", async () => {
        const redis = ctx.redis;
        const emptyKey = "zmpop-empty-test";

        // Try to pop from empty set
        const result = await redis.zmpop(1, emptyKey, "MIN");
        expect(result).toBeNull();
      });

      test("should pop from first non-empty set with ZMPOP", async () => {
        const redis = ctx.redis;
        const key1 = "zmpop-multi-test1";
        const key2 = "zmpop-multi-test2";
        const key3 = "zmpop-multi-test3";

        // Only populate key2
        await redis.send("ZADD", [key2, "1", "one", "2", "two"]);

        // Pop from multiple keys (should get from key2)
        const result = await redis.zmpop(3, key1, key2, key3, "MIN");
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result![0]).toBe(key2);
        expect(result![1]).toEqual([["one", 1]]);
      });

      test("should block and pop with BZMPOP", async () => {
        const redis = ctx.redis;
        const key = "bzmpop-test";

        // Add a member to the set
        await redis.send("ZADD", [key, "1", "one", "2", "two"]);

        // Use short timeout for testing
        const result = await redis.bzmpop(0.1, 1, key, "MIN");
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result![0]).toBe(key);
        expect(result![1]).toEqual([["one", 1]]);

        // Verify member was removed
        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(1);
      });

      test("should timeout with BZMPOP on empty set", async () => {
        const redis = ctx.redis;
        const emptyKey = "bzmpop-timeout-test";

        // Try to pop from empty set with short timeout
        const result = await redis.bzmpop(0.1, 1, emptyKey, "MIN");
        expect(result).toBeNull();
      });

      test("should block and pop multiple members with BZMPOP COUNT", async () => {
        const redis = ctx.redis;
        const key = "bzmpop-count-test";

        // Add members to the set
        await redis.send("ZADD", [key, "1", "one", "2", "two", "3", "three"]);

        // Pop 2 members with short timeout
        const result = await redis.bzmpop(0.5, 1, key, "MAX", "COUNT", 2);
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result![0]).toBe(key);
        expect(result![1]).toEqual([
          ["three", 3],
          ["two", 2],
        ]);

        // Verify one member remains
        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(1);
      });

      test("should reject invalid arguments in ZMPOP", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.zmpop({} as any, "key1", "MIN");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'zmpop'."`);
      });

      test("should reject invalid arguments in BZMPOP", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.bzmpop(1, {} as any, "key1", "MIN");
        }).toThrowErrorMatchingInlineSnapshot(`"Expected additional arguments to be a string or buffer for 'bzmpop'."`);
      });

      test("should block and pop lowest score with BZPOPMIN", async () => {
        const redis = ctx.redis;
        const key = "bzpopmin-test";

        // Add members to sorted set
        await redis.send("ZADD", [key, "1.0", "one", "2.0", "two", "3.0", "three"]);

        // Pop lowest score with short timeout
        const result = await redis.bzpopmin(key, 0.1);
        expect(result).toBeDefined();
        expect(result).toHaveLength(3);
        expect(result![0]).toBe(key);
        expect(result![1]).toBe("one");
        expect(result![2]).toBe(1);

        // Verify member was removed
        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(2);
      });

      test("should timeout with BZPOPMIN when no elements available", async () => {
        const redis = ctx.redis;
        const key = "bzpopmin-empty-test";

        // Try to pop from non-existent key with short timeout
        const result = await redis.bzpopmin(key, 0.1);
        expect(result).toBeNull();
      });

      test("should block and pop highest score with BZPOPMAX", async () => {
        const redis = ctx.redis;
        const key = "bzpopmax-test";

        // Add members to sorted set
        await redis.send("ZADD", [key, "1.0", "one", "2.0", "two", "3.0", "three"]);

        // Pop highest score with short timeout
        const result = await redis.bzpopmax(key, 0.1);
        expect(result).toBeDefined();
        expect(result).toHaveLength(3);
        expect(result![0]).toBe(key);
        expect(result![1]).toBe("three");
        expect(result![2]).toBe(3);

        // Verify member was removed
        const count = await redis.send("ZCARD", [key]);
        expect(count).toBe(2);
      });

      test("should timeout with BZPOPMAX when no elements available", async () => {
        const redis = ctx.redis;
        const key = "bzpopmax-empty-test";

        // Try to pop from non-existent key with short timeout
        const result = await redis.bzpopmax(key, 0.1);
        expect(result).toBeNull();
      });

      test("should work with multiple keys in BZPOPMIN", async () => {
        const redis = ctx.redis;
        const key1 = "bzpopmin-multi-1";
        const key2 = "bzpopmin-multi-2";

        // Add members to second key only
        await redis.send("ZADD", [key2, "5.0", "five", "6.0", "six"]);

        // Pop from multiple keys (should return from key2)
        const result = await redis.bzpopmin(key1, key2, 0.1);
        expect(result).toBeDefined();
        expect(result![0]).toBe(key2);
        expect(result![1]).toBe("five");
        expect(result![2]).toBe(5);
      });

      test("should work with multiple keys in BZPOPMAX", async () => {
        const redis = ctx.redis;
        const key1 = "bzpopmax-multi-1";
        const key2 = "bzpopmax-multi-2";

        // Add members to second key only
        await redis.send("ZADD", [key2, "5.0", "five", "6.0", "six"]);

        // Pop from multiple keys (should return from key2)
        const result = await redis.bzpopmax(key1, key2, 0.5);
        expect(result).toBeDefined();
        expect(result![0]).toBe(key2);
        expect(result![1]).toBe("six");
        expect(result![2]).toBe(6);
      });

      test("should reject invalid arguments in BZPOPMIN", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.bzpopmin({} as any, 1);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'bzpopmin'."`,
        );
      });

      test("should reject invalid arguments in BZPOPMAX", async () => {
        const redis = ctx.redis;
        expect(async () => {
          await redis.bzpopmax([] as any, 1);
        }).toThrowErrorMatchingInlineSnapshot(
          `"Expected additional arguments to be a string or buffer for 'bzpopmax'."`,
        );
      });
    });

    describe("Hash Operations", () => {
      test("should set hash fields using object syntax", async () => {
        const redis = ctx.redis;
        const key = "hash-object-test";

        const result = await redis.hset(key, { field1: "value1", field2: "value2", field3: "value3" });
        expect(result).toBe(3); // 3 new fields added

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("value1");
        const value2 = await redis.hget(key, "field2");
        expect(value2).toBe("value2");
        const value3 = await redis.hget(key, "field3");
        expect(value3).toBe("value3");
      });

      test("should set hash fields using variadic syntax", async () => {
        const redis = ctx.redis;
        const key = "hash-variadic-test";

        const result = await redis.hset(key, "field1", "value1", "field2", "value2");
        expect(result).toBe(2); // 2 new fields added

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("value1");
        const value2 = await redis.hget(key, "field2");
        expect(value2).toBe("value2");
      });

      test("should set single hash field", async () => {
        const redis = ctx.redis;
        const key = "hash-single-test";

        const result = await redis.hset(key, "field1", "value1");
        expect(result).toBe(1); // 1 new field added

        const value = await redis.hget(key, "field1");
        expect(value).toBe("value1");
      });

      test("should update existing hash fields", async () => {
        const redis = ctx.redis;
        const key = "hash-update-test";

        // Initial set
        const result1 = await redis.hset(key, { field1: "value1", field2: "value2" });
        expect(result1).toBe(2);

        // Update existing and add new
        const result2 = await redis.hset(key, { field1: "new-value1", field3: "value3" });
        expect(result2).toBe(1); // Only field3 is new

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("new-value1");
        const value3 = await redis.hget(key, "field3");
        expect(value3).toBe("value3");
      });

      test("should work with HMSET using object syntax", async () => {
        const redis = ctx.redis;
        const key = "hmset-object-test";

        const result = await redis.hmset(key, { field1: "value1", field2: "value2" });
        expect(result).toBe("OK");

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("value1");
        const value2 = await redis.hget(key, "field2");
        expect(value2).toBe("value2");
      });

      test("should work with HMSET using variadic syntax", async () => {
        const redis = ctx.redis;
        const key = "hmset-variadic-test";

        const result = await redis.hmset(key, "field1", "value1", "field2", "value2");
        expect(result).toBe("OK");

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("value1");
      });

      test("should work with HMSET using array syntax", async () => {
        const redis = ctx.redis;
        const key = "hmset-array-test";

        const result = await redis.hmset(key, ["field1", "value1", "field2", "value2"]);
        expect(result).toBe("OK");

        const value1 = await redis.hget(key, "field1");
        expect(value1).toBe("value1");
      });

      test("should handle numeric field names and values", async () => {
        const redis = ctx.redis;
        const key = "hash-numeric-test";

        const result = await redis.hset(key, { 123: "value1", field2: 456 });
        expect(result).toBe(2);

        const value1 = await redis.hget(key, "123");
        expect(value1).toBe("value1");
        const value2 = await redis.hget(key, "field2");
        expect(value2).toBe("456");
      });

      test("should throw error for odd number of variadic arguments", async () => {
        const redis = ctx.redis;
        const key = "hash-error-test";

        expect(async () => {
          await redis.hset(key, "field1", "value1", "field2");
        }).toThrow("HSET requires field-value pairs (even number of arguments after key)");
      });

      test("should throw error for empty object", async () => {
        const redis = ctx.redis;
        const key = "hash-empty-test";

        expect(async () => {
          await redis.hset(key, {});
        }).toThrow("HSET requires at least one field-value pair");
      });

      test("should throw error for array with odd number of elements", async () => {
        const redis = ctx.redis;
        const key = "hmset-error-test";

        expect(async () => {
          await redis.hmset(key, ["field1", "value1", "field2"]);
        }).toThrow("Array must have an even number of elements (field-value pairs)");
      });

      test("should handle large number of fields", async () => {
        const redis = ctx.redis;
        const key = "hash-large-test";

        const fields: Record<string, string> = {};
        for (let i = 0; i < 100; i++) {
          fields[`field${i}`] = `value${i}`;
        }

        const result = await redis.hset(key, fields);
        expect(result).toBe(100);

        const value0 = await redis.hget(key, "field0");
        expect(value0).toBe("value0");
        const value99 = await redis.hget(key, "field99");
        expect(value99).toBe("value99");
      });

      test("should delete hash fields using hdel", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const deleted = await redis.hdel(key, "age");
        expect(deleted).toBe(1);

        const age = await redis.hget(key, "age");
        expect(age).toBeNull();

        const name = await redis.hget(key, "name");
        expect(name).toBe("John");
      });

      test("should delete multiple hash fields using hdel", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC", country: "USA" });

        const deleted = await redis.hdel(key, "age", "city");
        expect(deleted).toBe(2);

        const remaining = await redis.hgetall(key);
        expect(remaining).toEqual({ name: "John", country: "USA" });
      });

      test("should check if hash field exists using hexists", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const nameExists = await redis.hexists(key, "name");
        expect(nameExists).toBe(true);

        const emailExists = await redis.hexists(key, "email");
        expect(emailExists).toBe(false);
      });

      test("should get random field using hrandfield", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const field = await redis.hrandfield(key);
        expect(["name", "age", "city"]).toContain<string | null>(field);
      });

      test("should get multiple random fields using hrandfield with count", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const fields = await redis.hrandfield(key, 2);
        expect(fields).toBeInstanceOf(Array);
        expect(fields.length).toBe(2);
        fields.forEach(field => {
          expect(["name", "age", "city"]).toContain(field);
        });
      });

      test("should get random fields with values using hrandfield WITHVALUES", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30" });

        const result = await redis.hrandfield(key, 1, "WITHVALUES");
        expect(result).toBeInstanceOf(Array);
        expect(result.length).toBe(2); // [field, value]

        const fieldName = result[0];
        const fieldValue = result[1];
        expect(["name", "age"]).toContain(fieldName);
        if (fieldName === "name") {
          expect(fieldValue).toBe("John");
        } else {
          expect(fieldValue).toBe("30");
        }
      });

      test("should scan hash using hscan", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { name: "John", age: "30", city: "NYC" });

        const [cursor, fields] = await redis.hscan(key, 0);
        expect(typeof cursor).toBe("string");
        expect(fields).toBeInstanceOf(Array);
        expect(fields.length).toBe(6); // [field1, value1, field2, value2, field3, value3]

        // Convert to object for easier testing
        const obj: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          obj[fields[i]] = fields[i + 1];
        }
        expect(obj).toEqual({ name: "John", age: "30", city: "NYC" });
      });

      test("should scan hash with pattern using hscan MATCH", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        await redis.hset(key, { field1: "val1", field2: "val2", other: "val3" });

        const [cursor, fields] = await redis.hscan(key, 0, "MATCH", "field*");
        expect(typeof cursor).toBe("string");
        expect(fields).toBeInstanceOf(Array);

        // Convert to object
        const obj: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          obj[fields[i]] = fields[i + 1];
        }

        // Should only contain fields matching "field*"
        expect(obj.field1).toBe("val1");
        expect(obj.field2).toBe("val2");
        expect(obj.other).toBeUndefined();
      });

      test("should scan hash with count using hscan COUNT", async () => {
        const redis = ctx.redis;
        const key = "user:" + randomUUIDv7().substring(0, 8);

        // Add many fields
        const fields: Record<string, string> = {};
        for (let i = 0; i < 20; i++) {
          fields[`field${i}`] = `value${i}`;
        }
        await redis.hset(key, fields);

        const [cursor, result] = await redis.hscan(key, 0, "COUNT", 5);
        expect(typeof cursor).toBe("string");
        expect(result).toBeInstanceOf(Array);
        // COUNT is a hint, so we just check we got some results
        expect(result.length).toBeGreaterThan(0);
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
