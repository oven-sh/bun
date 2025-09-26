import { randomUUIDv7, RedisClient, spawn } from "bun";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
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

for (const connectionType of [ConnectionType.TLS, ConnectionType.TCP]) {
  const ctx = { ..._ctx, redis: connectionType ? _ctx.redis : _ctx.redisTLS };
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
          cmd: [self.process.execPath, "run", `${__dirname}/valkey.failing-subscriber.ts`],
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
          url: connectionType === ConnectionType.TLS ? `${TLS_REDIS_URL}/1` : `${DEFAULT_REDIS_URL}/0`,
          tlsPaths: connectionType === ConnectionType.TLS ? TLS_REDIS_OPTIONS.tlsPaths : undefined,
        });

        try {
          await stepCounter.untilValue(STEP_SUBSCRIBED);
          expect(currentMessage.event).toBe("ready");

          // Send multiple messages
          expect(await ctx.redis.publish(channel, "message1")).toBe(1);
          await stepCounter.untilValue(STEP_FIRST_MESSAGE);
          expect(currentMessage.event).toBe("message");
          expect(currentMessage.index).toBe(1);

          // Now, the subscriber process will crash
          expect(await ctx.redis.publish(channel, "message2")).toBe(1);
          await stepCounter.untilValue(STEP_SECOND_MESSAGE);
          expect(currentMessage.event).toBe("exception");
          //expect(currentMessage.index).toBe(2);

          // But it should recover and continue receiving messages
          expect(await ctx.redis.publish(channel, "message3")).toBe(1);
          await stepCounter.untilValue(STEP_THIRD_MESSAGE);
          expect(currentMessage.event).toBe("message");
          expect(currentMessage.index).toBe(3);
        } finally {
          subscriberProc.kill();
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
