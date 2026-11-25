import { spyOn } from "bun:test";
import { expectType } from "./utilities";

expectType(Bun.redis.publish("hello", "world")).is<Promise<number>>();

// The constructor takes the URL as a string or as a `URL` object.
expectType(new Bun.RedisClient("redis://localhost:6379")).is<Bun.RedisClient>();
expectType(new Bun.RedisClient(new URL("redis://localhost:6379"))).is<Bun.RedisClient>();
expectType(new Bun.RedisClient(new URL("rediss://localhost:6380/2"), { maxRetries: 5 })).is<Bun.RedisClient>();
expectType(new Bun.RedisClient(undefined, { autoReconnect: false })).is<Bun.RedisClient>();
// @ts-expect-error - a number is not a URL
new Bun.RedisClient(6379);

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

const redis = Bun.redis;
const buf = Buffer.from("key");

// Bitmap
expectType(redis.spublish("channel", 1)).is<Promise<number>>();
expectType(redis.bitop("NOT", "dest", "k1")).is<Promise<number>>();
expectType(redis.bitop("not", "dest", buf)).is<Promise<number>>();
expectType(redis.bitop("AND", "dest", "k1")).is<Promise<number>>();
expectType(redis.bitop("XOR", "dest", "k1", "k2", buf)).is<Promise<number>>();
expectType(redis.bitop("DIFF", "dest", "k1", "k2")).is<Promise<number>>();
expectType(redis.bitop("one", "dest", "k1", "k2")).is<Promise<number>>();
// @ts-expect-error - NOT takes exactly one source key
redis.bitop("NOT", "dest", "k1", "k2");
// @ts-expect-error - NAND is not a BITOP operation
redis.bitop("NAND", "dest", "k1", "k2");
expectType(redis.bitpos("k", 1)).is<Promise<number>>();
expectType(redis.bitpos("k", 0, 0, -1, "BIT")).is<Promise<number>>();
// @ts-expect-error - bit must be 0 or 1
redis.bitpos("k", 2);
expectType(redis.bitfield("k", "SET", "u8", 0, 255, "GET", "u8", 0)).is<Promise<(number | null)[]>>();

// HyperLogLog
expectType(redis.pfcount("hll")).is<Promise<number>>();
expectType(redis.pfcount("hll", "hll2", buf)).is<Promise<number>>();
// @ts-expect-error - at least one key is required
redis.pfcount();
expectType(redis.pfmerge("dest", "hll", "hll2")).is<Promise<"OK">>();

// Geo
expectType(redis.geoadd("geo", 13.361389, 38.115556, "Palermo")).is<Promise<number>>();
expectType(redis.geoadd("geo", "NX", 13.361389, 38.115556, "Palermo")).is<Promise<number>>();
expectType(redis.geodist("geo", "Palermo", "Catania")).is<Promise<string | null>>();
expectType(redis.geodist("geo", "Palermo", "Catania", "km")).is<Promise<string | null>>();
// @ts-expect-error - not a GEODIST unit
redis.geodist("geo", "Palermo", "Catania", "yd");
// @ts-expect-error - an explicit undefined unit throws at runtime, so it is not accepted here either
redis.geodist("geo", "Palermo", "Catania", undefined);
expectType(redis.geohash("geo", "Palermo", "Catania")).is<Promise<(string | null)[]>>();
expectType(redis.geopos("geo", "Palermo")).is<Promise<([number, number] | null)[]>>();
expectType(redis.geosearch("geo", "FROMLONLAT", 15, 37, "BYRADIUS", 200, "km", "ASC")).is<Promise<unknown[]>>();
expectType(redis.geosearchstore("dest", "geo", "FROMMEMBER", "Palermo", "BYBOX", 400, 400, "km")).is<Promise<number>>();

// Scripting
expectType(redis.eval("return ARGV[1]", 0, "hello")).is<Promise<any>>();
expectType(redis.eval("return redis.call('GET', KEYS[1])", 1, "k")).is<Promise<any>>();
// @ts-expect-error - numkeys is required
redis.eval("return 1");
expectType(redis.evalsha("0123456789abcdef0123456789abcdef01234567", 1, "k", 42)).is<Promise<any>>();
expectType(redis.script("LOAD", "return 1")).is<Promise<any>>();
expectType(redis.fcall("myfunc", 1, "k", "arg")).is<Promise<any>>();
expectType(redis.function("LOAD", "REPLACE", "#!lua name=mylib")).is<Promise<any>>();

