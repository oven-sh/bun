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
    await ctx.redis.set(keyBuffer, value);
    const out = await ctx.redis.getBuffer(keyBuffer);
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
});

function expectAssert(value: unknown): asserts value {
  expect(value).toBeTruthy();
}
