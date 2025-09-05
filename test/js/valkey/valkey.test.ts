import { randomUUIDv7, RedisClient, sleep } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  ConnectionType,
  createClient,
  ctx,
  DEFAULT_REDIS_URL,
  expectType,
  isEnabled,
  randomCoinFlip,
} from "./test-utils";

describe.skipIf(!isEnabled)("Valkey Redis Client", () => {
  beforeEach(async () => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);

    await ctx.redis.send("FLUSHALL", ["SYNC"]);
  });

  const connectedRedis = async () => {
    const redis = new RedisClient(DEFAULT_REDIS_URL);
    await redis.connect();
    return redis;
  };

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

    const testKeyUniquePerDb = crypto.randomUUID();
    test.each([...Array(16).keys()])("Connecting to database with url $url succeeds", async (dbId: number) => {
      const redis = createClient(ConnectionType.TCP, {}, dbId);

      // Ensure the value is not in the database.
      const testValue = await redis.get(testKeyUniquePerDb);
      expect(testValue).toBeNull();

      redis.close();
    });
  });

  describe("Reconnections", () => {
    test("should automatically reconnect after connection drop", async () => {
      const TEST_KEY = "test-key";
      const TEST_VALUE = "test-value";

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
    const testChannel = "test-channel";
    const testKey = "test-key";
    const testValue = "test-value";
    const testMessage = "test-message";
    const flushTimeoutMs = 300;

    test("publishing to a channel does not fail", async () => {
      const redis = await connectedRedis();
      // no subs
      expect(await redis.publish(testChannel, testMessage)).toBe(0);
    });

    test("setting in subscriber mode gracefully fails", async () => {
      const redis = await connectedRedis();

      await redis.subscribe(testChannel, () => {});

      expect(() => redis.set(testKey, testValue)).toThrow("RedisClient.set cannot be called while in subscriber mode");

      // Clean up subscription
      await redis.unsubscribe(testChannel);
    });

    test("setting after unsubscribing works", async () => {
      const redis = await connectedRedis();

      await redis.subscribe(testChannel, () => {});
      await redis.unsubscribe(testChannel);

      expect(redis.set(testKey, testValue)).resolves.toEqual("OK");
    });

    test("subscribing to a channel receives messages", async () => {
      const TEST_MESSAGE_COUNT = 128;
      const redis = await connectedRedis();
      const subscriber = await connectedRedis();

      var receiveCount = 0;
      await subscriber.subscribe(testChannel, (message, channel) => {
        receiveCount++;
        expect(channel).toBe(testChannel);
        expect(message).toBe(testMessage);
      });

      Array.from({ length: TEST_MESSAGE_COUNT }).forEach(async () => {
        expect(await redis.publish(testChannel, testMessage)).toBe(1);
      });

      // Wait a little bit just to ensure all the messages are flushed.
      await sleep(flushTimeoutMs);

      expect(receiveCount).toBe(TEST_MESSAGE_COUNT);

      await subscriber.unsubscribe(testChannel);
    });

    test("messages are received in order", async () => {
      const TEST_MESSAGE_COUNT = 1024;
      const redis = await connectedRedis();
      const subscriber = await connectedRedis();

      var receivedMessages: string[] = [];
      await subscriber.subscribe(testChannel, message => {
        receivedMessages.push(message);
      });

      var sentMessages: string[] = [];
      Array.from({ length: TEST_MESSAGE_COUNT }).forEach(async () => {
        const message = randomUUIDv7();
        expect(await redis.publish(testChannel, message)).toBe(1);
        sentMessages.push(message);
      });

      // Wait a little bit just to ensure all the messages are flushed.
      await sleep(flushTimeoutMs);

      expect(receivedMessages.length).toBe(sentMessages.length);
      expect(receivedMessages).toEqual(sentMessages);

      await subscriber.unsubscribe(testChannel);
    });

    test("subscribing to multiple channels receives messages", async () => {
      const TEST_MESSAGE_COUNT = 128;
      const redis = await connectedRedis();
      const subscriber = await connectedRedis();

      const channels = [testChannel, "another-test-channel"];

      var receivedMessages: { [channel: string]: string[] } = {};
      await subscriber.subscribe(channels, (message, channel) => {
        receivedMessages[channel] = receivedMessages[channel] || [];
        receivedMessages[channel].push(message);
      });

      var sentMessages: { [channel: string]: string[] } = {};
      for (let i = 0; i < TEST_MESSAGE_COUNT; i++) {
        const channel = channels[randomCoinFlip() ? 0 : 1];
        const message = randomUUIDv7();

        expect(await redis.publish(channel, message)).toBe(1);

        sentMessages[channel] = sentMessages[channel] || [];
        sentMessages[channel].push(message);
      }

      // Wait a little bit just to ensure all the messages are flushed.
      await sleep(flushTimeoutMs);

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

      const redis = await connectedRedis();
      const subscriber = await connectedRedis();

      let receivedMessages: { [channel: string]: string[] } = {};

      // Subscribe to three channels
      await subscriber.subscribe([channel1, channel2, channel3], (message, channel) => {
        receivedMessages[channel] = receivedMessages[channel] || [];
        receivedMessages[channel].push(message);
      });

      // Send initial messages to all channels
      expect(await redis.publish(channel1, "msg1-before")).toBe(1);
      expect(await redis.publish(channel2, "msg2-before")).toBe(1);
      expect(await redis.publish(channel3, "msg3-before")).toBe(1);

      await sleep(flushTimeoutMs);

      // Unsubscribe from channel2
      await subscriber.unsubscribe(channel2);

      // Send messages after unsubscribing from channel2
      expect(await redis.publish(channel1, "msg1-after")).toBe(1);
      expect(await redis.publish(channel2, "msg2-after")).toBe(0);
      expect(await redis.publish(channel3, "msg3-after")).toBe(1);

      await sleep(flushTimeoutMs);

      // Check we received messages only on subscribed channels
      expect(receivedMessages[channel1]).toEqual(["msg1-before", "msg1-after"]);
      expect(receivedMessages[channel2]).toEqual(["msg2-before"]); // No "msg2-after"
      expect(receivedMessages[channel3]).toEqual(["msg3-before", "msg3-after"]);

      await subscriber.unsubscribe([channel1, channel3]);
    });

    test("subscribing to the same channel multiple times", async () => {
      const redis = await connectedRedis();
      const subscriber = await connectedRedis();
      const channel = "duplicate-channel";

      let callCount = 0;
      const listener = () => {
        callCount++;
      };

      let callCount2 = 0;
      const listener2 = () => {
        callCount2++;
      };

      // Subscribe to the same channel twice
      await subscriber.subscribe(channel, listener);
      await subscriber.subscribe(channel, listener2);

      // Publish a single message
      expect(await redis.publish(channel, "test-message")).toBe(1);

      await sleep(flushTimeoutMs);

      // Both listeners should have been called once.
      expect(callCount).toBe(1);
      expect(callCount2).toBe(1);

      await subscriber.unsubscribe(channel);
    });

    test("empty string messages", async () => {
      const redis = await connectedRedis();
      const channel = "empty-message-channel";
      const subscriber = await connectedRedis();

      let receivedMessage: string | undefined = undefined;
      await subscriber.subscribe(channel, message => {
        receivedMessage = message;
      });

      expect(await redis.publish(channel, "")).toBe(1);
      await sleep(flushTimeoutMs);

      expect(receivedMessage).not.toBeUndefined();
      expect(receivedMessage!).toBe("");

      await subscriber.unsubscribe(channel);
    });

    test("special characters in channel names", async () => {
      const redis = await connectedRedis();
      const subscriber = await connectedRedis();

      const specialChannels = [
        "channel:with:colons",
        "channel with spaces",
        "channel-with-unicode-😀",
        "channel[with]brackets",
        "channel@with#special$chars",
      ];

      for (const channel of specialChannels) {
        let received = false;
        await subscriber.subscribe(channel, () => {
          received = true;
        });

        expect(await redis.publish(channel, "test")).toBe(1);
        await sleep(flushTimeoutMs);

        expect(received).toBe(true);
        await subscriber.unsubscribe(channel);
      }
    });

    test("ping works in subscription mode", async () => {
      const redis = await connectedRedis();
      const channel = "ping-test-channel";

      await redis.subscribe(channel, () => {});

      // Ping should work in subscription mode
      const pong = await redis.ping();
      expect(pong).toBe("PONG");

      const customPing = await redis.ping("hello");
      expect(customPing).toBe("hello");

      await redis.unsubscribe(channel);
    });

    test("publish does not work from a subscribed client", async () => {
      const redis = await connectedRedis();
      const channel = "self-publish-channel";

      await redis.subscribe(channel, () => {});

      // Publishing from the same client should work
      expect(async () => redis.publish(channel, "self-published")).toThrow();
      await sleep(flushTimeoutMs);

      await redis.unsubscribe(channel);
    });

    test("complete unsubscribe restores normal command mode", async () => {
      const redis = await connectedRedis();
      const channel = "restore-test-channel";
      const testKey = "restore-test-key";

      await redis.subscribe(channel, () => {});

      // Should fail in subscription mode
      expect(() => redis.set(testKey, testValue)).toThrow("RedisClient.set cannot be called while in subscriber mode.");

      // Unsubscribe from all channels
      await redis.unsubscribe(channel);

      // Should work after unsubscribing
      const result = await redis.set(testKey, "value");
      expect(result).toBe("OK");

      const value = await redis.get(testKey);
      expect(value).toBe("value");
    });

    test("publishing without subscribers succeeds", async () => {
      const redis = await connectedRedis();
      const channel = "no-subscribers-channel";

      // Publishing without subscribers should not throw
      expect(await redis.publish(channel, "message")).toBe(0);
    });

    test("unsubscribing from non-subscribed channels", async () => {
      const redis = await connectedRedis();
      const channel = "never-subscribed-channel";

      expect(() => redis.unsubscribe(channel)).toThrow(
        "RedisClient.unsubscribe can only be called while in subscriber mode.",
      );
    });

    test("callback errors don't crash the client", async () => {
      const redis = await connectedRedis();
      const channel = "error-callback-channel";

      const subscriber = await connectedRedis();

      let messageCount = 0;
      await subscriber.subscribe(channel, () => {
        messageCount++;
        if (messageCount === 2) {
          throw new Error("Intentional callback error");
        }
      });

      // Send multiple messages
      expect(await redis.publish(channel, "message1")).toBe(1);
      expect(await redis.publish(channel, "message2")).toBe(1);
      expect(await redis.publish(channel, "message3")).toBe(1);

      await sleep(flushTimeoutMs);

      expect(messageCount).toBe(3);

      await subscriber.unsubscribe(channel);
    });

    test("subscriptions return correct counts", async () => {
      const subscriber = await connectedRedis();

      expect(await subscriber.subscribe("chan1", () => {})).toBe(1);
      expect(await subscriber.subscribe("chan2", () => {})).toBe(2);

      await subscriber.unsubscribe();
    });

    test("unsubscribing from listeners", async () => {
      const redis = await connectedRedis();
      const channel = "error-callback-channel";

      const subscriber = await connectedRedis();

      let messageCount1 = 0;
      const listener1 = () => {
        messageCount1++;
      };
      await subscriber.subscribe(channel, listener1);

      let messageCount2 = 0;
      const listener2 = () => {
        messageCount2++;
      };
      await subscriber.subscribe(channel, listener2);

      await redis.publish(channel, "message1");

      await sleep(flushTimeoutMs);

      expect(messageCount1).toBe(1);
      expect(messageCount2).toBe(1);

      await subscriber.unsubscribe(channel, listener2);

      await redis.publish(channel, "message1");

      await sleep(flushTimeoutMs);

      expect(messageCount1).toBe(2);
      expect(messageCount2).toBe(1);

      await subscriber.unsubscribe();

      await redis.publish(channel, "message1");

      await sleep(flushTimeoutMs);

      expect(messageCount1).toBe(2);
      expect(messageCount2).toBe(1);
    });
  });

  describe("duplicate()", () => {
    test("should create duplicate of unconnected client that remains unconnected", async () => {
      const redis = new RedisClient(DEFAULT_REDIS_URL);
      expect(redis.connected).toBe(false);

      const duplicate = await redis.duplicate();
      expect(duplicate.connected).toBe(false);
      expect(duplicate).not.toBe(redis);
    });

    test("should create duplicate of connected client that gets connected", async () => {
      const redis = await connectedRedis();

      const duplicate = await redis.duplicate();

      expect(duplicate.connected).toBe(true);
      expect(duplicate).not.toBe(redis);

      // Both should work independently
      await redis.set("test-original", "original-value");
      await duplicate.set("test-duplicate", "duplicate-value");

      expect(await redis.get("test-duplicate")).toBe("duplicate-value");
      expect(await duplicate.get("test-original")).toBe("original-value");

      duplicate.close();
    });

    test("should create duplicate of manually closed client that remains closed", async () => {
      const redis = new RedisClient(DEFAULT_REDIS_URL);
      await redis.connect();
      redis.close?.();
      expect(redis.connected).toBe(false);

      const duplicate = await redis.duplicate();
      expect(duplicate.connected).toBe(false);
    });

    test("should preserve connection configuration in duplicate", async () => {
      const redis = new RedisClient(DEFAULT_REDIS_URL);
      await redis.connect();

      const duplicate = await redis.duplicate();

      // Both clients should be able to perform the same operations
      const testKey = `duplicate-config-test-${randomUUIDv7().substring(0, 8)}`;
      const testValue = "test-value";

      await redis.set(testKey, testValue);
      const retrievedValue = await duplicate.get(testKey);

      expect(retrievedValue).toBe(testValue);

      duplicate.close?.();
    });

    test("should allow duplicate to work independently from original", async () => {
      const redis = new RedisClient(DEFAULT_REDIS_URL);
      await redis.connect();

      const duplicate = await redis.duplicate();

      // Close original, duplicate should still work
      redis.close?.();

      const testKey = `independent-test-${randomUUIDv7().substring(0, 8)}`;
      const testValue = "independent-value";

      await duplicate.set(testKey, testValue);
      const retrievedValue = await duplicate.get(testKey);

      expect(retrievedValue).toBe(testValue);

      duplicate.close?.();
    });

    test("should handle duplicate of client in subscriber mode", async () => {
      const redis = await connectedRedis();
      const testChannel = "test-subscriber-duplicate";

      // Put original client in subscriber mode
      await redis.subscribe(testChannel, () => {});

      const duplicate = await redis.duplicate();

      // Duplicate should not be in subscriber mode
      expect(() => duplicate.set("test-key", "test-value")).not.toThrow();

      await redis.unsubscribe(testChannel);
      duplicate.close?.();
    });

    test("should create multiple duplicates from same client", async () => {
      const redis = new RedisClient(DEFAULT_REDIS_URL);
      await redis.connect();

      const duplicate1 = await redis.duplicate();
      const duplicate2 = await redis.duplicate();
      const duplicate3 = await redis.duplicate();

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

      duplicate1.close?.();
      duplicate2.close?.();
      duplicate3.close?.();
      redis.close?.();
    });

    test("should duplicate client that failed to connect", async () => {
      // Create client with invalid credentials to force connection failure
      const url = new URL(DEFAULT_REDIS_URL);
      url.username = "invaliduser";
      url.password = "invalidpassword";
      const failedRedis = new RedisClient(url.toString());

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
      const redis = new RedisClient(DEFAULT_REDIS_URL);
      await redis.connect();

      // Start some operations on the original client
      const testKey = `concurrent-test-${randomUUIDv7().substring(0, 8)}`;
      const originalOperation = redis.set(testKey, "original-value");

      // Create duplicate while operation is in flight
      const duplicate = await redis.duplicate();

      // Wait for original operation to complete
      await originalOperation;

      // Duplicate should be able to read the value
      expect(await duplicate.get(testKey)).toBe("original-value");

      duplicate.close?.();
      redis.close?.();
    });
  });
});
