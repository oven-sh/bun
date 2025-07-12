import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, isEnabled, testKey } from "./test-utils";

describe.skipIf(!isEnabled)("Redis Reconnection", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP, {
      enable_auto_reconnect: true,
      enable_offline_queue: true,
    });
  });

  test("should reconnect after manual close when new command is issued", async () => {
    const redis = ctx.redis;

    // 1. Verify initial connection works
    await redis.set(testKey("reconnect-test"), "initial-value");
    const initialValue = await redis.get(testKey("reconnect-test"));
    expect(initialValue).toBe("initial-value");

    // 2. Manually close the connection
    redis.close();

    // Wait for connection to be closed
    await new Promise(resolve => setTimeout(resolve, 50));

    // 3. Issue a new command - this should trigger reconnection
    const setResult = await redis.set(testKey("reconnect-test"), "after-reconnect");
    expect(setResult).toBe("OK");

    // 4. Verify the value was set correctly
    const newValue = await redis.get(testKey("reconnect-test"));
    expect(newValue).toBe("after-reconnect");
    expect(redis.connected).toBe(true);
  });

  test("should handle multiple commands after reconnection", async () => {
    const redis = ctx.redis;

    // Set initial data
    await redis.set(testKey("multi1"), "value1");
    await redis.set(testKey("multi2"), "value2");
    await redis.set(testKey("multi3"), "value3");

    // Close connection
    redis.close();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Issue multiple commands rapidly after reconnection
    const promises = [
      redis.set(testKey("multi1"), "new1"),
      redis.set(testKey("multi2"), "new2"),
      redis.get(testKey("multi3")),
      redis.set(testKey("multi4"), "new4"),
      redis.get(testKey("multi1")),
      redis.get(testKey("multi2")),
      redis.get(testKey("multi4")),
    ];

    const results = await Promise.all(promises);

    // Verify results
    expect(results[0]).toBe("OK"); // SET multi1
    expect(results[1]).toBe("OK"); // SET multi2
    expect(results[2]).toBe("value3"); // GET multi3
    expect(results[3]).toBe("OK"); // SET multi4
    expect(results[4]).toBe("new1"); // GET multi1
    expect(results[5]).toBe("new2"); // GET multi2
    expect(results[6]).toBe("new4"); // GET multi4

    expect(redis.connected).toBe(true);
  });

  test("should handle repeated reconnections", async () => {
    const redis = ctx.redis;

    for (let i = 0; i < 3; i++) {
      // Set value
      await redis.set(testKey(`repeat${i}`), `value${i}`);

      // Verify
      const value = await redis.get(testKey(`repeat${i}`));
      expect(value).toBe(`value${i}`);

      // Close and reconnect
      redis.close();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Next command should trigger reconnection
      await redis.set(testKey(`repeat${i}_after`), `after${i}`);
      const afterValue = await redis.get(testKey(`repeat${i}_after`));
      expect(afterValue).toBe(`after${i}`);
    }

    expect(redis.connected).toBe(true);
  });

  test("should handle different Redis commands after reconnection", async () => {
    const redis = ctx.redis;

    // Test various Redis commands after reconnection
    await redis.set(testKey("counter"), "10");

    redis.close();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Test different command types
    const incrResult = await redis.incr(testKey("counter"));
    expect(incrResult).toBe(11);

    const decrResult = await redis.decr(testKey("counter"));
    expect(decrResult).toBe(10);

    const existsResult = await redis.exists(testKey("counter"));
    expect(existsResult).toBe(true);

    const expireResult = await redis.expire(testKey("counter"), 60);
    expect(expireResult).toBe(1);

    const ttlResult = await redis.ttl(testKey("counter"));
    expect(ttlResult).toBeGreaterThan(0);
    expect(ttlResult).toBeLessThanOrEqual(60);

    expect(redis.connected).toBe(true);
  });

  test("should handle large data reconnection", async () => {
    const redis = ctx.redis;

    // Create large data
    const largeValue = "x".repeat(10000); // 10KB string
    await redis.set(testKey("large"), largeValue);

    redis.close();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Retrieve large data after reconnection
    const retrieved = await redis.get(testKey("large"));
    expect(retrieved).toBe(largeValue);
    expect(retrieved?.length).toBe(10000);

    expect(redis.connected).toBe(true);
  });

  test("should maintain connection state correctly", async () => {
    const redis = ctx.redis;

    // Force initial connection with a command
    await redis.set(testKey("state"), "initial");
    expect(redis.connected).toBe(true);

    // After close
    redis.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(redis.connected).toBe(false);

    // After reconnection command
    await redis.set(testKey("state"), "test");
    expect(redis.connected).toBe(true);

    // Verify state persists
    await redis.get(testKey("state"));
    expect(redis.connected).toBe(true);
  });

  test("should handle quick successive reconnections", async () => {
    const redis = ctx.redis;

    // Quick successive close/command cycles
    for (let i = 0; i < 3; i++) {
      await redis.set(testKey(`quick${i}`), `value${i}`);
      redis.close();
      // Don't wait - immediately issue next command
      await redis.set(testKey(`quick${i}_immediate`), `immediate${i}`);

      const value = await redis.get(testKey(`quick${i}_immediate`));
      expect(value).toBe(`immediate${i}`);
    }

    expect(redis.connected).toBe(true);
  });
});
