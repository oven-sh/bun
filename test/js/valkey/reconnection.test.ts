import { RedisClient } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, isEnabled } from "./test-utils";

describe.skipIf(!isEnabled)("Redis Reconnection", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });

  test("should reconnect after manual close when new command is issued", async () => {
    const redis = ctx.redis;
    
    // 1. Verify initial connection works
    await redis.set("reconnect-test", "initial-value");
    const initialValue = await redis.get("reconnect-test");
    expect(initialValue).toBe("initial-value");

    // 2. Manually close the connection
    redis.close();
    
    // Wait for connection to be closed
    await new Promise(resolve => setTimeout(resolve, 50));

    // 3. Issue a new command - this should trigger reconnection
    const setResult = await redis.set("reconnect-test", "after-reconnect");
    expect(setResult).toBe("OK");

    // 4. Verify the value was set correctly
    const newValue = await redis.get("reconnect-test");
    expect(newValue).toBe("after-reconnect");
    expect(redis.connected).toBe(true);
  });

  test("should handle multiple commands after reconnection", async () => {
    const redis = ctx.redis;
    
    // Set initial data
    await redis.set("multi1", "value1");
    await redis.set("multi2", "value2");
    await redis.set("multi3", "value3");
    
    // Close connection
    redis.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Issue multiple commands rapidly after reconnection
    const promises = [
      redis.set("multi1", "new1"),
      redis.set("multi2", "new2"),
      redis.get("multi3"),
      redis.set("multi4", "new4"),
      redis.get("multi1"),
      redis.get("multi2"),
      redis.get("multi4"),
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
      await redis.set(`repeat${i}`, `value${i}`);
      
      // Verify
      const value = await redis.get(`repeat${i}`);
      expect(value).toBe(`value${i}`);
      
      // Close and reconnect
      redis.close();
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Next command should trigger reconnection
      await redis.set(`repeat${i}_after`, `after${i}`);
      const afterValue = await redis.get(`repeat${i}_after`);
      expect(afterValue).toBe(`after${i}`);
    }
    
    expect(redis.connected).toBe(true);
  });

  test("should handle different Redis commands after reconnection", async () => {
    const redis = ctx.redis;
    
    // Test various Redis commands after reconnection
    await redis.set("counter", "10");
    
    redis.close();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Test different command types
    const incrResult = await redis.incr("counter");
    expect(incrResult).toBe(11);

    const decrResult = await redis.decr("counter");  
    expect(decrResult).toBe(10);

    const existsResult = await redis.exists("counter");
    expect(existsResult).toBe(true);

    const expireResult = await redis.expire("counter", 60);
    expect(expireResult).toBe(1);

    const ttlResult = await redis.ttl("counter");
    expect(ttlResult).toBeGreaterThan(0);
    expect(ttlResult).toBeLessThanOrEqual(60);
    
    expect(redis.connected).toBe(true);
  });

  test("should handle large data reconnection", async () => {
    const redis = ctx.redis;
    
    // Create large data
    const largeValue = "x".repeat(10000); // 10KB string
    await redis.set("large", largeValue);

    redis.close();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Retrieve large data after reconnection
    const retrieved = await redis.get("large");
    expect(retrieved).toBe(largeValue);
    expect(retrieved?.length).toBe(10000);
    
    expect(redis.connected).toBe(true);
  });

  test("should maintain connection state correctly", async () => {
    const redis = ctx.redis;
    
    // Force initial connection with a command
    await redis.set("state", "initial");
    expect(redis.connected).toBe(true);

    // After close
    redis.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(redis.connected).toBe(false);

    // After reconnection command
    await redis.set("state", "test");
    expect(redis.connected).toBe(true);

    // Verify state persists
    await redis.get("state");
    expect(redis.connected).toBe(true);
  });

  test("should handle quick successive reconnections", async () => {
    const redis = ctx.redis;
    
    // Quick successive close/command cycles
    for (let i = 0; i < 3; i++) {
      await redis.set(`quick${i}`, `value${i}`);
      redis.close();
      // Don't wait - immediately issue next command
      await redis.set(`quick${i}_immediate`, `immediate${i}`);
      
      const value = await redis.get(`quick${i}_immediate`);
      expect(value).toBe(`immediate${i}`);
    }
    
    expect(redis.connected).toBe(true);
  });
});