import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";

describe("HSET error handling without server", () => {
  test("hset validates arguments at runtime", async () => {
    const client = new RedisClient({ socket: { host: "localhost", port: 6379 } });

    try {
      // @ts-expect-error
      await client.hset();
    } catch (error: any) {
      expect(error.message).toContain("hset requires at least 3 arguments");
    }

    try {
      // @ts-expect-error
      await client.hset("key");
    } catch (error: any) {
      expect(error.message).toContain("hset requires at least 3 arguments");
    }

    try {
      // @ts-expect-error
      await client.hset("key", "field");
    } catch (error: any) {
      expect(error.message).toContain("hset requires at least 3 arguments");
    }

    try {
      // @ts-expect-error
      await client.hset("key", "field1", "value1", "field2");
    } catch (error: any) {
      expect(error.message).toContain("hset requires field-value pairs");
    }

    try {
      // @ts-expect-error
      await client.hset("key", "f1", "v1", "f2", "v2", "f3");
    } catch (error: any) {
      expect(error.message).toContain("hset requires field-value pairs");
    }

    try {
      // @ts-expect-error
      await client.hset(123, "field", "value");
    } catch (error: any) {
      expect(error.message).toMatch(/key.*string or buffer/i);
    }

    try {
      // @ts-expect-error
      await client.hset("key", 123, "value");
    } catch (error: any) {
      expect(error.message).toMatch(/field.*string or buffer/i);
    }

    try {
      // @ts-expect-error
      await client.hset("key", "field", null);
    } catch (error: any) {
      expect(error.message).toMatch(/value.*string or buffer/i);
    }

    try {
      // @ts-expect-error
      await client.hset("key", "field1", "value1", undefined, "value2");
    } catch (error: any) {
      expect(error.message).toMatch(/field.*string or buffer/i);
    }

    try {
      // @ts-expect-error
      await client.hset("key", { field: "value" }, "value");
    } catch (error: any) {
      expect(error.message).toMatch(/field.*string or buffer/i);
    }

    try {
      // @ts-expect-error
      await client.hset("key", "field", { nested: "object" });
    } catch (error: any) {
      expect(error.message).toMatch(/value.*string or buffer/i);
    }
  });

  test("hset method signature is correct", () => {
    const client = new RedisClient({ socket: { host: "localhost", port: 6379 } });

    expect(typeof client.hset).toBe("function");
    expect(client.hset.length).toBe(3);
    expect(client.hset.name).toBe("hset");
  });
});
