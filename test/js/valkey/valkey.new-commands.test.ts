import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";
import * as net from "node:net";

// Every command added in this PR. All exist in both modern Redis (7+) and Valkey.
const NEW_COMMANDS = [
  // Bitmap
  "bitop",
  "bitpos",
  "bitfield",
  // HyperLogLog
  "pfcount",
  "pfmerge",
  // Geo
  "geoadd",
  "geodist",
  "geohash",
  "geopos",
  "geosearch",
  "geosearchstore",
  // Scripting
  "eval",
  "evalsha",
  "fcall",
  "function",
  // Server / connection
  "dbsize",
  "flushdb",
  "flushall",
  "info",
  "time",
  "echo",
  "lastsave",
  "client",
  "config",
  "debug",
  "command",
  // Generic key
  "object",
  "sort",
  "wait",
  "lcs",
  // Streams
  "xadd",
  "xlen",
  "xrange",
  "xrevrange",
  "xread",
  "xreadgroup",
  "xdel",
  "xtrim",
  "xack",
  "xclaim",
  "xautoclaim",
  "xpending",
  "xinfo",
  "xgroup",
  "xsetid",
] as const;

describe("RedisClient new command methods", () => {
  for (const name of NEW_COMMANDS) {
    test(`RedisClient.prototype.${name} is a function`, () => {
      expect(typeof RedisClient.prototype[name]).toBe("function");
    });
  }
});

// Functional tests below require a reachable Redis/Valkey on localhost:6379.
// In CI the docker-based valkey.test.ts exercises these more thoroughly; here
// we validate that each new wrapper actually sends the right command.
const hasLocalRedis = await new Promise<boolean>(resolve => {
  const sock = net.connect({ host: "127.0.0.1", port: 6379 });
  const done = (ok: boolean) => {
    sock.destroy();
    resolve(ok);
  };
  sock.once("connect", () => done(true));
  sock.once("error", () => done(false));
  setTimeout(() => done(false), 1000);
});