// Server
expectType(redis.dbsize()).is<Promise<number>>();
expectType(redis.flushdb()).is<Promise<"OK">>();
expectType(redis.flushdb("ASYNC")).is<Promise<"OK">>();
expectType(redis.flushall("sync")).is<Promise<"OK">>();
// @ts-expect-error - FLUSHDB only takes ASYNC or SYNC
redis.flushdb("NOW");
// @ts-expect-error - FLUSHALL only takes ASYNC or SYNC
redis.flushall("ASYNC", "SYNC");
// @ts-expect-error - an explicit undefined mode throws at runtime, so it is not accepted here either
redis.flushdb(undefined);
// @ts-expect-error - an explicit undefined mode throws at runtime, so it is not accepted here either
redis.flushall(undefined);
expectType(redis.info()).is<Promise<string>>();
expectType(redis.info("server", "clients")).is<Promise<string>>();
expectType(redis.time()).is<Promise<[string, string]>>();
expectType(redis.echo("hello")).is<Promise<string>>();
expectType(redis.lastsave()).is<Promise<number>>();
expectType(redis.client("SETNAME", "conn")).is<Promise<any>>();
expectType(redis.client("KILL", "ID", 42)).is<Promise<any>>();
expectType(redis.config("GET", "maxmemory")).is<Promise<any>>();
expectType(redis.debug("OBJECT", "k")).is<Promise<any>>();
expectType(redis.command("COUNT")).is<Promise<any>>();

// Raw commands: `send` takes each kind of argument that the client sends, in an array that it only reads.
expectType(redis.send("PING", [])).is<Promise<any>>();
redis.send("SET", ["k", "v"]);
redis.send("SET", ["k", 0, "EX", 60]);
redis.send("SET", [buf, new Uint8Array(1)]);
redis.send("VSIM", ["docs", "FP32", new Float32Array(3), "COUNT", 5]);
redis.send("SET", ["k", new DataView(new ArrayBuffer(1))]);
redis.send("SET", ["k", new ArrayBuffer(1)]);
redis.send("SET", ["k", new SharedArrayBuffer(1)]);
redis.send("SET", ["k", new Blob(["v"])]);
// A value that the other methods take as `RedisClient.KeyLike` is also an element of `args`.
declare const keyLike: Bun.RedisClient.KeyLike;
redis.send("DEL", [keyLike]);
const readonlyArgs: readonly string[] = ["k", "v"];
redis.send("SET", readonlyArgs);
const tupleArgs = ["k", 0, "EX", 60] as const;
redis.send("SET", tupleArgs);
redis.send("SET", Object.freeze(["k", "v"]));
// `send` has one signature, so code typed from its parameter sees each kind that the client sends.
expectType<Parameters<Bun.RedisClient["send"]>[1]>().is<
  readonly (string | number | NodeJS.TypedArray | DataView<ArrayBufferLike> | ArrayBufferLike | Blob)[]
>();
// A fake, an override and a bun:test mock of `send` can keep `string[]` for the arguments that they read.
const fakeSend: Pick<Bun.RedisClient, "send"> = { send: async (command, args: string[]) => args.join(" ") };
class StringSender extends Bun.RedisClient {
  override send(command: string, args: string[]): Promise<any> {
    return super.send(command, args);
  }
}
spyOn(redis, "send").mockImplementation(async (command, args: string[]) => args.join(" "));
// @ts-expect-error - a bigint throws ERR_INVALID_ARG_TYPE
redis.send("SET", ["k", 10n]);
// @ts-expect-error - a boolean throws ERR_INVALID_ARG_TYPE
redis.send("SET", ["k", true]);
// @ts-expect-error - null throws ERR_INVALID_ARG_TYPE
redis.send("SET", ["k", null]);
// @ts-expect-error - undefined throws ERR_INVALID_ARG_TYPE
redis.send("SET", ["k", undefined]);
// @ts-expect-error - a nested array throws ERR_INVALID_ARG_TYPE
redis.send("SET", ["k", ["v"]]);
// @ts-expect-error - a plain object throws ERR_INVALID_ARG_TYPE
redis.send("SET", ["k", {}]);
// @ts-expect-error - an object with the members of the lib `ArrayBufferView` throws ERR_INVALID_ARG_TYPE
redis.send("SET", ["k", { buffer: new ArrayBuffer(1), byteLength: 1, byteOffset: 0 }]);
// @ts-expect-error - a Set throws "Arguments must be an array"
redis.send("SET", new Set(["k", "v"]));
// @ts-expect-error - a string throws "Arguments must be an array"
redis.send("SET", "k");
// @ts-expect-error - a call with no `args` throws "Arguments must be an array"
redis.send("PING");

