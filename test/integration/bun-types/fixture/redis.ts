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

expectType(Bun.redis.expire("key", 10)).is<Promise<number>>();
expectType(Bun.redis.expire("key", 10, "NX")).is<Promise<number>>();
expectType(Bun.redis.pexpire("key", 10_000, "XX")).is<Promise<number>>();
expectType(Bun.redis.expireat("key", 1_700_000_000, "GT")).is<Promise<number>>();
expectType(Bun.redis.pexpireat("key", 1_700_000_000_000, "LT")).is<Promise<number>>();
// @ts-expect-error - the condition must be one of NX, XX, GT, LT
Bun.redis.expire("key", 10, "EX");
// @ts-expect-error - EXPIRE takes a single condition
Bun.redis.expire("key", 10, "NX", "GT");

expectType(Bun.redis.pfadd("hll")).is<Promise<number>>();
expectType(Bun.redis.pfadd("hll", "a")).is<Promise<number>>();
expectType(Bun.redis.pfadd("hll", "a", Buffer.from("b"), new Blob(["c"]))).is<Promise<number>>();