describe.skipIf(!hasLocalRedis)("RedisClient new commands (functional)", () => {
  const url = "redis://127.0.0.1:6379";
  const prefix = `bun-newcmd-${Date.now()}-${Math.random().toString(36).slice(2)}:`;
  const key = (name: string) => prefix + name;

  async function withClient<T>(fn: (r: RedisClient) => Promise<T>): Promise<T> {
    const r = new RedisClient(url);
    await r.connect();
    try {
      return await fn(r);
    } finally {
      // best-effort cleanup of any keys we created
      const created = await r.keys(prefix + "*");
      if (created.length) await r.del(...created);
      r.close();
    }
  }

  test("optional trailing arguments may be undefined (but null is rejected)", async () => {
    // Commands wired through the variadic (...strings) template should skip
    // `undefined` so optional parameters in the TypeScript signatures (e.g.
    // flushdb(mode?)) work, but should still reject explicit `null` with a
    // clear client-side error (matching existing scan(null)/zrangestore(null)
    // tests in valkey.test.ts).
    await withClient(async r => {
      const info = await r.info(undefined as any);
      expect(typeof info).toBe("string");
      expect(info.length).toBeGreaterThan(0);

      expect(typeof (await r.command(undefined as any))).not.toBe("undefined");

      expect(await r.geoadd(key("geo-opt"), 13.361389, 38.115556, "Palermo")).toBe(1);
      const dist = await r.geodist(key("geo-opt"), "Palermo", "Palermo", undefined);
      expect(dist).toBe("0.0000");

      // null is still rejected client-side
      expect(async () => {
        await r.geoadd(key("geo-opt"), null as any);
      }).toThrow(/string or buffer/);
    });

    // flushdb on an isolated database
    const r = new RedisClient(url + "/10");
    await r.connect();
    try {
      await r.set(key("opt-flush"), "x");
      const mode: "SYNC" | undefined = undefined;
      expect(await r.flushdb(mode)).toBe("OK");
      expect(await r.get(key("opt-flush"))).toBeNull();
    } finally {
      r.close();
    }
  });

  test("ECHO / DBSIZE / TIME / INFO / LASTSAVE / COMMAND", async () => {
    await withClient(async r => {
      expect(await r.echo("hello")).toBe("hello");

      const before = await r.dbsize();
      await r.set(key("dbsize"), "x");
      expect(await r.dbsize()).toBe(before + 1);

      const [secs, micros] = await r.time();
      expect(Number(secs)).toBeGreaterThan(1_700_000_000);
      expect(Number(micros)).toBeGreaterThanOrEqual(0);

      const info = await r.info("server");
      expect(typeof info).toBe("string");
      expect(info.length).toBeGreaterThan(0);

      expect(typeof (await r.lastsave())).toBe("number");

      const count = await r.command("COUNT");
      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThan(50);
    });
  });

  test("BITOP / BITPOS / BITFIELD", async () => {
    await withClient(async r => {
      await r.set(key("b1"), "abc");
      await r.set(key("b2"), "abd");
      expect(await r.bitop("AND", key("bdest"), key("b1"), key("b2"))).toBe(3);
      expect(await r.get(key("bdest"))).toBe("ab`");

      await r.set(key("bits"), "\x00\x0f");
      expect(await r.bitpos(key("bits"), 1)).toBe(12);
      expect(await r.bitpos(key("bits"), 0)).toBe(0);

      const bf = await r.bitfield(key("bf"), "SET", "u8", 0, 200, "GET", "u8", 0);
      expect(bf).toEqual([0, 200]);
    });
  });

  test("PFCOUNT / PFMERGE", async () => {
    await withClient(async r => {
      await r.pfadd(key("hll1"), "a");
      await r.pfadd(key("hll1"), "b");
      await r.pfadd(key("hll2"), "b");
      await r.pfadd(key("hll2"), "c");
      expect(await r.pfcount(key("hll1"))).toBe(2);
      expect(await r.pfmerge(key("hllmerged"), key("hll1"), key("hll2"))).toBe("OK");
      expect(await r.pfcount(key("hllmerged"))).toBe(3);
    });
  });

  test("GEOADD / GEODIST / GEOHASH / GEOPOS / GEOSEARCH / GEOSEARCHSTORE", async () => {
    await withClient(async r => {
      expect(await r.geoadd(key("geo"), 13.361389, 38.115556, "Palermo", 15.087269, 37.502669, "Catania")).toBe(2);

      const dist = await r.geodist(key("geo"), "Palermo", "Catania", "km");
      expect(typeof dist).toBe("string");
      expect(Number(dist)).toBeCloseTo(166.2742, 3);
      expect(await r.geodist(key("geo"), "Palermo", "Nowhere")).toBeNull();

      const hashes = await r.geohash(key("geo"), "Palermo", "Catania");
      expect(hashes).toHaveLength(2);
      expect(hashes[0]).toMatch(/^sqc8/);

      const pos = await r.geopos(key("geo"), "Palermo", "Nowhere");
      // RESP3 returns GEOPOS coordinates as Double (number), unlike GEODIST which
      // returns a bulk string. Assert the runtime type matches the TS declaration.
      expect(typeof pos[0]![0]).toBe("number");
      expect(typeof pos[0]![1]).toBe("number");
      expect(pos[0]![0]).toBeCloseTo(13.361389, 4);
      expect(pos[0]![1]).toBeCloseTo(38.115556, 4);
      expect(pos[1]).toBeNull();

      expect(await r.geosearch(key("geo"), "FROMLONLAT", 15, 37, "BYRADIUS", 200, "km", "ASC")).toEqual([
        "Catania",
        "Palermo",
      ]);

      expect(await r.geosearchstore(key("geodest"), key("geo"), "FROMLONLAT", 15, 37, "BYRADIUS", 100, "km")).toBe(1);
    });
  });

  test("EVAL / EVALSHA", async () => {
    await withClient(async r => {
      expect(await r.eval("return ARGV[1]", 0, "hello")).toBe("hello");
      await r.set(key("eval"), "world");
      expect(await r.eval("return redis.call('GET', KEYS[1])", 1, key("eval"))).toBe("world");

      const sha = await r.script("LOAD", "return 42");
      expect(await r.evalsha(sha, 0)).toBe(42);
    });
  });

  test("OBJECT / SORT / LCS / WAIT", async () => {
    await withClient(async r => {
      await r.set(key("obj"), "hello");
      const encoding = await r.object("ENCODING", key("obj"));
      expect(typeof encoding).toBe("string");

      await r.rpush(key("sort"), "3", "1", "2");
      expect(await r.sort(key("sort"))).toEqual(["1", "2", "3"]);
      expect(await r.sort(key("sort"), "DESC")).toEqual(["3", "2", "1"]);

      await r.set(key("lcs1"), "ohmytext");
      await r.set(key("lcs2"), "mynewtext");
      expect(await r.lcs(key("lcs1"), key("lcs2"))).toBe("mytext");
      expect(await r.lcs(key("lcs1"), key("lcs2"), "LEN")).toBe(6);

      expect(await r.wait(0, 10)).toBe(0);
    });
  });

  test("CLIENT / CONFIG", async () => {
    await withClient(async r => {
      expect(await r.client("SETNAME", "bun-newcmd")).toBe("OK");
      expect(await r.client("GETNAME")).toBe("bun-newcmd");

      const cfg = await r.config("GET", "maxmemory");
      expect(cfg).toHaveProperty("maxmemory");
    });
  });

  test("FLUSHDB", async () => {
    // Use a dedicated database so we don't wipe anything another test put in db 0.
    const r = new RedisClient(url + "/9");
    await r.connect();
    try {
      await r.set(key("flush"), "x");
      expect(await r.flushdb("SYNC")).toBe("OK");
      expect(await r.get(key("flush"))).toBeNull();
    } finally {
      r.close();
    }
  });

  test("XADD / XLEN / XRANGE / XREVRANGE / XREAD / XDEL / XTRIM / XSETID", async () => {
    await withClient(async r => {
      const stream = key("stream");
      const id1 = await r.xadd(stream, "*", "f", "v1");
      const id2 = await r.xadd(stream, "*", "f", "v2");
      expect(id1).toMatch(/^\d+-\d+$/);
      expect(await r.xlen(stream)).toBe(2);

      const range = await r.xrange(stream, "-", "+");
      expect(range).toHaveLength(2);
      expect(range[0][0]).toBe(id1);
      expect(range[0][1]).toEqual(["f", "v1"]);

      const rev = await r.xrevrange(stream, "+", "-");
      expect(rev[0][0]).toBe(id2);

      const read = await r.xread("COUNT", 10, "STREAMS", stream, "0");
      expect(read[stream]).toHaveLength(2);

      expect(await r.xdel(stream, id1!)).toBe(1);
      expect(await r.xtrim(stream, "MAXLEN", 0)).toBe(1);
      expect(await r.xlen(stream)).toBe(0);

      await r.xadd(stream, "*", "f", "v");
      expect(await r.xsetid(stream, "99999999999999-0")).toBe("OK");
    });
  });

  test("XGROUP / XREADGROUP / XACK / XPENDING / XCLAIM / XAUTOCLAIM / XINFO", async () => {
    await withClient(async r => {
      const stream = key("cgstream");
      const group = "grp";

      expect(await r.xgroup("CREATE", stream, group, "$", "MKSTREAM")).toBe("OK");

      const id = await r.xadd(stream, "*", "msg", "hello");
      const read = await r.xreadgroup("GROUP", group, "consumer1", "COUNT", 10, "STREAMS", stream, ">");
      expect(read[stream][0][0]).toBe(id);

      const pendingBefore = await r.xpending(stream, group);
      expect(pendingBefore[0]).toBe(1);

      const claimed = await r.xclaim(stream, group, "consumer2", 0, id!);
      expect(claimed[0][0]).toBe(id);

      const auto = await r.xautoclaim(stream, group, "consumer3", 0, "0");
      expect(auto[1][0][0]).toBe(id);

      expect(await r.xack(stream, group, id!)).toBe(1);
      const pendingAfter = await r.xpending(stream, group);
      expect(pendingAfter[0]).toBe(0);

      const groups = await r.xinfo("GROUPS", stream);
      expect(Array.isArray(groups)).toBe(true);
      expect(groups.length).toBe(1);

      expect(await r.xgroup("DESTROY", stream, group)).toBe(1);
    });
  });

  test("FUNCTION / FCALL", async () => {
    await withClient(async r => {
      const lib = "bunlib" + Math.random().toString(36).slice(2, 10);
      const code = `#!lua name=${lib}\nredis.register_function('${lib}_fn', function(keys, args) return args[1] end)`;
      await r.function("LOAD", "REPLACE", code);
      try {
        expect(await r.fcall(`${lib}_fn`, 0, "xyz")).toBe("xyz");
      } finally {
        await r.function("DELETE", lib);
      }
    });
  });
});
