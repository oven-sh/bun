import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, isEnabled } from "../test-utils";

describe.skipIf(!isEnabled)("Valkey: Buffer Operations", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });

  test("getBuffer returns binary data as Uint8Array", async () => {
    const key = ctx.generateKey("buffer-test");

    const binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64]);
    await ctx.redis.set(key, binaryData);

    const asString = await ctx.redis.get(key);
    const asBuffer = await ctx.redis.getBuffer(key);

    expectAssert(asString);
    expectAssert(asBuffer);

    expect(asBuffer.buffer).toBeInstanceOf(ArrayBuffer);
    expect(asBuffer).toBeInstanceOf(Uint8Array);
    expect(asBuffer.length).toBe(binaryData.length);
    expect(asBuffer).toStrictEqual(binaryData);

    for (let i = 0; i < binaryData.length; i++) {
      expect(asBuffer[i]).toBe(binaryData[i]);
    }

    const stringBuffer = Buffer.from(asString);
    expect(stringBuffer.length).toBe(binaryData.length);
  });

  test("getBuffer for non-existent key returns null", async () => {
    const key = ctx.generateKey("non-existent");
    const result = await ctx.redis.getBuffer(key);
    expect(result).toBeNull();
  });

  test("Really long buffer", async () => {
    const key = ctx.generateKey("long-buffer");
    const binaryData = new Uint8Array(1000000);
    await ctx.redis.set(key, binaryData);
    const result = await ctx.redis.getBuffer(key);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  test("Buffer with no bytes", async () => {
    const key = ctx.generateKey("empty-buffer");
    const binaryData = new Uint8Array(0);
    await ctx.redis.set(key, binaryData);
    const result = await ctx.redis.getBuffer(key);
    expectAssert(result);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  test("Buffer with null bytes", async () => {
    const key = ctx.generateKey("null-bytes");
    const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
    await ctx.redis.set(key, binaryData);
    const result = await ctx.redis.getBuffer(key);
    expectAssert(result);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
      expect(result[i]).toBe(binaryData[i]);
    }
  });

  test("concurrent getBuffer against large blob", async () => {
    const key = ctx.generateKey("concurrent");
    const big = new Uint8Array(500_000).map((_, i) => i % 256);
    await ctx.redis.set(key, big);
    const readers = Array.from({ length: 20 }, () => ctx.redis.getBuffer(key));
    const results = await Promise.all(readers);
    for (const r of results) expect(r).toStrictEqual(big);
  });

  test("set and getBuffer with ArrayBufferView key", async () => {
    const keyBytes = new Uint8Array([0x6b, 0x65, 0x79, 0x21]); // "key!"
    const value = new Uint8Array([0x01, 0x02, 0x03]);
    await ctx.redis.set(keyBytes, value);
    const out = await ctx.redis.getBuffer(keyBytes);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out).toStrictEqual(value);
  });

  test("set and getBuffer with ArrayBuffer key", async () => {
    const keyBuffer = new Uint8Array([0x62, 0x75, 0x6e, 0x21]).buffer; // "bun!"
    expect(keyBuffer).toBeInstanceOf(ArrayBuffer);
    const value = new Uint8Array([0x0a, 0x0b]);
    await ctx.redis.set(keyBuffer as any, value);
    const out = await ctx.redis.getBuffer(keyBuffer as any);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out).toStrictEqual(value);
  });

  test("set and getBuffer with Blob key", async () => {
    const keyBytes = new Uint8Array([0x74, 0x65, 0x73, 0x74]); // "test"
    const keyBlob = new Blob([keyBytes]);
    const value = new Uint8Array([0xff, 0xee, 0xdd]);
    await ctx.redis.set(keyBlob, value);
    const out = await ctx.redis.getBuffer(keyBlob);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out).toStrictEqual(value);
  });

  test("{ buffer: true } reads back what was stored", async () => {
    const { redis } = ctx;
    const [bytes, value] = [{ buffer: true } as const, Buffer.of(0xff, 0xfe, 0x00, 0x41)];
    const [string, hash, list, set, zset, stream, copy] = ["s", "h", "l", "set", "z", "x", "c"].map(ctx.generateKey);
    await redis.set(string, value);
    await redis.hset(hash, "f", value);
    await redis.rpush(list, value);
    await redis.sadd(set, value);
    await redis.send("ZADD", [zset, 1, value]);
    const id = await redis.send("XADD", [stream, "*", "f", value]);

    expect(await redis.mget(string, copy, bytes)).toEqual([value, null]);
    expect(await redis.hgetall(hash, bytes)).toEqual({ f: value });
    expect(await redis.lrange(list, 0, -1, bytes)).toEqual([value]);
    expect(await redis.sscan(set, 0, bytes)).toEqual(["0", [value]]);
    expect(await redis.zrange(zset, 0, -1, "WITHSCORES", bytes)).toEqual([[value, 1]]);
    expect(await redis.xrange(stream, "-", "+", bytes)).toEqual([[Buffer.from(id), [Buffer.from("f"), value]]]);

    expect(await redis.send("RESTORE", [copy, 0, (await redis.dump(hash))!], bytes)).toBe("OK");
    expect(await redis.hget(copy, "f", bytes)).toEqual(value);

    await redis.send("MULTI", []);
    expect<unknown>(await redis.dump(string)).toBe("QUEUED");
    expect(await redis.send("EXEC", [])).toEqual([await redis.send("DUMP", [string], bytes)]);

    await redis.send("MULTI", []);
    expect(await redis.get(string)).toBe("QUEUED");
    expect(await redis.send("EXEC", [], bytes)).toEqual([value]);

    await redis.send("HSET", [hash, value, "v"]);
    expect((await redis.hgetall(hash, bytes).catch(error => error)).reply).toContainEqual([value, Buffer.from("v")]);
    expect((await redis.hscan(hash, 0, bytes))[1]).toContainEqual(value);

    await redis.send("MULTI", []);
    await Promise.all([redis.echo("a"), redis.hgetall(hash, bytes), redis.getdel(string, bytes)]);
    expect(await redis.send("EXEC", [])).toEqual(["a", expect.any(Error), value]);
  });
});

function expectAssert(value: unknown): asserts value {
  expect(value).toBeTruthy();
}
