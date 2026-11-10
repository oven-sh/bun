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

const redis = Bun.redis;
const buf = Buffer.from("key");

// Bitmap
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

// Sorted set ranges: a literal WITHSCORES among the options types the reply as pairs, in any letter case and in
// any position but one: TypeScript does not read a literal between two spread arrays
declare const someOptions: string[];
declare const withScores: boolean;
declare const descending: boolean;
declare const offset: number;
declare const anyOption: any;
expectType(redis.zrange("zset", 0, -1)).is<Promise<string[]>>();
expectType(redis.zrange("zset", 0, -1, "REV")).is<Promise<string[]>>();
expectType(redis.zrange("zset", "1", "10", "BYSCORE", "LIMIT", "0", "5")).is<Promise<string[]>>();
expectType(redis.zrange("zset", 1, 10, "BYSCORE", "LIMIT", 0, 5)).is<Promise<string[]>>();
expectType(redis.zrange("zset", 0, -1, "WITHSCORES")).is<Promise<[string, number][]>>();
expectType(redis.zrange("zset", "0", "-1", "REV", "WITHSCORES")).is<Promise<[string, number][]>>();
expectType(redis.zrange("zset", 0, -1, "WITHSCORES", "REV")).is<Promise<[string, number][]>>();
expectType(redis.zrange("zset", 0, 10, "BYSCORE", "WITHSCORES", "LIMIT", "0", "5")).is<Promise<[string, number][]>>();
expectType(redis.zrange("zset", 0, 10, "BYSCORE", "LIMIT", 0, 5, "WITHSCORES")).is<Promise<[string, number][]>>();
expectType(redis.zrange("zset", 0, -1, "rev", "WithScores")).is<Promise<[string, number][]>>();
expectType(redis.zrange("zset", 0, -1, ...someOptions, "WITHSCORES")).is<Promise<[string, number][]>>();
expectType(redis.zrange("zset", 0, -1, ...someOptions, "WITHSCORES", "REV")).is<Promise<[string, number][]>>();
expectType(redis.zrange("zset", 0, -1, "REV", "WITHSCORES", ...someOptions)).is<Promise<[string, number][]>>();
expectType(redis.zrange("zset", 0, -1, ...(["REV", "WITHSCORES"] as const))).is<Promise<[string, number][]>>();
expectType(redis.zrevrange("zset", 0, -1)).is<Promise<string[]>>();
expectType(redis.zrevrange("zset", 0, -1, "WITHSCORES")).is<Promise<[string, number][]>>();
expectType(redis.zrevrange("zset", 0, -1, "withscores")).is<Promise<[string, number][]>>();
expectType(redis.zrangebyscore("zset", 0, 10, "LIMIT", 0, 5)).is<Promise<string[]>>();
expectType(redis.zrangebyscore("zset", 0, 10, "limit", "0", "5")).is<Promise<string[]>>();
expectType(redis.zrangebyscore("zset", 0, 10, "WITHSCORES", "LIMIT", 0, 5)).is<Promise<[string, number][]>>();
expectType(redis.zrangebyscore("zset", 0, 10, "LIMIT", 0, 5, "WITHSCORES")).is<Promise<[string, number][]>>();
expectType(redis.zrangebyscore("zset", 0, 10, "limit", 0, 5, "withscores")).is<Promise<[string, number][]>>();
expectType(redis.zrevrangebyscore("zset", 10, 0, "LIMIT", 0, 5)).is<Promise<string[]>>();
expectType(redis.zrevrangebyscore("zset", 10, 0, "WITHSCORES", "LIMIT", 0, 5)).is<Promise<[string, number][]>>();
expectType(redis.zrevrangebyscore("zset", 10, 0, "LIMIT", 0, 5, "WITHSCORES")).is<Promise<[string, number][]>>();
expectType(redis.zrevrangebyscore("zset", 10, 0, "limit", 0, 5, "withscores")).is<Promise<[string, number][]>>();
// An option typed `string` is not known to be WITHSCORES: the reply stays typed as members
expectType(redis.zrange("zset", 0, -1, ...someOptions)).is<Promise<string[]>>();
expectType(redis.zrange("zset", 0, -1, "REV", someOptions[0]!)).is<Promise<string[]>>();
expectType(redis.zrevrange("zset", 0, -1, ...someOptions)).is<Promise<string[]>>();
expectType(redis.zrangebyscore("zset", 0, 10, "LIMIT", someOptions[0]!, "5")).is<Promise<string[]>>();
expectType(redis.zrevrangebyscore("zset", 10, 0, ...someOptions)).is<Promise<string[]>>();
// An option typed `any` counts as not WITHSCORES too, and TypeScript still checks the options beside it
expectType(redis.zrange("zset", 0, -1, anyOption)).is<Promise<string[]>>();
expectType(redis.zrangebyscore("zset", 0, 10, "LIMIT", anyOption, anyOption, "WITHSCORES")).is<
  Promise<[string, number][]>