expectType(redis.publish("ch", 1)).is<Promise<number>>();
expectType(redis.publish("ch", buf)).is<Promise<number>>();
expectType(redis.publish("ch", new ArrayBuffer(1))).is<Promise<number>>();
// @ts-expect-error - the channel is a string
redis.publish(buf, "m");
expectType(redis.hincrby("k", buf, 1)).is<Promise<number>>();
expectType(redis.hincrbyfloat("k", buf, 1.5)).is<Promise<string>>();
expectType(redis.increx("k")).is<Promise<[number, number]>>();
expectType(redis.increx("k", "BYINT", 5, "EX", 60)).is<Promise<[number, number]>>();
expectType(redis.zrange("z", 0, -1, "REV")).is<Promise<string[]>>();
expectType(redis.zrange("z", 0, -1, "REV", "WITHSCORES")).is<Promise<[string, number][]>>();
expectType(redis.zrangebyscore("z", 0, 9, "LIMIT", 0, 5, "WITHSCORES")).is<Promise<[string, number][]>>();
expectType(redis.zrevrangebyscore("z", 9, 0, "LIMIT", 0, 5, "WITHSCORES")).is<Promise<[string, number][]>>();

// Generic
expectType(redis.object("ENCODING", "k")).is<Promise<any>>();
expectType(redis.sort("list")).is<Promise<(string | null)[] | number>>();
expectType(redis.sort("list", "BY", "weight_*", "LIMIT", 0, 10, "GET", "obj_*", "DESC", "ALPHA")).is<
  Promise<(string | null)[] | number>
>();
expectType(redis.wait(1, 1000)).is<Promise<number>>();
// @ts-expect-error - both arguments are numbers
redis.wait("1", 1000);
// @ts-expect-error - timeout is required
redis.wait(1);
expectType(redis.lcs("a", "b")).is<Promise<any>>();
expectType(redis.lcs("a", "b", "LEN")).is<Promise<any>>();

// Streams
expectType(redis.xadd("stream", "*", "field", "value")).is<Promise<string | null>>();
expectType(redis.xadd("stream", "MAXLEN", "~", 1000, "*", "field", "value")).is<Promise<string | null>>();
expectType(redis.xlen("stream")).is<Promise<number>>();
expectType(redis.xrange("stream", "-", "+")).is<Promise<[string, string[]][]>>();
expectType(redis.xrange("stream", "-", "+", "COUNT", 10)).is<Promise<[string, string[]][]>>();
expectType(redis.xrevrange("stream", "+", "-", "COUNT", 1)).is<Promise<[string, string[]][]>>();
expectType(redis.xread("STREAMS", "stream", "0")).is<Promise<any>>();
expectType(redis.xread("COUNT", 10, "BLOCK", 0, "STREAMS", "a", "b", "0", "0")).is<Promise<any>>();
expectType(redis.xreadgroup("GROUP", "g", "c", "COUNT", 1, "STREAMS", "stream", ">")).is<Promise<any>>();
expectType(redis.xdel("stream", "1-0")).is<Promise<number>>();
expectType(redis.xdel("stream", "1-0", "2-0")).is<Promise<number>>();
// @ts-expect-error - at least one id is required
redis.xdel("stream");
expectType(redis.xtrim("stream", "MAXLEN", 1000)).is<Promise<number>>();
expectType(redis.xtrim("stream", "minid", "1-0", "LIMIT", 100)).is<Promise<number>>();
expectType(redis.xtrim("stream", "MAXLEN", "~", 1000)).is<Promise<number>>();
// @ts-expect-error - not an XTRIM strategy
redis.xtrim("stream", "OLDEST", 5);
expectType(redis.xack("stream", "g", "1-0", "2-0")).is<Promise<number>>();
// @ts-expect-error - at least one id is required
redis.xack("stream", "g");
expectType(redis.xclaim("stream", "g", "c", 60_000, "1-0")).is<Promise<any>>();
expectType(redis.xclaim("stream", "g", "c", 60_000, "1-0", "2-0", "JUSTID")).is<Promise<any>>();
// @ts-expect-error - min-idle-time is a number
redis.xclaim("stream", "g", "c", "60000", "1-0");
expectType(redis.xautoclaim("stream", "g", "c", 60_000, "0-0", "COUNT", 10)).is<Promise<any>>();
expectType(redis.xpending("stream", "g")).is<Promise<any>>();
expectType(redis.xpending("stream", "g", "-", "+", 10, "c")).is<Promise<any>>();
expectType(redis.xinfo("STREAM", "stream")).is<Promise<any>>();
expectType(redis.xgroup("CREATE", "stream", "g", "$", "MKSTREAM")).is<Promise<any>>();
expectType(redis.xsetid("stream", "0-0")).is<Promise<"OK">>();
expectType(redis.xsetid("stream", "5-0", "ENTRIESADDED", 5)).is<Promise<"OK">>();

