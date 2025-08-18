import { randomUUIDv7, RedisClient, sleep } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, DEFAULT_REDIS_URL, expectType, isEnabled, randomCoinFlip } from "./test-utils";

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

  describe("PUB/SUB", () => {
    const testChannel = "test-channel";
    const testKey = "test-key";
    const testValue = "test-value";
    const testMessage = "test-message";
    const flushTimeoutMs = 100;

    const connectedRedis = async () => {
      const redis = new RedisClient("redis://localhost:6379");
      await redis.connect();
      return redis;
    };

    test("publishing to a channel does not fail", async () => {
      const redis = await connectedRedis();

      await redis.subscribe(testChannel, () => {});
      console.log("Subscribed to the channel.")

      expect(await redis.publish(testChannel, testMessage)).toBe(1);
      console.log("Published message to the channel.");

      // Clean up subscription to avoid affecting other tests
      await redis.unsubscribe(testChannel);
    });

    test("setting in subscriber mode gracefully fails", async () => {
      const redis = await connectedRedis();

      await redis.subscribe(testChannel, () => {});

      expect(() => redis.set(testKey, testValue)).toThrow("Cannot use in subscriber mode");

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
      await subscriber.subscribe(testChannel, (message) => {
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

    //test("subscribing to multiple channels receives messages", async () => {
    //  const TEST_MESSAGE_COUNT = 128;
    //  const redis = await connectedRedis();

    //  const channels = [testChannel, "another-test-channel"];

    //  var receivedMessages: { [channel: string]: string[] } = {};
    //  await redis.subscribe(channels, (message, channel) => {
    //    receivedMessages[channel] = receivedMessages[channel] || [];
    //    receivedMessages[channel].push(message);
    //  });

    //  var sentMessages: { [channel: string]: string[] } = {};
    //  for (let i = 0; i < TEST_MESSAGE_COUNT; i++) {
    //    const channel = channels[randomCoinFlip() ? 0 : 1];
    //    const message = randomUUIDv7();

    //    expect(await redis.publish(channel, message)).toBe(1);

    //    sentMessages[channel] = sentMessages[channel] || [];
    //    sentMessages[channel].push(message);
    //  }

    //  // Wait a little bit just to ensure all the messages are flushed.
    //  await sleep(flushTimeoutMs);

    //  // Check that we received messages on both channels
    //  expect(Object.keys(receivedMessages).sort()).toEqual(Object.keys(sentMessages).sort());

    //  // Check messages match for each channel
    //  for (const channel of channels) {
    //    if (sentMessages[channel]) {
    //      expect(receivedMessages[channel]).toEqual(sentMessages[channel]);
    //    }
    //  }
    //});

    //test("unsubscribing from specific channels while remaining subscribed to others", async () => {
    //  const redis = await connectedRedis();
    //  const channel1 = "channel-1";
    //  const channel2 = "channel-2";
    //  const channel3 = "channel-3";

    //  let receivedMessages: { [channel: string]: string[] } = {};

    //  // Subscribe to three channels
    //  await redis.subscribe([channel1, channel2, channel3], (message, channel) => {
    //    receivedMessages[channel] = receivedMessages[channel] || [];
    //    receivedMessages[channel].push(message);
    //  });

    //  // Send initial messages to all channels
    //  expect(await redis.publish(channel1, "msg1-before")).toBe(1);
    //  expect(await redis.publish(channel2, "msg2-before")).toBe(1);
    //  expect(await redis.publish(channel3, "msg3-before")).toBe(1);

    //  await sleep(flushTimeoutMs);

    //  // Unsubscribe from channel2
    //  await redis.unsubscribe(channel2);

    //  // Send messages after unsubscribing from channel2
    //  expect(await redis.publish(channel1, "msg1-after")).toBe(1);
    //  expect(await redis.publish(channel2, "msg2-after")).toBe(1);
    //  expect(await redis.publish(channel3, "msg3-after")).toBe(1);

    //  await sleep(flushTimeoutMs);

    //  // Check we received messages only on subscribed channels
    //  expect(receivedMessages[channel1]).toEqual(["msg1-before", "msg1-after"]);
    //  expect(receivedMessages[channel2]).toEqual(["msg2-before"]); // No "msg2-after"
    //  expect(receivedMessages[channel3]).toEqual(["msg3-before", "msg3-after"]);
    //});

    //test("subscribing to the same channel multiple times", async () => {
    //  const redis = await connectedRedis();
    //  const channel = "duplicate-channel";

    //  let callCount = 0;
    //  const listener = () => {
    //    callCount++;
    //  };

    //  // Subscribe to the same channel twice
    //  await redis.subscribe(channel, listener);
    //  await redis.subscribe(channel, listener);

    //  // Publish a single message
    //  expect(await redis.publish(channel, "test-message")).toBe(2);

    //  await sleep(flushTimeoutMs);

    //  // Should only receive the message once (last subscription wins)
    //  expect(callCount).toBe(1);
    //});

    //test("empty string messages", async () => {
    //  const redis = await connectedRedis();
    //  const channel = "empty-message-channel";

    //  let receivedMessage: string | undefined = undefined;
    //  await redis.subscribe(channel, (message) => {
    //    receivedMessage = message;
    //  });

    //  expect(await redis.publish(channel, "")).toBe(1);
    //  await sleep(flushTimeoutMs);

    //  expect(receivedMessage).not.toBeUndefined();
    //  expect(receivedMessage!).toBe("");
    //});

    //test("special characters in channel names", async () => {
    //  const redis = await connectedRedis();

    //  const specialChannels = [
    //    "channel:with:colons",
    //    "channel with spaces",
    //    "channel-with-unicode-😀",
    //    "channel[with]brackets",
    //    "channel@with#special$chars",
    //  ];

    //  for (const channel of specialChannels) {
    //    let received = false;
    //    await redis.subscribe(channel, () => {
    //      received = true;
    //    });

    //    expect(await redis.publish(channel, "test")).toBe(1);
    //    await sleep(flushTimeoutMs);

    //    expect(received).toBe(true);
    //    await redis.unsubscribe(channel);
    //  }
    //});

    //test("ping works in subscription mode", async () => {
    //  const redis = await connectedRedis();
    //  const channel = "ping-test-channel";

    //  await redis.subscribe(channel, () => {});

    //  // Ping should work in subscription mode
    //  const pong = await redis.ping();
    //  expect(pong).toBe("PONG");

    //  const customPing = await redis.ping("hello");
    //  expect(customPing).toBe("hello");
    //});

    //test("publish works from a subscribed client", async () => {
    //  const redis = await connectedRedis();
    //  const channel = "self-publish-channel";

    //  let receivedMessage: string | undefined = undefined;
    //  await redis.subscribe(channel, (message) => {
    //    receivedMessage = message;
    //  });

    //  // Publishing from the same client should work
    //  expect(await redis.publish(channel, "self-published")).toBe(1);
    //  await sleep(flushTimeoutMs);

    //  expect(receivedMessage).toBeDefined();
    //  expect(receivedMessage!).toBe("self-published");
    //});

    //test("complete unsubscribe restores normal command mode", async () => {
    //  const redis = await connectedRedis();
    //  const channel = "restore-test-channel";
    //  const testKey = "restore-test-key";

    //  await redis.subscribe(channel, () => {});

    //  // Should fail in subscription mode
    //  expect(redis.set(testKey, "value")).rejects.toBeDefined();

    //  // Unsubscribe from all channels
    //  await redis.unsubscribe(channel);

    //  // Should work after unsubscribing
    //  const result = await redis.set(testKey, "value");
    //  expect(result).toBe("OK");

    //  const value = await redis.get(testKey);
    //  expect(value).toBe("value");
    //});

    //test("publishing without subscribers succeeds", async () => {
    //  const redis = await connectedRedis();
    //  const channel = "no-subscribers-channel";

    //  // Publishing without subscribers should not throw
    //  expect(await redis.publish(channel, "message")).toBe(0);
    //});

    //test("unsubscribing from non-subscribed channels", async () => {
    //  const redis = await connectedRedis();
    //  const channel = "never-subscribed-channel";

    //  // Should not throw when unsubscribing from a channel we never subscribed to
    //  expect(redis.unsubscribe(channel)).resolves.toBeUndefined();
    //});

    //test("callback errors don't crash the client", async () => {
    //  const redis = await connectedRedis();
    //  const channel = "error-callback-channel";

    //  let messageCount = 0;
    //  await redis.subscribe(channel, () => {
    //    messageCount++;
    //    if (messageCount === 2) {
    //      throw new Error("Intentional callback error");
    //    }
    //  });

    //  // Send multiple messages
    //  expect(await redis.publish(channel, "message1")).toBe(1);
    //  expect(await redis.publish(channel, "message2")).toBe(1);
    //  expect(await redis.publish(channel, "message3")).toBe(1);

    //  await sleep(flushTimeoutMs);

    //  // Should have processed all messages despite the error
    //  expect(messageCount).toBe(3);
    //});
  });
});
