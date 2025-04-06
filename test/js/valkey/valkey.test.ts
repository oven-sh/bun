import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUIDv7, RedisClient } from "bun";
import { createClient } from "./test-utils";

describe("Valkey Redis Client", () => {
  let redis: RedisClient;

  beforeAll(async () => {
    redis = createClient();
  });

  describe("Basic Operations", () => {
    test("should set and get strings", async () => {
      const client = createClient();
      const testKey = "greeting";
      const testValue = "Hello from Bun Redis!";

      // Now we can reliably test SET and GET since we've already consumed the HELLO response
      const setResult = await client.set(testKey, testValue);

      // SET should return OK (or similar response depending on RESP3 protocol)
      expect(setResult).toBeDefined();

      // GET should now return the actual value we set
      const getValue = await client.get(testKey);
      expect(getValue).toBe(testValue);

      await client.disconnect();
    });

    test("should test key existence", async () => {
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
      // Set a key first
      const tempKey = "temporary";
      await redis.set(tempKey, "will expire");

      // EXPIRE should return 1 if the timeout was set, 0 otherwise
      const result = await redis.expire(tempKey, 60);
      expect(result).toBeDefined();

      // Check TTL using the sendCommand API since ttl() doesn't exist yet
      const ttl = await redis.send("TTL", [tempKey]);
      expect(ttl).toBeDefined();
      expect(typeof ttl).toBe("number");
      expect(ttl).toBeGreaterThan(0); // Should be positive if expiration was set
    });

    test("should implement TTL command", async () => {
      // This is a workaround until TTL is properly implemented
      const tempKey = "ttl-test-key";
      await redis.set(tempKey, "ttl test value");
      await redis.expire(tempKey, 60);

      // Use sendCommand to access TTL functionality
      const ttl = await redis.send("TTL", [tempKey]);
      expect(ttl).toBeGreaterThan(0); // Should be positive if expiration was set

      // For keys with no expiration
      const permanentKey = "permanent-key";
      await redis.set(permanentKey, "no expiry");
      const noExpiry = await redis.send("TTL", [permanentKey]);
      expect(noExpiry).toBe(-1); // -1 indicates no expiration

      // For non-existent keys
      const nonExistentKey = "non-existent-" + randomUUIDv7();
      const noKey = await redis.send("TTL", [nonExistentKey]);
      expect(noKey).toBe(-2); // -2 indicates key doesn't exist
    });
  });

  describe("Connection State", () => {
    test("should have a connected property", () => {
      // The client should expose a connected property
      expect(typeof redis.connected).toBe("boolean");
    });
  });

  describe("RESP3 Data Types", () => {
    test("should handle hash maps (dictionaries) as command responses", async () => {
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
      const customRedis = new RedisClient("redis://badusername:secretpassword@localhost:6379");

      expect(async () => {
        await customRedis.connect();
      }).toThrow();
    });
  });
});
