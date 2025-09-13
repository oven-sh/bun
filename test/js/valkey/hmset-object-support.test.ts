import { randomUUIDv7 } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, isEnabled } from "./test-utils";

describe.skipIf(!isEnabled)("HMSET object support", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });

  test("array format (existing)", async () => {
    const key = "test:array:" + randomUUIDv7().substring(0, 8);

    await ctx.redis.hmset(key, ["field1", "value1", "field2", "value2"]);
    const result = await ctx.redis.hgetall(key);

    expect(result).toEqual({ field1: "value1", field2: "value2" });
  });

  test("object format (new)", async () => {
    const key = "test:object:" + randomUUIDv7().substring(0, 8);
    const data = { name: "John", age: "30", active: "true" };

    await ctx.redis.hmset(key, data);
    const result = await ctx.redis.hgetall(key);

    expect(result).toEqual(data);
  });

  test("empty object should error", async () => {
    const key = "test:empty:" + randomUUIDv7().substring(0, 8);

    await expect(() => ctx.redis.hmset(key, {})).toThrow("Object must have at least one property");
  });

  test("complex field names", async () => {
    const key = "test:complex:" + randomUUIDv7().substring(0, 8);
    const data = {
      "field:colons": "value1",
      "field spaces": "value2",
      "unicode_🔑": "value3",
    };

    await ctx.redis.hmset(key, data);
    const result = await ctx.redis.hgetall(key);

    expect(result).toEqual(data);
  });

  test("invalid arguments", async () => {
    const key = "test:invalid:" + randomUUIDv7().substring(0, 8);

    await expect(() => ctx.redis.hmset(key, null)).toThrow();
    await expect(() => ctx.redis.hmset(key, "string")).toThrow();
    await expect(() => ctx.redis.hmset(key, 123)).toThrow();
  });

  test("odd array length should error", async () => {
    const key = "test:odd:" + randomUUIDv7().substring(0, 8);

    await expect(() => ctx.redis.hmset(key, ["field1", "value1", "field2"])).toThrow();
  });
});
