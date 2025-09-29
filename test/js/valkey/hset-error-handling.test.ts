import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";

describe("HSET error handling without server", () => {
  test("hset validates arguments at runtime", async () => {
    const client = new RedisClient({ socket: { host: "localhost", port: 6379 } });

    let thrown;
    try {
      // @ts-expect-error
      await client.hset();
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toContain("hset requires at least 2 arguments");

    thrown = undefined;
    try {
      // @ts-expect-error
      await client.hset("key");
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toContain("hset requires at least 2 arguments");

    thrown = undefined;
    try {
      // @ts-expect-error
      await client.hset("key", "field");
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toContain("object or field-value pairs");

    thrown = undefined;
    try {
      // @ts-expect-error
      await client.hset("key", "field1", "value1", "field2");
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toContain("hset requires field-value pairs");

    thrown = undefined;
    try {
      // @ts-expect-error
      await client.hset("key", "f1", "v1", "f2", "v2", "f3");
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toContain("hset requires field-value pairs");

    // Numbers are coerced to strings by Redis, which is valid behavior

    thrown = undefined;
    try {
      // @ts-expect-error
      await client.hset("key", "field", null);
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toMatch(/value.*string or buffer/i);

    thrown = undefined;
    try {
      // @ts-expect-error
      await client.hset("key", "field1", "value1", undefined, "value2");
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toMatch(/field.*string or buffer/i);

    thrown = undefined;
    try {
      // @ts-expect-error
      await client.hset("key", { field: "value" }, "value");
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toMatch(/field.*string or buffer/i);

    thrown = undefined;
    try {
      // @ts-expect-error
      await client.hset("key", "field", { nested: "object" });
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toMatch(/value.*string or buffer/i);
  });

  test("hset with object syntax - invalid values", async () => {
    const client = new RedisClient({ socket: { host: "localhost", port: 6379 } });

    let thrown;
    try {
      // @ts-expect-error
      await client.hset("key", { field: null });
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toMatch(/value.*string or buffer/i);

    thrown = undefined;
    try {
      // @ts-expect-error
      await client.hset("key", { field: undefined });
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toMatch(/value.*string or buffer/i);

    thrown = undefined;
    try {
      // @ts-expect-error
      await client.hset("key", null);
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toMatch(/object or field-value pairs/i);

    thrown = undefined;
    try {
      await client.hset("key", {});
    } catch (error: any) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).toContain("at least one field-value pair");
  });

  test("hset method signature is correct", () => {
    const client = new RedisClient({ socket: { host: "localhost", port: 6379 } });

    expect(typeof client.hset).toBe("function");
    expect(client.hset.length).toBe(3);
    expect(client.hset.name).toBe("hset");
  });
});