// A number as a value, a list element, a member or an option value. The first line is the first sample of
// docs/runtime/redis.mdx.
expectType(redis.set("counter", 0)).is<Promise<"OK">>();
expectType(redis.set("k", 1, "EX", 60)).is<Promise<"OK">>();
expectType(redis.set("k", 1, "PX", 60_000)).is<Promise<"OK">>();
expectType(redis.set("k", 1, "EXAT", 1_900_000_000)).is<Promise<"OK">>();
expectType(redis.set("k", 1, "PXAT", 1_900_000_000_000)).is<Promise<"OK">>();
expectType(redis.set("k", 1, "NX")).is<Promise<"OK" | null>>();
expectType(redis.set("k", 1, "XX")).is<Promise<"OK" | null>>();
expectType(redis.set("k", 1, "GET")).is<Promise<string | null>>();
expectType(redis.set("k", 1, "KEEPTTL")).is<Promise<"OK">>();
expectType(redis.set("k", 1, "EX", 60, "NX")).is<Promise<"OK" | string | null>>();
expectType(redis.set("lock", "token", "NX", "PX", 30_000)).is<Promise<"OK" | string | null>>();
expectType(redis.set("k", 1, ...(["NX", "GET"] as string[]))).is<Promise<"OK" | string | null>>();
expectType(redis.append("k", 1)).is<Promise<number>>();
expectType(redis.getset("k", 1)).is<Promise<string | null>>();
expectType(redis.setnx("k", 1)).is<Promise<number>>();
expectType(redis.setex("k", 60, 1)).is<Promise<"OK">>();
expectType(redis.psetex("k", 60_000, 1)).is<Promise<"OK">>();
expectType(redis.setrange("k", 0, 1)).is<Promise<number>>();
expectType(redis.mset("a", 1, "b", 2)).is<Promise<"OK">>();
expectType(redis.msetnx("a", 1, "b", 2)).is<Promise<number>>();
expectType(redis.lpush("list", 1)).is<Promise<number>>();
expectType(redis.lpush("list", "a", 2)).is<Promise<number>>();
expectType(redis.rpush("list", 1)).is<Promise<number>>();
expectType(redis.rpush("list", "a", 2)).is<Promise<number>>();
expectType(redis.lpushx("list", 1)).is<Promise<number>>();
expectType(redis.rpushx("list", 1)).is<Promise<number>>();
expectType(redis.lset("list", 0, 1)).is<Promise<string>>();
expectType(redis.lrem("list", 0, 1)).is<Promise<number>>();
expectType(redis.linsert("list", "BEFORE", 1, "a")).is<Promise<number>>();
expectType(redis.linsert("list", "AFTER", "a", 1)).is<Promise<number>>();
expectType(redis.lpos("list", 1)).is<Promise<number | number[] | null>>();
expectType(redis.sadd("set", 1, 2)).is<Promise<number>>();
expectType(redis.srem("set", 1)).is<Promise<number>>();
expectType(redis.sismember("set", 1)).is<Promise<boolean>>();
expectType(redis.smove("set", "set2", 1)).is<Promise<boolean>>();
expectType(redis.smismember("set", 1)).is<Promise<number[]>>();
expectType(redis.smismember("set", "a", 2)).is<Promise<number[]>>();
expectType(redis.zscore("zset", 1)).is<Promise<number | null>>();
expectType(redis.zincrby("zset", 1.5, 2)).is<Promise<number>>();
expectType(redis.zmscore("zset", 1)).is<Promise<(number | null)[]>>();
expectType(redis.zmscore("zset", "a", 2)).is<Promise<(number | null)[]>>();
expectType(redis.zrem("zset", 1)).is<Promise<number>>();
expectType(redis.zrem("zset", "a", 2)).is<Promise<number>>();
expectType(redis.zrank("zset", 1)).is<Promise<number | null>>();
expectType(redis.zrank("zset", 1, "WITHSCORE")).is<Promise<[number, number] | null>>();
expectType(redis.zrevrank("zset", 1)).is<Promise<number | null>>();
expectType(redis.zrevrank("zset", 1, "WITHSCORE")).is<Promise<[number, number] | null>>();
expectType(redis.zrange("zset", 0, 10, "BYSCORE", "LIMIT", 0, 2)).is<Promise<string[]>>();
expectType(redis.zrangestore("dest", "zset", 1, 3, "BYSCORE", "LIMIT", 0, 2)).is<Promise<number>>();
expectType(redis.zrevrangebylex("zset", "+", "-", "LIMIT", 0, 2)).is<Promise<string[]>>();
expectType(redis.zscan("zset", 0, "COUNT", 10)).is<Promise<[string, string[]]>>();
expectType(redis.pfadd("hll", 1)).is<Promise<number>>();
expectType(redis.geodist("geo", 1, "b")).is<Promise<string | null>>();
expectType(redis.geodist("geo", "a", 2)).is<Promise<string | null>>();
expectType(redis.geodist("geo", 1, "b", "km")).is<Promise<string | null>>();
expectType(redis.geodist("geo", "a", 2, "km")).is<Promise<string | null>>();
expectType(redis.geohash("geo", 1)).is<Promise<(string | null)[]>>();
expectType(redis.geopos("geo", 1)).is<Promise<([number, number] | null)[]>>();
expectType(redis.hset("hash", "f", 1)).is<Promise<number>>();
expectType(redis.hset("hash", "f", "v", "g", 2)).is<Promise<number>>();
expectType(redis.hsetnx("hash", "f", 1)).is<Promise<boolean>>();
expectType(redis.hmset("hash", "f", 1)).is<Promise<"OK">>();
expectType(redis.hmset("hash", "f", "v", "g", 2)).is<Promise<"OK">>();
expectType(redis.hmset("hash", ["f", 1])).is<Promise<"OK">>();
expectType(redis.hsetex("hash", "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FNX", "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FXX", "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "EX", 60, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "PX", 60_000, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "EXAT", 1_900_000_000, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "PXAT", 1_900_000_000_000, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "KEEPTTL", "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FNX", "EX", 60, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FNX", "PX", 60_000, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FNX", "EXAT", 1_900_000_000, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FNX", "PXAT", 1_900_000_000_000, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FNX", "KEEPTTL", "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FXX", "EX", 60, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FXX", "PX", 60_000, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FXX", "EXAT", 1_900_000_000, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FXX", "PXAT", 1_900_000_000_000, "FIELDS", 1, "f", 1)).is<Promise<number>>();
expectType(redis.hsetex("hash", "FXX", "KEEPTTL", "FIELDS", 1, "f", 1)).is<Promise<number>>();
// @ts-expect-error - the first option of set is a token: Redis answers a number there with a syntax error
redis.set("k", "v", 60);
// @ts-expect-error - a bigint value throws at runtime
redis.set("k", 10n);
// @ts-expect-error - a boolean value throws at runtime
redis.set("k", true);
// @ts-expect-error - a plain object value throws at runtime
redis.set("k", {});
// @ts-expect-error - a Number object value throws at runtime
redis.set("k", new Number(5));
// @ts-expect-error - a bigint value throws at runtime
redis.append("k", 10n);
// @ts-expect-error - a boolean element throws at runtime
redis.lpush("list", true);
// @ts-expect-error - a bigint member throws at runtime
redis.sadd("set", 10n);

