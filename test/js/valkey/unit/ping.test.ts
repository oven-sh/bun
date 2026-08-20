import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, isEnabled } from "../test-utils";

describe.skipIf(!isEnabled)("Valkey: PING Command", () => {
  // PING is stateless and writes no keys, so one connection serves the whole
  // file. test-utils' beforeAll normally provides a connected `ctx.redis`; the
  // guard only fires when an earlier file in the same process has closed it.
  beforeEach(() => {
    if (!ctx.redis?.connected) {
      ctx.redis = createClient(ConnectionType.TCP);
    }
  });

  describe("Basic PING Operations", () => {
    test("should send PING without message and return PONG", async () => {
      const redis = ctx.redis;

      expect(await redis.ping()).toBe("PONG");
      // undefined is the documented "no argument" path, not a literal message
      expect(await redis.ping(undefined)).toBe("PONG");
    });

    test("should send PING with message and return the message", async () => {
      const redis = ctx.redis;

      expect(await redis.ping("Hello World")).toBe("Hello World");
      expect(await redis.ping("")).toBe("");
    });

    test("should send PING with message as array buffer and return the message", async () => {
      const redis = ctx.redis;

      const message = new Uint8Array([98, 117, 110]);
      const result = await redis.ping(message);

      // redis ping always returns a string, even for binary input
      expect(result).toBe("bun");
    });
  });
});
