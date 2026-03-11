import { RedisClient } from "bun";
import { expect, test } from "bun:test";

test("should expose Bun.RedisError as a runtime constructor", () => {
  expect(Bun.RedisError).toBe(Bun.RedisError);
  expect(Bun.RedisError.prototype.constructor).toBe(Bun.RedisError);

  const cause = new Error("root cause");
  const error = new Bun.RedisError("Connection closed", {
    code: "ERR_REDIS_CONNECTION_CLOSED",
    cause,
  });

  expect(error).toBeInstanceOf(Bun.RedisError);
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("RedisError");
  expect(error.code).toBe("ERR_REDIS_CONNECTION_CLOSED");
  expect(error.cause).toBe(cause);
});

test("should throw Bun.RedisError for connection failures", async () => {
  const client = new RedisClient("redis://localhost:12345", {
    connectionTimeout: 100,
    autoReconnect: false,
  });

  try {
    await client.set("key", "value");
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(Bun.RedisError);
    expect(error).toBeInstanceOf(Error);
  } finally {
    client.close();
  }
});
