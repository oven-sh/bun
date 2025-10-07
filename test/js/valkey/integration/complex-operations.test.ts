import { randomUUIDv7 } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, isEnabled } from "../test-utils";

/**
 * Integration test suite for complex Redis operations
 * - Transaction handling
 * - Pipelining (to be implemented)
 * - Complex data type operations
 * - Realistic use cases
 */
describe.skipIf(!isEnabled)("Valkey: Complex Operations", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });
  describe("Multi/Exec Transactions", () => {
    test("should execute commands in a transaction", async () => {
      const prefix = ctx.generateKey("transaction");
      const key1 = `${prefix}-1`;
      const key2 = `${prefix}-2`;
      const key3 = `${prefix}-3`;

      // Start transaction
      await ctx.redis.send("MULTI", []);

      // Queue commands in transaction
      const queueResults = await Promise.all([
        ctx.redis.set(key1, "value1"),
        ctx.redis.set(key2, "value2"),
        ctx.redis.incr(key3),
        ctx.redis.get(key1),
      ]);

      // All queue commands should return "QUEUED"
      for (const result of queueResults) {
        expect(result).toBe("QUEUED");
      }

      // Execute transaction
      const execResult = await ctx.redis.send("EXEC", []);

      // Should get an array of results
      expect(Array.isArray(execResult)).toBe(true);
      expect(execResult.length).toBe(4);

      // Check individual results
      expect(execResult[0]).toBe("OK"); // SET result
      expect(execResult[1]).toBe("OK"); // SET result
      expect(execResult[2]).toBe(1); // INCR result
      expect(execResult[3]).toBe("value1"); // GET result

      // Verify the transaction was applied
      const key1Value = await ctx.redis.get(key1);
      expect(key1Value).toBe("value1");

      const key2Value = await ctx.redis.get(key2);
      expect(key2Value).toBe("value2");

      const key3Value = await ctx.redis.get(key3);
      expect(key3Value).toBe("1");
    });

    test("should handle transaction discards", async () => {
      const prefix = ctx.generateKey("transaction-discard");
      const key = `${prefix}-key`;

      // Set initial value
      await ctx.redis.set(key, "initial");

      // Start transaction
      await ctx.redis.send("MULTI", []);

      // Queue some commands
      await ctx.redis.set(key, "changed");
      await ctx.redis.incr(`${prefix}-counter`);

      // Discard the transaction
      const discardResult = await ctx.redis.send("DISCARD", []);
      expect(discardResult).toBe("OK");

      // Verify the key was not changed
      const value = await ctx.redis.get(key);
      expect(value).toBe("initial");

      // Verify counter was not incremented
      const counterValue = await ctx.redis.get(`${prefix}-counter`);
      expect(counterValue).toBeNull();
    });

    test("should handle transaction errors", async () => {
      const prefix = ctx.generateKey("transaction-error");
      const key = `${prefix}-key`;

      // Set initial value
      await ctx.redis.set(key, "string-value");

      // Start transaction
      await ctx.redis.send("MULTI", []);

      // Queue valid command
      await ctx.redis.set(`${prefix}-valid`, "valid");

      // Queue command that will fail (INCR on a string)
      await ctx.redis.incr(key);

      // Queue another valid command
      await ctx.redis.set(`${prefix}-after`, "after");

      // Execute transaction
      const execResult = await ctx.redis.send("EXEC", []);

      // Should get an array of results, with error for the failing command
      expect(Array.isArray(execResult)).toBe(true);
      expect(execResult).toMatchInlineSnapshot(`
        [
          "OK",
          [Error: ERR value is not an integer or out of range],
          "OK",
        ]
      `);

      // Verify the valid commands were executed
      const validValue = await ctx.redis.get(`${prefix}-valid`);
      expect(validValue).toBe("valid");

      const afterValue = await ctx.redis.get(`${prefix}-after`);
      expect(afterValue).toBe("after");
    });

    test("should handle nested commands in transaction", async () => {
      const prefix = ctx.generateKey("transaction-nested");
      const hashKey = `${prefix}-hash`;
      const setKey = `${prefix}-set`;

      // Start transaction
      await ctx.redis.send("MULTI", []);

      // Queue complex data type commands
      await ctx.redis.send("HSET", [hashKey, "field1", "value1", "field2", "value2"]);
      await ctx.redis.send("SADD", [setKey, "member1", "member2", "member3"]);
      await ctx.redis.send("HGETALL", [hashKey]);
      await ctx.redis.send("SMEMBERS", [setKey]);

      // Execute transaction
      const execResult = await ctx.redis.send("EXEC", []);

      // Should get an array of results
      expect(Array.isArray(execResult)).toBe(true);
      expect(execResult.length).toBe(4);

      // HSET should return number of fields added
      expect(execResult[0]).toBe(2);

      // SADD should return number of members added
      expect(execResult[1]).toBe(3);

      // HGETALL should return hash object or array
      const hashResult = execResult[2];
      if (typeof hashResult === "object" && hashResult !== null) {
        // RESP3 style (map)
        expect(hashResult.field1).toBe("value1");
        expect(hashResult.field2).toBe("value2");
      } else if (Array.isArray(hashResult)) {
        // RESP2 style (array of field-value pairs)
        expect(hashResult.length).toBe(4);
        expect(hashResult).toContain("field1");
        expect(hashResult).toContain("value1");
        expect(hashResult).toContain("field2");
        expect(hashResult).toContain("value2");
      }

      // SMEMBERS should return array
      expect(Array.isArray(execResult[3])).toBe(true);
      expect(execResult[3].length).toBe(3);
      expect(execResult[3]).toContain("member1");
      expect(execResult[3]).toContain("member2");
      expect(execResult[3]).toContain("member3");
    });
  });

  describe("Complex Key Patterns", () => {
    test("should handle hierarchical key patterns", async () => {
      // Create hierarchical key structure (user:id:field)
      const userId = randomUUIDv7().substring(0, 8);
      const baseKey = ctx.generateKey(`user:${userId}`);

      // Set multiple fields
      await ctx.redis.set(`${baseKey}:name`, "John Doe");
      await ctx.redis.set(`${baseKey}:email`, "john@example.com");
      await ctx.redis.set(`${baseKey}:age`, "30");

      // Create a counter
      await ctx.redis.incr(`${baseKey}:visits`);
      await ctx.redis.incr(`${baseKey}:visits`);

      // Get all keys matching the pattern
      const patternResult = await ctx.redis.send("KEYS", [`${baseKey}:*`]);

      // Should find all our keys
      expect(Array.isArray(patternResult)).toBe(true);
      expect(patternResult.length).toBe(4);

      // Sort for consistent snapshot
      const sortedKeys = [...patternResult].sort();
      expect(sortedKeys).toMatchInlineSnapshot(`
        [
          "${baseKey}:age",
          "${baseKey}:email",
          "${baseKey}:name",
          "${baseKey}:visits",
        ]
      `);

      // Verify values
      const nameValue = await ctx.redis.get(`${baseKey}:name`);
      expect(nameValue).toBe("John Doe");

      const visitsValue = await ctx.redis.get(`${baseKey}:visits`);
      expect(visitsValue).toBe("2");
    });

    test("should handle complex key patterns with expiry", async () => {
      // Create session-like structure
      const sessionId = randomUUIDv7().substring(0, 8);
      const baseKey = ctx.generateKey(`session:${sessionId}`);

      // Set session data with expiry
      await ctx.redis.set(`${baseKey}:data`, JSON.stringify({ user: "user123", role: "admin" }));
      await ctx.redis.expire(`${baseKey}:data`, 30); // 30 second expiry

      // Set session heartbeat with shorter expiry
      await ctx.redis.set(`${baseKey}:heartbeat`, Date.now().toString());
      await ctx.redis.expire(`${baseKey}:heartbeat`, 10); // 10 second expiry

      // Verify TTLs
      const dataTtl = await ctx.redis.ttl(`${baseKey}:data`);
      expect(typeof dataTtl).toBe("number");
      expect(dataTtl).toBeGreaterThan(0);
      expect(dataTtl).toBeLessThanOrEqual(30);

      const heartbeatTtl = await ctx.redis.ttl(`${baseKey}:heartbeat`);
      expect(typeof heartbeatTtl).toBe("number");
      expect(heartbeatTtl).toBeGreaterThan(0);
      expect(heartbeatTtl).toBeLessThanOrEqual(10);

      // Update heartbeat and reset TTL
      await ctx.redis.set(`${baseKey}:heartbeat`, Date.now().toString());
      await ctx.redis.expire(`${baseKey}:heartbeat`, 10);

      // Verify updated TTL
      const updatedTtl = await ctx.redis.ttl(`${baseKey}:heartbeat`);
      expect(updatedTtl).toBeGreaterThan(0);
      expect(updatedTtl).toBeLessThanOrEqual(10);
    });
  });

  describe("Realistic Use Cases", () => {
    test("should implement a simple rate limiter", async () => {
      // Implementation of a rate limiter using Redis
      const ipAddress = "192.168.1.1";
      const rateLimitKey = ctx.generateKey(`ratelimit:${ipAddress}`);
      const maxRequests = 5;
      const windowSecs = 10;

      // Function to check if the IP is rate limited
      async function isRateLimited() {
        // Get current count
        const count = await ctx.redis.incr(rateLimitKey);

        // If this is the first request, set expiry
        if (count === 1) {
          await ctx.redis.expire(rateLimitKey, windowSecs);
        }

        // Check if over limit
        return count > maxRequests;
      }

      // Simulate multiple requests
      const results = [];
      for (let i = 0; i < 7; i++) {
        results.push(await isRateLimited());
      }

      // Check results with inline snapshot for better readability
      expect(results).toMatchInlineSnapshot(`
        [
          false,
          false,
          false,
          false,
          false,
          true,
          true,
        ]
      `);

      const finalCount = await ctx.redis.get(rateLimitKey);
      expect(finalCount).toBe("7");

      // Verify TTL exists
      const ttl = await ctx.redis.ttl(rateLimitKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(windowSecs);
    });

    test("should implement a simple cache with expiry", async () => {
      const cachePrefix = ctx.generateKey("cache");

      // Cache implementation
      async function getOrSetCache(key, ttl, fetchFunction) {
        const cacheKey = `${cachePrefix}:${key}`;

        // Try to get from cache
        const cachedValue = await ctx.redis.get(cacheKey);
        if (cachedValue !== null) {
          return JSON.parse(cachedValue);
        }

        // Not in cache, fetch the value
        const freshValue = await fetchFunction();

        // Store in cache with expiry
        await ctx.redis.set(cacheKey, JSON.stringify(freshValue));
        await ctx.redis.expire(cacheKey, ttl);

        return freshValue;
      }

      // Simulate expensive operation
      let fetchCount = 0;
      async function fetchData() {
        fetchCount++;
        return { data: "example", timestamp: Date.now() };
      }

      // First fetch should call the function
      const result1 = await getOrSetCache("test-key", 30, fetchData);
      expect(result1).toBeDefined();
      expect(fetchCount).toBe(1);

      // Second fetch should use cache
      const result2 = await getOrSetCache("test-key", 30, fetchData);
      expect(result2).toBeDefined();
      expect(fetchCount).toBe(1); // Still 1 because we used cache

      // Different key should call function again
      const result3 = await getOrSetCache("other-key", 30, fetchData);
      expect(result3).toBeDefined();
      expect(fetchCount).toBe(2);

      // Verify cache entry has TTL
      const ttl = await ctx.redis.ttl(`${cachePrefix}:test-key`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);
    });

    test("should implement a simple leaderboard", async () => {
      const leaderboardKey = ctx.generateKey("leaderboard");

      // Add scores
      await ctx.redis.send("ZADD", [leaderboardKey, "100", "player1"]);
      await ctx.redis.send("ZADD", [leaderboardKey, "200", "player2"]);
      await ctx.redis.send("ZADD", [leaderboardKey, "150", "player3"]);
      await ctx.redis.send("ZADD", [leaderboardKey, "300", "player4"]);
      await ctx.redis.send("ZADD", [leaderboardKey, "50", "player5"]);

      // Get top 3 players (highest scores)
      const topPlayers = await ctx.redis.send("ZREVRANGE", [leaderboardKey, "0", "2", "WITHSCORES"]);

      expect(topPlayers).toMatchInlineSnapshot(`
        [
          [
            "player4",
            300,
          ],
          [
            "player2",
            200,
          ],
          [
            "player3",
            150,
          ],
        ]
      `);

      // Get player rank (0-based)
      const player3Rank = await ctx.redis.send("ZREVRANK", [leaderboardKey, "player3"]);
      expect(player3Rank).toBe(2); // 0-based index, so 3rd place is 2

      // Get player score
      const player3Score = await ctx.redis.send("ZSCORE", [leaderboardKey, "player3"]);
      expect(player3Score).toBe(150);

      // Increment a score
      await ctx.redis.send("ZINCRBY", [leaderboardKey, "25", "player3"]);

      // Verify score was updated
      const updatedScore = await ctx.redis.send("ZSCORE", [leaderboardKey, "player3"]);
      expect(updatedScore).toBe(175);

      // Get updated rank
      const updatedRank = await ctx.redis.send("ZREVRANK", [leaderboardKey, "player3"]);
      expect(updatedRank).toBe(2); // Still in third place

      // Get count of players with scores between 100 and 200
      const countInRange = await ctx.redis.send("ZCOUNT", [leaderboardKey, "100", "200"]);
      expect(countInRange).toBe(3); // player1, player3, player2
    });
  });

  describe("Distributed Locks", () => {
    test("should implement a simple distributed lock", async () => {
      const lockName = ctx.generateKey("lock-resource");
      const lockValue = randomUUIDv7(); // Unique identifier for the owner
      const lockTimeout = 10; // seconds

      // Acquire the lock
      const acquireResult = await ctx.redis.send("SET", [
        lockName,
        lockValue,
        "NX", // Only set if key doesn't exist
        "EX",
        lockTimeout.toString(),
      ]);

      // Should acquire the lock successfully
      expect(acquireResult).toBe("OK");

      // Try to acquire again (should fail as it's already locked)
      const retryResult = await ctx.redis.send("SET", [lockName, "other-value", "NX", "EX", lockTimeout.toString()]);

      // Should return null (lock not acquired)
      expect(retryResult).toBeNull();

      // LUA script for safe release (only release if we own the lock)
      const releaseLockScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      // Release the lock
      const releaseResult = await ctx.redis.send("EVAL", [
        releaseLockScript,
        "1", // Number of keys
        lockName, // KEYS[1]
        lockValue, // ARGV[1]
      ]);

      // Should return 1 (lock released)
      expect(releaseResult).toBe(1);

      // Try to release again (should fail as lock is gone)
      const reReleaseResult = await ctx.redis.send("EVAL", [releaseLockScript, "1", lockName, lockValue]);

      // Should return 0 (no lock to release)
      expect(reReleaseResult).toBe(0);

      // Verify lock is gone
      const finalCheck = await ctx.redis.get(lockName);
      expect(finalCheck).toBeNull();
    });
  });
});
