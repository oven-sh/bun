import { randomUUIDv7, RedisClient } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, DEFAULT_REDIS_URL, expectType, isEnabled } from "./test-utils";

describe.skipIf(!isEnabled)("Valkey Redis Client", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
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
      expect(setResult2).toMatchInlineSnapshot(`"Hello from Bun Redis!"`);

      // GET should return the value we set
      const getValue = await redis.get(testKey);
      expect(getValue).toMatchInlineSnapshot(`"Hello from Bun Redis!"`);
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
      const url = new URL(DEFAULT_REDIS_URL);
      url.username = "badusername";
      url.password = "secretpassword";
      const customRedis = new RedisClient(url.toString());

      expect(async () => {
        await customRedis.get("test");
      }).toThrowErrorMatchingInlineSnapshot(`"WRONGPASS invalid username-password pair or user is disabled."`);
    });
  });
});
