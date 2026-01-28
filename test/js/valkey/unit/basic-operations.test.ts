import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, expectType, isEnabled } from "../test-utils";

/**
 * Test suite covering basic Redis operations
 * - String operations (SET, GET, APPEND, GETDEL, etc)
 * - Key expiration (EXPIRE, TTL)
 * - Counter operations (INCR, DECR, INCRBY, DECRBY)
 * - Existence checks (EXISTS)
 * - Deletion operations (DEL)
 */
describe.skipIf(!isEnabled)("Valkey: Basic String Operations", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });
  describe("String Commands", () => {
    test("SET and GET commands", async () => {
      const key = ctx.generateKey("string-test");
      const value = "Hello Valkey!";

      // SET should return OK
      const setResult = await ctx.redis.set(key, value);
      expect(setResult).toBe("OK");

      // GET should return the value
      const getResult = await ctx.redis.get(key);
      expect(getResult).toBe(value);

      // GET non-existent key should return null
      const nonExistentKey = ctx.generateKey("non-existent");
      const nullResult = await ctx.redis.get(nonExistentKey);
      expect(nullResult).toBeNull();
    });

    test("MGET command", async () => {
      const key1 = ctx.generateKey("mget-test-1");
      const key2 = ctx.generateKey("mget-test-2");
      const value1 = "Hello";
      const value2 = "World";

      await ctx.redis.set(key1, value1);
      await ctx.redis.set(key2, value2);

      const result = await ctx.redis.mget(key1, key2, ctx.generateKey("non-existent"));
      expect(result).toEqual([value1, value2, null]);
    });

    test("SET with expiry option", async () => {
      const key = ctx.generateKey("expiry-set-test");

      // Set with expiry (EX option)
      await ctx.redis.send("SET", [key, "expires-soon", "EX", "1"]);

      // Key should exist immediately
      const existsNow = await ctx.redis.exists(key);
      expect(existsNow).toBe(true);

      // Poll until key expires (max 2 seconds)
      let expired = false;
      const startTime = Date.now();
      while (!expired && Date.now() - startTime < 2000) {
        expired = !(await ctx.redis.exists(key));
        if (!expired) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      expect(expired).toBe(true);
    });

    test("APPEND command", async () => {
      const key = ctx.generateKey("append-test");
      const initialValue = "Hello";
      const appendValue = " World";

      // Set initial value
      await ctx.redis.set(key, initialValue);

      // Append additional content
      const newLength = await ctx.redis.send("APPEND", [key, appendValue]);
      expectType<number>(newLength, "number");
      expect(newLength).toBe(initialValue.length + appendValue.length);

      // Verify appended content
      const finalValue = await ctx.redis.get(key);
      expect(finalValue).toBe(initialValue + appendValue);
    });

    test("GETDEL command", async () => {
      const key = ctx.generateKey("getdel-test");
      const value = "value-to-get-and-delete";

      // Set the value
      await ctx.redis.set(key, value);

      // Get and delete in one operation
      const result = await ctx.redis.send("GETDEL", [key]);
      expect(result).toBe(value);

      // Verify key is gone
      const exists = await ctx.redis.exists(key);
      expect(exists).toBe(false);
    });

    describe("GETEX", () => {
      test("with expiration parameters", async () => {
        const key = ctx.generateKey("getex-test");
        const value = "getex test value";

        // Set up a key first
        await ctx.redis.set(key, value);

        // Test GETEX without expiration parameters (just get the value)
        const value1 = await ctx.redis.getex(key);
        expect(value1).toBe(value);

        // Test GETEX with EX (expiration in seconds)
        const value2 = await ctx.redis.getex(key, "EX", 60);
        expect(value2).toBe(value);
        const ttl1 = await ctx.redis.ttl(key);
        expect(ttl1).toBeGreaterThan(0);
        expect(ttl1).toBeLessThanOrEqual(60);

        // Test GETEX with PX (expiration in milliseconds)
        const value3 = await ctx.redis.getex(key, "PX", 30000);
        expect(value3).toBe(value);
        const ttl2 = await ctx.redis.ttl(key);
        expect(ttl2).toBeGreaterThan(0);
        expect(ttl2).toBeLessThanOrEqual(30);

        // Test GETEX with EXAT (expiration at Unix timestamp in seconds)
        const futureTimestamp = Math.floor(Date.now() / 1000) + 45;
        const value4 = await ctx.redis.getex(key, "EXAT", futureTimestamp);
        expect(value4).toBe(value);
        const ttl3 = await ctx.redis.ttl(key);
        expect(ttl3).toBeGreaterThan(0);
        expect(ttl3).toBeLessThanOrEqual(45);

        // Test GETEX with PXAT (expiration at Unix timestamp in milliseconds)
        const futureTimestampMs = Date.now() + 20000;
        const value5 = await ctx.redis.getex(key, "PXAT", futureTimestampMs);
        expect(value5).toBe(value);
        const ttl4 = await ctx.redis.ttl(key);
        expect(ttl4).toBeGreaterThan(0);
        expect(ttl4).toBeLessThanOrEqual(20);

        // Test GETEX with PERSIST (remove expiration)
        const value6 = await ctx.redis.getex(key, "PERSIST");
        expect(value6).toBe(value);
        const ttl5 = await ctx.redis.ttl(key);
        expect(ttl5).toBe(-1); // -1 means no expiration

        // Test GETEX on non-existent key
        const nonExistentKey = ctx.generateKey("getex-nonexistent");
        const value7 = await ctx.redis.getex(nonExistentKey);
        expect(value7).toBeNull();
      });

      test("with non-string keys", async () => {
        // Test with Buffer key
        const bufferKey = Buffer.from(ctx.generateKey("getex-buffer"));
        await ctx.redis.set(bufferKey, "buffer value");
        const bufferResult = await ctx.redis.getex(bufferKey, "EX", 60);
        expect(bufferResult).toBe("buffer value");

        // Test with Uint8Array key
        const uint8Key = new Uint8Array(Buffer.from(ctx.generateKey("getex-uint8")));
        await ctx.redis.set(uint8Key, "uint8 value");
        const uint8Result = await ctx.redis.getex(uint8Key, "PX", 5000);
        expect(uint8Result).toBe("uint8 value");
      });
    });

    test("GETRANGE command", async () => {
      const key = ctx.generateKey("getrange-test");
      const value = "Hello Valkey World";

      // Set the value
      await ctx.redis.set(key, value);

      // Get substring using GETRANGE
      const result = await ctx.redis.send("GETRANGE", [key, "6", "12"]);
      expect(result).toBe("Valkey ");
    });

    test("SETRANGE command", async () => {
      const key = ctx.generateKey("setrange-test");
      const value = "Hello World";

      // Set the initial value
      await ctx.redis.set(key, value);

      // Replace "World" with "Valkey" starting at position 6
      const newLength = await ctx.redis.send("SETRANGE", [key, "6", "Valkey"]);
      expectType<number>(newLength, "number");

      // Expected length is the maximum of original length and (offset + replacement length)
      const expectedLength = Math.max(value.length, 6 + "Valkey".length);
      expect(newLength).toBe(expectedLength);

      // Verify the updated string
      const updatedValue = await ctx.redis.get(key);
      expect(updatedValue).toBe("Hello Valkey");
    });

    test("STRLEN command", async () => {
      const key = ctx.generateKey("strlen-test");
      const value = "Hello Valkey";

      // Set the value
      await ctx.redis.set(key, value);

      // Get string length
      const length = await ctx.redis.send("STRLEN", [key]);
      expectType<number>(length, "number");
      expect(length).toBe(value.length);
    });
  });

  describe("Counter Operations", () => {
    test("INCR and DECR commands", async () => {
      const key = ctx.generateKey("counter-test");

      // Set initial counter value
      await ctx.redis.set(key, "10");

      // INCR should increment and return new value
      const incremented = await ctx.redis.incr(key);
      expectType<number>(incremented, "number");
      expect(incremented).toBe(11);

      // DECR should decrement and return new value
      const decremented = await ctx.redis.decr(key);
      expectType<number>(decremented, "number");
      expect(decremented).toBe(10);
    });

    test("INCRBY and DECRBY commands", async () => {
      const key = ctx.generateKey("incrby-test");

      // Set initial counter value
      await ctx.redis.set(key, "10");

      // INCRBY should add specified value and return result
      const incremented = await ctx.redis.send("INCRBY", [key, "5"]);
      expectType<number>(incremented, "number");
      expect(incremented).toBe(15);

      // DECRBY should subtract specified value and return result
      const decremented = await ctx.redis.send("DECRBY", [key, "7"]);
      expectType<number>(decremented, "number");
      expect(decremented).toBe(8);
    });

    test("INCRBYFLOAT command", async () => {
      const key = ctx.generateKey("incrbyfloat-test");

      // Set initial counter value
      await ctx.redis.set(key, "10.5");

      // INCRBYFLOAT should add specified float value and return result
      const result = await ctx.redis.send("INCRBYFLOAT", [key, "0.7"]);
      expectType<string>(result, "string");
      expect(result).toBe("11.2");

      // INCRBYFLOAT also works with negative values for subtraction
      const subtracted = await ctx.redis.send("INCRBYFLOAT", [key, "-1.2"]);
      expectType<string>(subtracted, "string");
      expect(subtracted).toBe("10");
    });
  });

  describe("Key Expiration", () => {
    test("EXPIRE and TTL commands", async () => {
      const key = ctx.generateKey("expire-test");

      // Set a key
      await ctx.redis.set(key, "expiring-value");

      // Set expiration (60 seconds)
      const expireResult = await ctx.redis.expire(key, 60);
      expectType<number>(expireResult, "number");
      expect(expireResult).toBe(1); // 1 indicates success

      // Get TTL
      const ttl = await ctx.redis.ttl(key);
      expectType<number>(ttl, "number");
      expect(ttl).toBeGreaterThan(0); // Should be positive number of seconds
      expect(ttl).toBeLessThanOrEqual(60);
    });

    test("TTL for non-existent and non-expiring keys", async () => {
      // Test non-existent key
      const nonExistentKey = ctx.generateKey("non-existent");
      const nonExistentTTL = await ctx.redis.ttl(nonExistentKey);
      expect(nonExistentTTL).toBe(-2); // -2 indicates key doesn't exist

      // Test key with no expiration
      const permanentKey = ctx.generateKey("permanent");
      await ctx.redis.set(permanentKey, "no-expiry");
      const permanentTTL = await ctx.redis.ttl(permanentKey);
      expect(permanentTTL).toBe(-1); // -1 indicates no expiration
    });

    test("PEXPIRE and PTTL commands (millisecond precision)", async () => {
      const key = ctx.generateKey("pexpire-test");

      // Set a key
      await ctx.redis.set(key, "expiring-value-ms");

      // Set expiration with millisecond precision (5000 ms = 5 seconds)
      const expireResult = await ctx.redis.send("PEXPIRE", [key, "5000"]);
      expectType<number>(expireResult, "number");
      expect(expireResult).toBe(1); // 1 indicates success

      // Get TTL with millisecond precision
      const pttl = await ctx.redis.send("PTTL", [key]);
      expectType<number>(pttl, "number");
      expect(pttl).toBeGreaterThan(0); // Should be positive number of milliseconds
      expect(pttl).toBeLessThanOrEqual(5000);
    });
  });

  describe("Existence and Deletion", () => {
    test("EXISTS command", async () => {
      const key = ctx.generateKey("exists-test");

      // Initially key should not exist
      const initialExists = await ctx.redis.exists(key);
      expect(initialExists).toBe(false);

      // Set the key
      await ctx.redis.set(key, "exists-now");

      // Now key should exist
      const nowExists = await ctx.redis.exists(key);
      expect(nowExists).toBe(true);
    });

    test("DEL command", async () => {
      const key1 = ctx.generateKey("del-test-1");
      const key2 = ctx.generateKey("del-test-2");

      // Set two keys
      await ctx.redis.set(key1, "value1");
      await ctx.redis.set(key2, "value2");

      // Delete a single key
      const singleDelCount = await ctx.redis.del(key1);
      expectType<number>(singleDelCount, "number");
      expect(singleDelCount).toBe(1); // 1 key deleted

      // Key should not exist anymore
      const exists1 = await ctx.redis.exists(key1);
      expect(exists1).toBe(false);

      // Second key should still exist
      const exists2 = await ctx.redis.exists(key2);
      expect(exists2).toBe(true);

      // Delete multiple keys using sendCommand
      const multipleDelCount = await ctx.redis.send("DEL", [key1, key2]);
      expectType<number>(multipleDelCount, "number");
      expect(multipleDelCount).toBe(1); // Only 1 key existed and was deleted
    });

    test("DEL command with multiple keys", async () => {
      const key1 = ctx.generateKey("del-test-1");
      const key2 = ctx.generateKey("del-test-2");
      const key3 = Buffer.from(ctx.generateKey("del-test-3"), "utf-8");
      const key4 = new Blob([ctx.generateKey("del-test-4")]);

      await ctx.redis.set(key1, "value1");
      await ctx.redis.set(key2, "value2");
      await ctx.redis.set(key3, "value3");
      await ctx.redis.set(key4, "value4");

      const multipleDelCount = await ctx.redis.del(key1, key2, key3, key4);
      expectType<number>(multipleDelCount, "number");
      expect(multipleDelCount).toBe(4); // 4 keys were deleted
    });

    test("UNLINK command (asynchronous delete)", async () => {
      const key1 = ctx.generateKey("unlink-test-1");
      const key2 = ctx.generateKey("unlink-test-2");

      // Set two keys
      await ctx.redis.set(key1, "value1");
      await ctx.redis.set(key2, "value2");

      // Unlink multiple keys
      const unlinkCount = await ctx.redis.send("UNLINK", [key1, key2]);
      expectType<number>(unlinkCount, "number");
      expect(unlinkCount).toBe(2); // 2 keys were unlinked

      // Keys should not exist anymore
      const exists1 = await ctx.redis.exists(key1);
      const exists2 = await ctx.redis.exists(key2);
      expect(exists1).toBe(false);
      expect(exists2).toBe(false);
    });
  });
});
