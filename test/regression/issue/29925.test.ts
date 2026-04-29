// https://github.com/oven-sh/bun/issues/29925
//
// Regression: after the valkey client lifecycle refactor (#23141), the old
// `.failed` connection status became a sticky `flags.failed` boolean. Once
// set, it was never cleared — not on `client.connect()`, not on a successful
// reconnect — so every subsequent command rejected with "Connection has
// failed" forever. The original intent (pre-refactor) was that `connect()`
// would call `reconnect()` on the `.failed` status and recover the client.
//
// The pre-refactor `doConnect` handled `.failed` explicitly:
//     .failed => {
//         this.client.flags.is_reconnecting = true;
//         this.client.retry_attempts = 0;
//         this.reconnect();
//     },
// but the refactor folded `.failed` into `.disconnected` without clearing
// the new `flags.failed` anywhere. Plus on reconnect, the lingering
// `is_authenticated = true` from the prior session caused the new HELLO
// response to be silently dropped, so `status` never transitioned back to
// `.connected`.

import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, randomPort } from "harness";
import { existsSync } from "node:fs";

const REDIS_SERVER = "/usr/bin/redis-server";
const REDIS_CLI = "/usr/bin/redis-cli";
const redisAvailable =
  !isWindows && existsSync(REDIS_SERVER) && existsSync(REDIS_CLI);

// Spawn a fresh redis-server on a random port for this test.
async function spawnRedis(): Promise<{ port: number; stop: () => void }> {
  const port = randomPort();
  const proc = Bun.spawn({
    cmd: [REDIS_SERVER, "--port", String(port), "--save", "", "--appendonly", "no"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Wait for redis to start accepting connections — poll with redis-cli
  // rather than sleeping an arbitrary duration.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ping = Bun.spawnSync({
      cmd: [REDIS_CLI, "-p", String(port), "ping"],
      stdout: "pipe",
      stderr: "ignore",
    });
    if (ping.exitCode === 0 && ping.stdout.toString().trim() === "PONG") {
      return {
        port,
        stop: () => {
          proc.kill();
        },
      };
    }
    await Bun.sleep(50);
  }
  proc.kill();
  throw new Error(`redis-server did not start on port ${port} within 10s`);
}

describe.skipIf(!redisAvailable)("RedisClient connection recovery (#29925)", () => {
  test("client.connect() recovers after the client enters the failed state", async () => {
    const { port, stop } = await spawnRedis();
    try {
      const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
        connectionTimeout: 2000,
        autoReconnect: false,
        maxRetries: 0,
      });

      // Initial round-trip to authenticate and settle the client into the
      // connected state.
      await client.set("k", "before");
      expect(await client.get("k")).toBe("before");
      expect(client.connected).toBe(true);

      // Force the same end state the issue reporter hits: the socket
      // closes, the client moves to disconnected, and `flags.failed` is
      // set. `close()` is the deterministic way to reach it without
      // having to wait for the reconnect-exhaustion retry loop.
      client.close();

      // While the client is failed, commands reject. Before the fix this
      // was terminal — every subsequent command got "Connection has
      // failed" and there was no way to recover short of replacing the
      // client instance.
      await expect(client.get("k")).rejects.toThrow(/connection/i);

      // The key assertion: explicit connect() recovers the client.
      // Without the fix this either hung forever (because the new HELLO
      // response was dropped and `.connected` was never reached) or
      // resolved into a still-dead client that rejected the next
      // command.
      await client.connect();
      expect(client.connected).toBe(true);

      // A full round-trip after recovery confirms the client is actually
      // usable, not just carrying a stale `connected` flag.
      await client.set("k", "after");
      expect(await client.get("k")).toBe("after");

      client.close();
    } finally {
      stop();
    }
  });
});
