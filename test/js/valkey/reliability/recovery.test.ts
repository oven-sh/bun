import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";
import { DEFAULT_REDIS_OPTIONS, DEFAULT_REDIS_URL, isEnabled } from "../test-utils";

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
describe.skipIf(!isEnabled)("Valkey: Recovery after failure (#29925)", () => {
  test("client.connect() recovers after the client enters the failed state", async () => {
    const client = new RedisClient(DEFAULT_REDIS_URL, {
      ...DEFAULT_REDIS_OPTIONS,
      connectionTimeout: 2000,
      autoReconnect: false,
      maxRetries: 0,
    });
    try {
      // Initial round-trip to authenticate and settle the client into the
      // connected state.
      await client.set("recovery:k", "before");
      expect(await client.get("recovery:k")).toBe("before");
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
      await expect(client.get("recovery:k")).rejects.toThrow(/connection/i);

      // The key assertion: explicit connect() recovers the client.
      // Without the fix this either hung forever (because the new HELLO
      // response was dropped and `.connected` was never reached) or
      // resolved into a still-dead client that rejected the next
      // command.
      await client.connect();
      expect(client.connected).toBe(true);

      // A full round-trip after recovery confirms the client is actually
      // usable, not just carrying a stale `connected` flag.
      await client.set("recovery:k", "after");
      expect(await client.get("recovery:k")).toBe("after");
    } finally {
      client.close();
    }
  });

  // Also covers #22808: tight close()/connect()/send() cycles used to lock
  // up on the second iteration because `flags.is_authenticated` was still
  // true from the prior session, causing the new HELLO response to be
  // dropped by `handleResponse` and the connect promise to hang.
  test("repeated close()/connect()/send() cycles do not lock up", async () => {
    const client = new RedisClient(DEFAULT_REDIS_URL, DEFAULT_REDIS_OPTIONS);
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
    }
  });
});
