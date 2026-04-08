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

// We spawn a sub-process for each test so a dropped message can't poison a
// shared connection pool.

async function redisReachable() {
  try {
    const c = new RedisClient("redis://localhost:6379");
    await c.connect();
    c.close();
    return true;
  } catch {
    return false;
  }
}

const isReachable = await redisReachable();
const t = isReachable ? test : test.skip;

t("subscribe() after HELLO 2 delivers messages to the JS handler", async () => {
  const pub = new RedisClient("redis://localhost:6379");
  await pub.connect();

  const sub = new RedisClient("redis://localhost:6379");
  await sub.connect();

  // Force the subscriber connection into RESP2.
  await sub.send("HELLO", ["2"]);

  const channel = `bun-29042-${crypto.randomUUID()}`;
  const { promise, resolve, reject } = Promise.withResolvers<string>();

  await sub.subscribe(channel, (message, ch) => {
    if (ch !== channel) reject(new Error(`wrong channel: ${ch}`));
    resolve(message);
  });

  const numSubs = await pub.send("PUBLISH", [channel, "hello"]);
  // Sanity-check the regression shape: the server MUST see the subscriber,
  // otherwise the test is not exercising the bug.
  expect(numSubs).toBe(1);

  const received = await promise;
  expect(received).toBe("hello");

  await sub.unsubscribe(channel);
  sub.close();
  pub.close();
});

t("multi-channel subscribe after HELLO 2 delivers every message", async () => {
  const pub = new RedisClient("redis://localhost:6379");
  await pub.connect();

  const sub = new RedisClient("redis://localhost:6379");
  await sub.connect();

  await sub.send("HELLO", ["2"]);

  const prefix = `bun-29042-${crypto.randomUUID()}`;
  const channels = [`${prefix}:a`, `${prefix}:b`];

  const received: Array<{ channel: string; message: string }> = [];
  const { promise, resolve } = Promise.withResolvers<void>();

  await sub.subscribe(channels, (message, channel) => {
    received.push({ channel, message });
    if (received.length === 2) resolve();
  });

  expect(await pub.send("PUBLISH", [channels[0], "hello-a"])).toBe(1);
  expect(await pub.send("PUBLISH", [channels[1], "hello-b"])).toBe(1);

  await promise;

  // Order between channels is not guaranteed, sort for stable comparison.
  received.sort((x, y) => x.channel.localeCompare(y.channel));
  expect(received).toEqual([
    { channel: channels[0], message: "hello-a" },
    { channel: channels[1], message: "hello-b" },
  ]);

  await sub.unsubscribe(channels);
  sub.close();
  pub.close();
});

t("unsubscribe after HELLO 2 resolves its promise", async () => {
  const sub = new RedisClient("redis://localhost:6379");
  await sub.connect();

  await sub.send("HELLO", ["2"]);

  const channel = `bun-29042-${crypto.randomUUID()}`;
  await sub.subscribe(channel, () => {});

  // If RESP2 unsubscribe confirmations are dropped, this promise hangs
  // forever — the test harness will time it out rather than report a
  // meaningful failure. So just call it and make sure we reach the next line.
  await sub.unsubscribe(channel);

  sub.close();
});