>();
// @ts-expect-error - null is not an option, also beside an option typed `any`
redis.zrange("zset", 0, -1, anyOption, null);
// @ts-expect-error - ZREVRANGE takes no numeric option, also beside an option typed `any`
redis.zrevrange("zset", 0, -1, anyOption, 5);
// A spread of a value typed `any` gives TypeScript no options to read: the reply stays typed as members
expectType(redis.zrange("zset", 0, -1, ...anyOption)).is<Promise<string[]>>();
expectType(redis.zrevrange("zset", 0, -1, ...anyOption)).is<Promise<string[]>>();
expectType(redis.zrangebyscore("zset", 0, 10, ...anyOption)).is<Promise<string[]>>();
expectType(redis.zrevrangebyscore("zset", 10, 0, ...anyOption)).is<Promise<string[]>>();
expectType(redis.zrange("zset", 0, -1, ...anyOption, "WITHSCORES")).is<Promise<[string, number][]>>();
// An option that may or may not be the literal gives either reply
expectType(redis.zrange("zset", 0, -1, ...(withScores ? ["WITHSCORES"] : []))).is<
  Promise<string[] | [string, number][]>
>();
expectType(redis.zrange("zset", 0, -1, withScores ? "WITHSCORES" : "REV")).is<Promise<string[] | [string, number][]>>();
expectType(redis.zrevrange("zset", 0, -1, ...(withScores ? ["WITHSCORES"] : []))).is<
  Promise<string[] | [string, number][]>
>();
expectType(redis.zrangebyscore("zset", 0, 10, ...(withScores ? ["WITHSCORES"] : []))).is<
  Promise<string[] | [string, number][]>
>();
expectType(redis.zrevrangebyscore("zset", 10, 0, ...(withScores ? ["WITHSCORES"] : []))).is<
  Promise<string[] | [string, number][]>
>();
// A spread that the generic overload cannot take as one list still compiles, through the overload that is not generic
expectType(
  redis.zrange(
    "zset",
    0,
    10,
    ...(offset > 0 ? ["BYSCORE", "LIMIT", `${offset}`, "5"] : ["BYSCORE", "LIMIT", "0", "5"]),
  ),
).is<Promise<string[]>>();
expectType(redis.zrevrange("zset", 0, -1, ...(descending ? [someOptions[0]!] : [someOptions[1]!]))).is<
  Promise<string[]>
>();
expectType(redis.zrangebyscore("zset", 0, 10, ...(offset > 0 ? ["LIMIT", offset, 5] : ["LIMIT", 0, 5]))).is<
  Promise<string[]>
>();
expectType(redis.zrevrangebyscore("zset", 10, 0, ...(offset > 0 ? ["LIMIT", offset, 5] : ["LIMIT", 0, 5]))).is<
  Promise<string[]>
>();
// A call through a union of two methods. The generic overloads of the byscore pair are identical, so TypeScript
// can use them. Those of zrange and zrevrange differ, so it uses the overloads that are not generic.
expectType(redis[descending ? "zrevrangebyscore" : "zrangebyscore"]("zset", 0, 10, "LIMIT", 0, 5, "WITHSCORES")).is<
  Promise<[string, number][]>
>();
expectType(redis[descending ? "zrevrangebyscore" : "zrangebyscore"]("zset", 0, 10, "LIMIT", 0, 5)).is<
  Promise<string[]>
>();
expectType(redis[descending ? "zrevrange" : "zrange"]("zset", 0, -1, "WITHSCORES")).is<Promise<[string, number][]>>();
expectType(redis[descending ? "zrevrange" : "zrange"]("zset", 0, -1, ...someOptions)).is<Promise<string[]>>();
// @ts-expect-error - an explicit undefined option throws at runtime, so it is not accepted here either
redis.zrange("zset", 0, -1, undefined);
// @ts-expect-error - ZREVRANGE takes no numeric option
redis.zrevrange("zset", 0, -1, 5);

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
