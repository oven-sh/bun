import { expectType } from "./utilities";

expectType(Bun.redis.publish("hello", "world")).is<Promise<number>>();

const constructedRedisError = new Bun.RedisError("test", { code: "ERR_REDIS_CONNECTION_CLOSED" });
expectType(constructedRedisError.name).is<"RedisError">();
expectType(constructedRedisError.code).is<Bun.RedisErrorCode>();

const causedRedisError = new Bun.RedisError("test", {
  code: "ERR_REDIS_CONNECTION_CLOSED",
  cause: new Error("cause"),
});
expectType(causedRedisError.cause).is<unknown>();

const copy = await Bun.redis.duplicate();
expectType(copy.connected).is<boolean>();
expectType(copy).is<Bun.RedisClient>();

const listener: Bun.RedisClient.StringPubSubListener = (message, channel) => {
  expectType(message).is<string>();
  expectType(channel).is<string>();
};
Bun.redis.subscribe("hello", listener);

const onclose: NonNullable<Bun.RedisClient["onclose"]> = function (error) {
  expectType(this).is<Bun.RedisClient>();
  expectType(error).is<Error>();
};
Bun.redis.onclose = onclose;

declare const maybeRedisError: unknown;
if (maybeRedisError instanceof Bun.RedisError) {
  expectType(maybeRedisError).is<Bun.RedisError>();
  expectType(maybeRedisError.code).is<Bun.RedisErrorCode>();
}

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
