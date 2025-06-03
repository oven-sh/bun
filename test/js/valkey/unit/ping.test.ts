import { describe, expect, test, beforeEach } from "bun:test";
import { createClient, ctx, isEnabled, ConnectionType } from "../test-utils";

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
  });
});
