// https://github.com/oven-sh/bun/issues/29042
//
// Bun.RedisClient: `subscribe()` handler silently dropped messages after
// `HELLO 2` on the subscriber connection.
//
// Under RESP3 (Bun's default) a pub/sub notification arrives as a `.Push`
// frame (type byte `>`). Under RESP2 (after the user sends `HELLO 2` on the
// subscriber connection) Redis sends the *same* notification as an ordinary
// `*3\r\n$7\r\nmessage\r\n...` array. Bun's client used to match only `.Push`
// frames in the subscriber dispatch path, so after `HELLO 2` every incoming
// message was silently swallowed even though PUBLISH on the server side still
// reported the subscriber was present.
//
// The fix parses both shapes uniformly in `SubscriptionPushMessage.asFrame`
// and routes them through the same subscriber handler.
import { RedisClient } from "bun";
import { expect, test } from "bun:test";

async function redisReachable() {
  let c: RedisClient | undefined;
  try {
    c = new RedisClient("redis://localhost:6379");
    await c.connect();
    return true;
  } catch {
    return false;
  } finally {
    c?.close();
  }
}

const isReachable = await redisReachable();
const t = isReachable ? test : test.skip;

// If the regression returns, the RESP2 subscribe path hangs forever rather
// than throwing. Race every network-dependent await against an explicit
// bounded timeout so failures are reported with a useful message instead of
// an opaque 5s global-test-timeout.
const REGRESSION_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, label: string, ms = REGRESSION_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`#29042 regression? Timed out after ${ms}ms waiting for: ${label}`));
    }, ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// RedisClient doesn't implement Symbol.dispose yet, so scope cleanup with
// explicit try/finally — a timeout/assert failure in the body must still
// close both sockets so the next test isn't poisoned by a stale subscriber.
t("subscribe() after HELLO 2 delivers messages to the JS handler", async () => {
  const pub = new RedisClient("redis://localhost:6379");
  const sub = new RedisClient("redis://localhost:6379");
  try {
    await pub.connect();
    await sub.connect();

    // Force the subscriber connection into RESP2.
    await sub.send("HELLO", ["2"]);

    const channel = `bun-29042-${crypto.randomUUID()}`;
    const { promise, resolve, reject } = Promise.withResolvers<string>();

    await withTimeout(
      sub.subscribe(channel, (message, ch) => {
        if (ch !== channel) reject(new Error(`wrong channel: ${ch}`));
        resolve(message);
      }),
      "SUBSCRIBE confirmation (RESP2)",
    );

    const numSubs = await withTimeout(pub.send("PUBLISH", [channel, "hello"]), "PUBLISH");
    // Sanity-check the regression shape: the server MUST see the subscriber,
    // otherwise the test is not exercising the bug.
    expect(numSubs).toBe(1);

    const received = await withTimeout(promise, "subscribe() handler invocation (RESP2)");
    expect(received).toBe("hello");

    await withTimeout(sub.unsubscribe(channel), "UNSUBSCRIBE confirmation (RESP2)");
  } finally {
    sub.close();
    pub.close();
  }
});

t("multi-channel subscribe after HELLO 2 delivers every message", async () => {
  const pub = new RedisClient("redis://localhost:6379");
  const sub = new RedisClient("redis://localhost:6379");
  try {
    await pub.connect();
    await sub.connect();

    await sub.send("HELLO", ["2"]);

    const prefix = `bun-29042-${crypto.randomUUID()}`;
    const channels = [`${prefix}:a`, `${prefix}:b`];

    const received: Array<{ channel: string; message: string }> = [];
    const { promise, resolve } = Promise.withResolvers<void>();

    await withTimeout(
      sub.subscribe(channels, (message, channel) => {
        received.push({ channel, message });
        if (received.length === 2) resolve();
      }),
      "multi-channel SUBSCRIBE confirmation (RESP2)",
    );

    expect(await withTimeout(pub.send("PUBLISH", [channels[0], "hello-a"]), "PUBLISH channel 0")).toBe(1);
    expect(await withTimeout(pub.send("PUBLISH", [channels[1], "hello-b"]), "PUBLISH channel 1")).toBe(1);

    await withTimeout(promise, "both multi-channel messages delivered (RESP2)");

    // Order between channels is not guaranteed, sort for stable comparison.
    received.sort((x, y) => x.channel.localeCompare(y.channel));
    expect(received).toEqual([
      { channel: channels[0], message: "hello-a" },
      { channel: channels[1], message: "hello-b" },
    ]);

    await withTimeout(sub.unsubscribe(channels), "multi-channel UNSUBSCRIBE (RESP2)");
  } finally {
    sub.close();
    pub.close();
  }
});

t("unsubscribe after HELLO 2 resolves its promise", async () => {
  const sub = new RedisClient("redis://localhost:6379");
  try {
    await sub.connect();

    await sub.send("HELLO", ["2"]);

    const channel = `bun-29042-${crypto.randomUUID()}`;
    await withTimeout(
      sub.subscribe(channel, () => {}),
      "SUBSCRIBE confirmation (RESP2)",
    );

    // Without the fix the UNSUBSCRIBE confirmation frame (a RESP2 array) was
    // never matched in the subscriber dispatch, so this promise would hang.
    // withTimeout turns that hang into a clear regression message.
    await withTimeout(sub.unsubscribe(channel), "UNSUBSCRIBE confirmation (RESP2)");
  } finally {
    sub.close();
  }
});
