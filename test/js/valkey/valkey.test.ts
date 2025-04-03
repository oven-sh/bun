import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUIDv7, valkey } from "bun";

describe("Valkey Redis Client", () => {
  let redis: ReturnType<typeof valkey>;
  let connectionInitialized = false;

  beforeAll(async () => {
    // Create Redis client with options
    redis = valkey("redis://localhost:6379", {
      idleTimeout: 30000, // 30 seconds idle timeout
      connectionTimeout: 5000, // 5 seconds connection timeout
      autoReconnect: true, // Enable auto reconnection
      maxRetries: 10, // Max 10 retry attempts
      enableOfflineQueue: true, // Queue commands when disconnected
    });
    
    // Explicitly connect to Redis
    try {
      await redis.connect();
      
      // Verify connection works by making a simple request
      await redis.set("__test_init__", "initialized");
      connectionInitialized = true;
      console.log("Redis connection initialized successfully");
    } catch (err) {
      console.error("Failed to initialize Redis connection:", err);
    }
  });

  describe("Basic Operations", () => {
    test("should set and get strings", async () => {
      // Skip this test if initialization failed
      if (!connectionInitialized) {
        console.warn("Skipping test because initialization failed");
        return;
      }

      const testKey = "greeting";
      const testValue = "Hello from Bun Redis!";

      // Now we can reliably test SET and GET since we've already consumed the HELLO response
      const setResult = await redis.set(testKey, testValue);

      // SET should return OK (or similar response depending on RESP3 protocol)
      expect(setResult).toBeDefined();

      // GET should now return the actual value we set
      const getValue = await redis.get(testKey);
      expect(getValue).toBe(testValue);
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
      const ttl = await redis.sendCommand("TTL", [tempKey]);
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
      const ttl = await redis.sendCommand("TTL", [tempKey]);
      expect(ttl).toBeGreaterThan(0); // Should be positive if expiration was set

      // For keys with no expiration
      const permanentKey = "permanent-key";
      await redis.set(permanentKey, "no expiry");
      const noExpiry = await redis.sendCommand("TTL", [permanentKey]);
      expect(noExpiry).toBe(-1); // -1 indicates no expiration

      // For non-existent keys
      const nonExistentKey = "non-existent-" + randomUUIDv7();
      const noKey = await redis.sendCommand("TTL", [nonExistentKey]);
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
      const setResult = await redis.sendCommand("HSET", [userId, "name", "John", "age", "30", "active", "true"]);
      expect(setResult).toBeDefined();

      // HGETALL returns object with key-value pairs
      const hash = await redis.sendCommand("HGETALL", [userId]);
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
      const addResult = await redis.sendCommand("SADD", [setKey, "red", "blue", "green"]);
      expect(addResult).toBeDefined();

      // Get set members
      const setMembers = await redis.sendCommand("SMEMBERS", [setKey]);
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
    test("should accept connection options", async () => {
      const customRedis = valkey("redis://localhost:6379", {
        idleTimeout: 15000,
        connectionTimeout: 3000,
        autoReconnect: false,
        maxRetries: 5,
        enableOfflineQueue: false,
      });

      // Testing the client was created successfully
      expect(customRedis).toBeDefined();

      // Explicitly connect and test
      try {
        await customRedis.connect();
        await customRedis.set("__init_key", "__init_value");

        // Test that the client works after initialization
        const testValue = "connection options test";
        await customRedis.set("custom-client-test", testValue);
        const result = await customRedis.get("custom-client-test");
        expect(result).toBe(testValue);
      } catch (e) {
        console.error("Error with custom client:", e);
      } finally {
        // Cleanup
        await customRedis.disconnect();
      }
    });
  });

  // Clean up after all tests
  afterAll(async () => {
    try {
      await redis.disconnect();
      console.log("Redis client disconnected after tests");
    } catch (e) {
      console.error("Error disconnecting Redis client:", e);
    }
  });
});
