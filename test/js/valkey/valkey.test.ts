import { randomUUIDv7, RedisClient, spawn } from "bun";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { bunExe } from "harness";
import {
  ctx as _ctx,
  awaitableCounter,
  ConnectionType,
  createClient,
  DEFAULT_REDIS_URL,
  isEnabled,
  setupDockerContainer,
  TLS_REDIS_OPTIONS,
  TLS_REDIS_URL,
} from "./test-utils";
import type { RedisTestStartMessage } from "./valkey.failing-subscriber";

for (const connectionType of [ConnectionType.TLS, ConnectionType.TCP]) {
  const ctx = { ..._ctx, redis: connectionType ? _ctx.redis : (_ctx.redisTLS as RedisClient) };
  describe.skipIf(!isEnabled)(`Valkey Redis Client (${connectionType})`, () => {
    beforeAll(async () => {
      await setupDockerContainer();
      if (!ctx.redis) {
        ctx.redis = createClient(connectionType);
      }
    });

    beforeEach(async () => {
      if (!ctx.redis) {
        ctx.redis = createClient(connectionType);
      }

      await ctx.redis.connect();
      await ctx.redis.send("FLUSHALL", ["SYNC"]);
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
        await ctx.cleanupSubscribers();
      });

      test("callback errors don't crash the client", async () => {
        const channel = "error-callback-channel";

        const STEP_SUBSCRIBED = 1;
        const STEP_FIRST_MESSAGE = 2;
        const STEP_SECOND_MESSAGE = 3;
        const STEP_THIRD_MESSAGE = 4;

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

          expect(await ctx.redis.publish(channel, "message1")).toBeGreaterThanOrEqual(1);
          await stepCounter.untilValue(STEP_FIRST_MESSAGE);
          expect(currentMessage.event).toBe("message");
          expect(currentMessage.index).toBe(1);

          expect(await ctx.redis.publish(channel, "message2")).toBeGreaterThanOrEqual(1);
          await stepCounter.untilValue(STEP_SECOND_MESSAGE);
          expect(currentMessage.event).toBe("exception");
          //expect(currentMessage.index).toBe(2);

          expect(await ctx.redis.publish(channel, "message3")).toBeGreaterThanOrEqual(1);
          await stepCounter.untilValue(STEP_THIRD_MESSAGE);
          expect(currentMessage.event).toBe("message");
          expect(currentMessage.index).toBe(3);
        } finally {
          subscriberProc.kill();
          await subscriberProc.exited;
        }
      });
    });

    describe("duplicate()", () => {
      test("should create duplicate of connected client that gets connected", async () => {
        const duplicate = await ctx.redis.duplicate();

        expect(duplicate.connected).toBe(true);
        expect(duplicate).not.toBe(ctx.redis);

        await ctx.redis.set("test-original", "original-value");
        await duplicate.set("test-duplicate", "duplicate-value");

        expect(await ctx.redis.get("test-duplicate")).toBe("duplicate-value");
        expect(await duplicate.get("test-original")).toBe("original-value");

        duplicate.close();
      });

      test("should preserve connection configuration in duplicate", async () => {
        await ctx.redis.connect();

        const duplicate = await ctx.redis.duplicate();

        const testKey = `duplicate-config-test-${randomUUIDv7().substring(0, 8)}`;
        const testValue = "test-value";

        await ctx.redis.set(testKey, testValue);
        const retrievedValue = await duplicate.get(testKey);

        expect(retrievedValue).toBe(testValue);

        duplicate.close();
      });

      test("should allow duplicate to work independently from original", async () => {
        const duplicate = await ctx.redis.duplicate();

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

        await subscriber.subscribe(testChannel, () => {});

        const duplicate = await subscriber.duplicate();

        expect(() => duplicate.set("test-key", "test-value")).not.toThrow();

        await subscriber.unsubscribe(testChannel);
      });

      test("should create multiple duplicates from same client", async () => {
        await ctx.redis.connect();

        const duplicate1 = await ctx.redis.duplicate();
        const duplicate2 = await ctx.redis.duplicate();
        const duplicate3 = await ctx.redis.duplicate();

        expect(duplicate1.connected).toBe(true);
        expect(duplicate2.connected).toBe(true);
        expect(duplicate3.connected).toBe(true);

        const testKey = `multi-duplicate-test-${randomUUIDv7().substring(0, 8)}`;
        await duplicate1.set(`${testKey}-1`, "value-1");
        await duplicate2.set(`${testKey}-2`, "value-2");
        await duplicate3.set(`${testKey}-3`, "value-3");

        expect(await duplicate1.get(`${testKey}-1`)).toBe("value-1");
        expect(await duplicate2.get(`${testKey}-2`)).toBe("value-2");
        expect(await duplicate3.get(`${testKey}-3`)).toBe("value-3");

        expect(await duplicate1.get(`${testKey}-2`)).toBe("value-2");
        expect(await duplicate2.get(`${testKey}-3`)).toBe("value-3");
        expect(await duplicate3.get(`${testKey}-1`)).toBe("value-1");

        duplicate1.close();
        duplicate2.close();
        duplicate3.close();
      });

      test("should duplicate client that failed to connect", async () => {
        const url = new URL(connectionType === ConnectionType.TLS ? TLS_REDIS_URL : DEFAULT_REDIS_URL);
        url.username = "invaliduser";
        url.password = "invalidpassword";
        const failedRedis = new RedisClient(url.toString(), {
          tls: connectionType === ConnectionType.TLS ? TLS_REDIS_OPTIONS.tls : false,
        });

        let connectionFailed = false;
        try {
          await failedRedis.connect();
        } catch {
          connectionFailed = true;
        }

        expect(connectionFailed).toBe(true);
        expect(failedRedis.connected).toBe(false);

        const duplicate = await failedRedis.duplicate();
        expect(duplicate.connected).toBe(false);
      });

      test("should handle duplicate timing with concurrent operations", async () => {
        await ctx.redis.connect();

        const testKey = `concurrent-test-${randomUUIDv7().substring(0, 8)}`;
        const originalOperation = ctx.redis.set(testKey, "original-value");

        const duplicate = await ctx.redis.duplicate();

        await originalOperation;

        expect(await duplicate.get(testKey)).toBe("original-value");

        duplicate.close();
      });
    });
  });
}