// { buffer }
type Bytes = Buffer<ArrayBuffer>;
const bytes = { buffer: true } as const;
declare const either: { buffer: boolean | undefined };
declare const anything: any;
declare const names: string[];
expectType(redis.get("k", { buffer: true })).is<Promise<Bytes | null>>();
expectType(redis.get("k", { buffer: true })).extends<ReturnType<typeof redis.getBuffer>>();
expectType(redis.get("k", { buffer: false })).is<Promise<string | null>>();
expectType(redis.get("k", either)).is<Promise<string | Bytes | null>>();
expectType(redis.hgetall("k", bytes)).is<Promise<Record<string, Bytes>>>();
expectType(redis.randomkey(bytes)).is<Promise<Bytes | null>>();
expectType(redis.mget(...names, { buffer: true })).is<Promise<(Bytes | null)[]>>();
expectType(redis.mget("k", either)).is<Promise<(string | Bytes | null)[]>>();
expectType(redis.hmget("k", "a", "b", bytes)).is<Promise<Array<Bytes | null>>>();
expectType(redis.hmget("k", names, bytes)).is<Promise<Array<Bytes | null>>>();
expectType(redis.set("k", "v", "GET", bytes)).is<Promise<Bytes | null>>();
expectType(redis.set("k", "v", "EX", 1, "GET", bytes)).is<Promise<"OK" | Bytes | null>>();
expectType(redis.getex("k", "EX", 1, bytes)).is<Promise<Bytes | null>>();
expectType(redis.lpop("k", bytes)).is<Promise<Bytes | null>>();
expectType(redis.lpop("k", 2, bytes)).is<Promise<Bytes[] | null>>();
expectType(redis.blpop("k", 0, bytes)).is<Promise<[Bytes, Bytes] | null>>();
expectType(redis.hrandfield("k", 2, "WITHVALUES", bytes)).is<Promise<[Bytes, Bytes][]>>();
expectType(redis.zrange("k", 0, -1, bytes)).is<Promise<Bytes[]>>();
expectType(redis.zrange("k", 0, -1, "REV", "WITHSCORES", bytes)).is<Promise<[Bytes, number][]>>();
expectType(redis.zrangebyscore("k", 0, 9, "WITHSCORES", "LIMIT", 0, 5, bytes)).is<Promise<[Bytes, number][]>>();
expectType(redis.zdiff(1, "k", "WITHSCORES", bytes)).is<Promise<[Bytes, number][]>>();
expectType(redis.scan((await redis.scan(0, bytes))[0], "COUNT", 5, bytes)).is<Promise<[string, Bytes[]]>>();
expectType(redis.xrange("k", "-", "+", bytes)).is<Promise<[Bytes, Bytes[]][]>>();
expectType(redis.eval("", 0, "a", bytes)).is<Promise<any>>();
expectType(redis.send("GET", ["k"], bytes)).is<Promise<any>>();
expectType(redis.pubsub("CHANNELS", bytes)).is<Promise<any>>();
expectType(redis.pubsub("NUMSUB", "a", buf)).is<Promise<any>>();
expectType(redis.dump("k")).is<Promise<Bytes | null>>();
// A buffer has a `buffer` too, and `any` is still an argument of the command.
expectType(redis.mget("k", buf)).is<Promise<(string | null)[]>>();
expectType(redis.mget("k", anything)).is<Promise<(string | null)[]>>();
expectType(redis.lpop("k", anything)).is<Promise<string[] | null>>();
// The last signature has no option.
expectType<ReturnType<Bun.RedisClient["get"]>>().is<Promise<string | null>>();
expectType(redis.mget.apply(redis, names)).is<Promise<(string | null)[]>>();
expectType(names.map(redis.get, redis)).is<Promise<string | null>[]>();
class Prefixed extends Bun.RedisClient {
  override get(key: Bun.RedisClient.KeyLike): Promise<string | null> {
    return super.get(`prefix:${key}`);
  }
}
// What comes back can go in again.
declare const stored: Bytes;
redis.srem("k", stored);
redis.zscore("k", stored);
redis.eval("", 0, stored);
redis.xack("k", "g", stored);
redis.xrange("k", stored, "+", bytes);
redis.xread("STREAMS", "k", stored, bytes);
redis.xclaim("k", "g", "c", 0, stored, bytes);
redis.xtrim("k", "MINID", stored);
redis.geosearch("k", "FROMMEMBER", stored);
// @ts-expect-error - the reply could be either
redis.get("k", anything ? bytes : undefined);
// @ts-expect-error - it is the last argument
redis.mget(bytes, "k");
// @ts-expect-error - no stored data in the reply
redis.incr("k", bytes);
// @ts-expect-error - nor here
redis.object("ENCODING", "k", bytes);
// @ts-expect-error - nor here
redis.xgroup("DESTROY", "k", "g", bytes);
// @ts-expect-error - nor here
redis.debug("OBJECT", "k", bytes);
// @ts-expect-error - always bytes
redis.dump("k", bytes);
// @ts-expect-error - the result type does not choose the option
const notBytes: Promise<Bytes | null> = redis.get("k");
// @ts-expect-error - nor here
const norBytes: Promise<(Bytes | null)[]> = redis.mget("k");
