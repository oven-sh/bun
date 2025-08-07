import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, isEnabled } from "../test-utils";

describe.skipIf(!isEnabled)("Valkey: PING Command", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });

  describe("Basic PING Operations", () => {
    test("should send PING without message and return PONG", async () => {
      const redis = ctx.redis;

      // Test ping without arguments
      const result = await redis.ping();
      expect(result).toBe("PONG");
    });

    test("should send PING with message and return the message", async () => {
      const redis = ctx.redis;

      // Test ping with message
      const message = "Hello World";
      const result = await redis.ping(message);
      expect(result).toBe(message);
    });

    test("should send PING with message as array buffer and return the message", async () => {
      const redis = ctx.redis;

      const message = new Uint8Array([98, 117, 110]);
      const result = await redis.ping(message);

      // redis ping always returns a string
      expect(result).toBeTypeOf("string");
      expect(result).toBe("bun");
    });
  });
});
