import { RedisClient } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, isEnabled } from "../test-utils";

// PUBLISH and SPUBLISH share one argument path, which accepts the same value
// types as every other command (set, hset, ...). Argument validation runs
// synchronously before any connection attempt, so these tests need no server:
// a value that passes validation yields a Promise (which rejects later with a
// connection error we swallow), while an invalid value throws right away.
describe.each(["publish", "spublish"] as const)("RedisClient.%s argument types", method => {
  let client: RedisClient;

  beforeEach(() => {
    // Nothing listens on port 1, and the offline queue is disabled so the
    // returned promises reject immediately instead of waiting on a connection.
    client = new RedisClient("redis://127.0.0.1:1", {
      enableOfflineQueue: false,
      autoReconnect: false,
    });
  });

  afterEach(() => {
    client.close();
  });

  /** `null` when the value passed argument validation, else the thrown message. */
  function validationError(call: () => Promise<unknown>): string | null {
    try {
      call().catch(() => {});
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }

  test("accepts binary and string-coercible message types", () => {
    // 0xff and 0x80 are not valid UTF-8, so this payload is genuinely binary.
    const bytes = [0x00, 0xff, 0x80, 0x01];

    expect({
      string: validationError(() => client[method]("channel", "hello")),
      Buffer: validationError(() => client[method]("channel", Buffer.from(bytes))),
      Uint8Array: validationError(() => client[method]("channel", new Uint8Array(bytes))),
      ArrayBuffer: validationError(() => client[method]("channel", new Uint8Array(bytes).buffer as any)),
      DataView: validationError(() => client[method]("channel", new DataView(new Uint8Array(bytes).buffer))),
      Blob: validationError(() => client[method]("channel", new Blob([new Uint8Array(bytes)]))),
      number: validationError(() => client[method]("channel", 42 as any)),
    }).toEqual({
      string: null,
      Buffer: null,
      Uint8Array: null,
      ArrayBuffer: null,
      DataView: null,
      Blob: null,
      number: null,
    });
  });

  test("accepts a binary channel name", () => {
    expect(validationError(() => client[method](Buffer.from("binary-channel"), "x"))).toBeNull();
  });

  test("still rejects values that are neither strings nor buffers", () => {
    expect({
      objectMessage: validationError(() => client[method]("channel", {} as any)),
      booleanMessage: validationError(() => client[method]("channel", true as any)),
      objectChannel: validationError(() => client[method]({} as any, "x")),
      missingChannel: validationError(() => (client as any)[method]()),
    }).toEqual({
      objectMessage: `Expected message to be a string or buffer for '${method}'.`,
      booleanMessage: `Expected message to be a string or buffer for '${method}'.`,
      objectChannel: `Expected channel to be a string or buffer for '${method}'.`,
      missingChannel: `Expected channel to be a string or buffer for '${method}'.`,
    });
  });
});

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

  test("publish delivers a binary message payload to a subscriber", async () => {
    const channel = ctx.generateKey("binary-pubsub");
    const subscriber = createClient(ConnectionType.TCP);
    await subscriber.connect();

    try {
      const received = Promise.withResolvers<string>();
      await subscriber.subscribe(channel, message => received.resolve(message));

      // Publish the raw UTF-8 bytes of a multi-byte string as a Uint8Array.
      // Subscribers receive messages as strings, so getting the original text
      // back proves the binary payload crossed the wire byte for byte.
      const text = "binary-pubsub \u00e9\u20ac\u{1f600}";
      expect(await ctx.redis.publish(channel, new TextEncoder().encode(text))).toBe(1);
      expect(await received.promise).toBe(text);
    } finally {
      subscriber.close();
    }
  });
});

function expectAssert(value: unknown): asserts value {
  expect(value).toBeTruthy();
}
