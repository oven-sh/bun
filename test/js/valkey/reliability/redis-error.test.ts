import { RedisClient } from "bun";
import { expect, test } from "bun:test";
import { createServer } from "node:net";

async function getUnusedPort() {
  await using server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate TCP port");
  }

  return address.port;
}

test("should expose Bun.RedisError as a runtime constructor", () => {
  expect(typeof Bun.RedisError).toBe("function");
  expect(Bun.RedisError.name).toBe("RedisError");
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

test("should propagate exceptions from options while constructing Bun.RedisError", () => {
  const thrown = new Error("boom");

  expect(() => {
    new Bun.RedisError("Connection closed", {
      code: "ERR_REDIS_CONNECTION_CLOSED",
      get cause() {
        throw thrown;
      },
    });
  }).toThrow(thrown);
});

test("should throw Bun.RedisError for connection failures", async () => {
  const port = await getUnusedPort();
  const client = new RedisClient(`redis://127.0.0.1:${port}`, {
    connectionTimeout: 100,
    autoReconnect: false,
  });

  try {
    await client.set("key", "value");
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(Bun.RedisError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("ERR_REDIS_CONNECTION_CLOSED");
  } finally {
    client.close();
  }
});
