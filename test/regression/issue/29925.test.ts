// https://github.com/oven-sh/bun/issues/29925
//
// Regression: after the valkey client lifecycle refactor (#23141), the old
// `.failed` connection status became a sticky `flags.failed` boolean. Once
// set, it was never cleared — not on `client.connect()`, not on a successful
// reconnect — so every subsequent command rejected with "Connection has
// failed" forever. The pre-refactor `doConnect` handled `.failed` explicitly
// via `reconnect()`. The refactor folded `.failed` into `.disconnected`
// without clearing the new `flags.failed` anywhere, and on reconnect the
// lingering `is_authenticated = true` from the prior session caused the new
// HELLO response to be silently dropped, so `status` never transitioned
// back to `.connected`.
//
// This file mirrors the docker-based coverage in
// `test/js/valkey/reliability/recovery.test.ts` but spawns a local
// `redis-server` so the gate runs it without docker.

import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, randomPort } from "harness";

const REDIS_SERVER = Bun.which("redis-server");
const REDIS_CLI = Bun.which("redis-cli");
const redisAvailable = !isWindows && !!REDIS_SERVER && !!REDIS_CLI;

async function spawnRedis(): Promise<{ port: number; stop: () => void }> {
  const port = randomPort();
  const proc = Bun.spawn({
    cmd: [REDIS_SERVER!, "--port", String(port), "--save", "", "--appendonly", "no"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ping = Bun.spawnSync({
      cmd: [REDIS_CLI!, "-p", String(port), "ping"],
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
    const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
      connectionTimeout: 2000,
      autoReconnect: false,
      maxRetries: 0,
    });
    try {
      // Initial round-trip to authenticate and settle into .connected.
      await client.set("recovery:k", "before");
      expect(await client.get("recovery:k")).toBe("before");
      expect(client.connected).toBe(true);

      // Force the same end state the issue reporter hits: the socket
      // closes, the client moves to disconnected, and `flags.failed` is
      // set. `close()` is the deterministic way to reach it without
      // waiting for the reconnect-exhaustion retry loop.
      client.close();

      // While the client is failed, commands reject. Before the fix this
      // was terminal — every subsequent command got "Connection has
      // failed" and the only way out was to drop the instance.
      await expect(client.get("recovery:k")).rejects.toThrow(/connection/i);

      // The key assertion: explicit connect() recovers the client.
      // Without the fix this either hung forever (the new HELLO response
      // was dropped because `is_authenticated` was still true) or
      // resolved into a still-dead client that rejected the next
      // command.
      await client.connect();
      expect(client.connected).toBe(true);

      // Full round-trip after recovery proves the client is actually
      // usable, not just carrying a stale `connected` flag.
      await client.set("recovery:k", "after");
      expect(await client.get("recovery:k")).toBe("after");
    } finally {
      client.close();
      stop();
    }
  });

  // Also covers #22808: tight close()/connect()/send() cycles used to lock
  // up on the second iteration because `flags.is_authenticated` was still
  // true from the prior session, causing the fresh HELLO response to be
  // dropped and the connect promise to hang.
  test("repeated close()/connect()/send() cycles do not lock up", async () => {
    const { port, stop } = await spawnRedis();
    const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`);
    try {
      for (let i = 0; i < 3; i++) {
        if (client.connected) {
          client.close();
        }
        await client.connect();
        expect(client.connected).toBe(true);
        expect(await client.send("FLUSHALL", ["SYNC"])).toBe("OK");
      }
    } finally {
      client.close();
      stop();
    }
  });
});
