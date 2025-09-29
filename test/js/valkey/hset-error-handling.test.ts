import { describe, expect, test } from "bun:test";
import { RedisClient } from "bun";

describe("HSET error handling without server", () => {
  test("hset validates arguments at runtime", async () => {
    // Create a client without connecting (will fail at send, but should validate args first)
    const client = new RedisClient({ socket: { host: "localhost", port: 6379 } });

    // Test with too few arguments - should throw validation error
    try {
      // @ts-expect-error - Testing invalid arguments
      await client.hset();
    } catch (error: any) {
      expect(error.message).toContain("hset requires at least 3 arguments");
    }

    try {
      // @ts-expect-error - Testing invalid arguments
      await client.hset("key");
    } catch (error: any) {
      expect(error.message).toContain("hset requires at least 3 arguments");
    }

    try {
      // @ts-expect-error - Testing invalid arguments
      await client.hset("key", "field");
    } catch (error: any) {
      expect(error.message).toContain("hset requires at least 3 arguments");
    }

    // Test with invalid number of arguments (uneven field-value pairs)
    try {
      // @ts-expect-error - Testing invalid arguments
      await client.hset("key", "field1", "value1", "field2");
    } catch (error: any) {
      expect(error.message).toContain("hset requires field-value pairs");
    }

    try {
      // @ts-expect-error - Testing invalid arguments
      await client.hset("key", "f1", "v1", "f2", "v2", "f3");
    } catch (error: any) {
      expect(error.message).toContain("hset requires field-value pairs");
    }

    // Test with invalid key type - should throw type error
    try {
      // @ts-expect-error - Testing invalid arguments
      await client.hset(123, "field", "value");
    } catch (error: any) {
      expect(error.message).toMatch(/key.*string or buffer/i);
    }

    // Test with invalid field type - should throw type error
    try {
      // @ts-expect-error - Testing invalid arguments
      await client.hset("key", 123, "value");
    } catch (error: any) {
      expect(error.message).toMatch(/field.*string or buffer/i);
    }

    // Test with null value - should throw type error
    try {
      // @ts-expect-error - Testing invalid arguments
      await client.hset("key", "field", null);
    } catch (error: any) {
      expect(error.message).toMatch(/value.*string or buffer/i);
    }

    // Test with undefined in the middle
    try {
      // @ts-expect-error - Testing invalid arguments
      await client.hset("key", "field1", "value1", undefined, "value2");
    } catch (error: any) {
      expect(error.message).toMatch(/field.*string or buffer/i);
    }

    // Test with objects that shouldn't be accepted
    try {
      // @ts-expect-error - Testing invalid arguments
      await client.hset("key", { field: "value" }, "value");
    } catch (error: any) {
      expect(error.message).toMatch(/field.*string or buffer/i);
    }

    try {
      // @ts-expect-error - Testing invalid arguments
      await client.hset("key", "field", { nested: "object" });
    } catch (error: any) {
      expect(error.message).toMatch(/value.*string or buffer/i);
    }
  });

  test("hset method signature is correct", () => {
    const client = new RedisClient({ socket: { host: "localhost", port: 6379 } });

    // Verify the function exists and has the right length
    expect(typeof client.hset).toBe("function");
    expect(client.hset.length).toBe(3); // minimum 3 arguments
    expect(client.hset.name).toBe("hset");
  });
});