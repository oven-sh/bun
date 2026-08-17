import { expectType } from "./utilities";

expectType(Bun.redis.publish("hello", "world")).is<Promise<number>>();

const copy = await Bun.redis.duplicate();
expectType(copy.connected).is<boolean>();
expectType(copy).is<Bun.RedisClient>();

const listener: Bun.RedisClient.StringPubSubListener = (message, channel) => {
  expectType(message).is<string>();
  expectType(channel).is<string>();
};
Bun.redis.subscribe("hello", listener);

// Buffer subscriptions are not yet implemented
// const bufferListener: Bun.RedisClient.BufferPubSubListener = (message, channel) => {
//   expectType(message).is<Uint8Array<ArrayBuffer>>();
//   expectType(channel).is<string>();
// };
// Bun.redis.subscribe("hello", bufferListener);

expectType(
  copy.subscribe("hello", message => {
    expectType(message).is<string>();
  }),
).is<Promise<number>>();

await copy.unsubscribe();
await copy.unsubscribe("hello");

expectType(copy.unsubscribe("hello", () => {})).is<Promise<void>>();

// The PUBSUB subcommands the runtime is known to forward get typed replies;
// anything else (including lowercase spellings) goes through the untyped overload.
expectType(Bun.redis.pubsub("CHANNELS")).is<Promise<string[]>>();
expectType(Bun.redis.pubsub("CHANNELS", "news.*")).is<Promise<string[]>>();
expectType(Bun.redis.pubsub("NUMSUB")).is<Promise<(string | number)[]>>();
expectType(Bun.redis.pubsub("NUMSUB", "news", "sports")).is<Promise<(string | number)[]>>();
expectType(Bun.redis.pubsub("NUMPAT")).is<Promise<number>>();
expectType(Bun.redis.pubsub("SHARDCHANNELS")).is<Promise<string[]>>();
expectType(Bun.redis.pubsub("SHARDCHANNELS", "orders-*")).is<Promise<string[]>>();
expectType(Bun.redis.pubsub("SHARDNUMSUB")).is<Promise<(string | number)[]>>();
expectType(Bun.redis.pubsub("SHARDNUMSUB", "orders", "payments")).is<Promise<(string | number)[]>>();
expectType(Bun.redis.pubsub("HELP")).is<Promise<any>>();
expectType(Bun.redis.pubsub("channels", "news.*")).is<Promise<any>>();
expectType(copy.pubsub("NUMPAT")).is<Promise<number>>();

// @ts-expect-error a subcommand is required
Bun.redis.pubsub();
// @ts-expect-error the runtime rejects undefined arguments instead of skipping them
Bun.redis.pubsub("CHANNELS", undefined);

expectType(Bun.redis.select(1)).is<Promise<"OK">>();
expectType(Bun.redis.select("1")).is<Promise<"OK">>();
expectType(copy.select(2)).is<Promise<"OK">>();

// @ts-expect-error the database index is required
Bun.redis.select();
// @ts-expect-error the runtime rejects undefined arguments instead of skipping them
Bun.redis.select(undefined);
// @ts-expect-error SELECT takes exactly one argument
Bun.redis.select(1, "extra");
