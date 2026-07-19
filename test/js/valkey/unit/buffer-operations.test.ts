import { RedisClient } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, isEnabled } from "../test-utils";

/**
 * `null` when the call passed argument validation (the returned Promise's
 * connection-error rejection is swallowed), else the synchronously thrown message.
 */
function validationError(call: () => Promise<unknown>): string | null {
  try {
    call().catch(() => {});
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * A client that never connects: nothing listens on port 1, and the offline
 * queue is disabled so returned promises reject immediately. Argument
 * validation runs synchronously before any connection attempt, so the
 * validation tests below need no server.
 */
function createUnconnectedClient(): RedisClient {
  return new RedisClient("redis://127.0.0.1:1", {
    enableOfflineQueue: false,
    autoReconnect: false,
  });
}

// PUBLISH and SPUBLISH share one argument path that accepts the same value
// types as every other command.
describe.each(["publish", "spublish"] as const)("RedisClient.%s argument types", method => {
  let client: RedisClient;

  beforeEach(() => {
    client = createUnconnectedClient();
  });

  afterEach(() => {
    client.close();
  });

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
    // The runtime accepts binary channel names through the same shared
    // argument path as keys, even though the documented channel type is string.
    expect(validationError(() => client[method](Buffer.from("binary-channel") as any, "x"))).toBeNull();
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

// `subscribeBuffer` shares `subscribe`'s argument handling; only the form the
// listener receives the message in differs.
describe.each(["subscribe", "subscribeBuffer"] as const)("RedisClient.%s argument validation", method => {
  let client: RedisClient;

  beforeEach(() => {
    client = createUnconnectedClient();
  });

  afterEach(() => {
    client.close();
  });

  test("rejects invalid arguments before connecting", () => {
    const listener = () => {};

    expect({
      isFunction: typeof client[method],
      missingListener: validationError(() => (client as any)[method]("channel")),
      numberListener: validationError(() => client[method]("channel", 42 as any)),
      numberChannel: validationError(() => client[method](42 as any, listener)),
      emptyChannelArray: validationError(() => client[method]([], listener)),
    }).toEqual({
      isFunction: "function",
      missingListener: `Expected listener to be a function for '${method}'.`,
      numberListener: `Expected listener to be a function for '${method}'.`,
      numberChannel: `Expected channel to be a string or array for '${method}'.`,
      emptyChannelArray: `${method} requires at least one channel`,
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

  /**
   * Run `body` with a freshly connected subscriber client, then tear it down.
   * Closing a client that is still subscribed keeps the event loop alive
   * (https://github.com/oven-sh/bun/issues/33103), so unsubscribe before close.
   */
  async function withSubscriber(body: (subscriber: RedisClient) => Promise<void>): Promise<void> {
    const subscriber = createClient(ConnectionType.TCP);
    await subscriber.connect();
    try {
      await body(subscriber);
    } finally {
      try {
        await subscriber.unsubscribe();
      } catch {}
      subscriber.close();
    }
  }

  test("publish delivers a binary message payload to a subscriber", async () => {
    const channel = ctx.generateKey("binary-pubsub");
    await withSubscriber(async subscriber => {
      const received = Promise.withResolvers<string>();
      // An unexpected disconnect must fail the test, not stall it until timeout.
      subscriber.onclose = error => received.reject(error);
      await subscriber.subscribe(channel, message => received.resolve(message));

      // Publish the raw UTF-8 bytes of a multi-byte string as a Uint8Array.
      // `subscribe` listeners receive messages as strings, so getting the
      // original text back proves the payload crossed the wire byte for byte.
      const text = "binary-pubsub \u00e9\u20ac\u{1f600}";
      expect(await ctx.redis.publish(channel, new TextEncoder().encode(text))).toBe(1);
      expect(await received.promise).toBe(text);
    });
  });

  test("subscribeBuffer delivers each message's raw bytes", async () => {
    // Two channels so the `subscribeBuffer(channels[], listener)` overload is covered.
    const channels = [ctx.generateKey("buffer-sub-a"), ctx.generateKey("buffer-sub-b")];
    await withSubscriber(async subscriber => {
      const received = new Map(channels.map(channel => [channel, Promise.withResolvers<Uint8Array>()]));
      subscriber.onclose = error => received.forEach(r => r.reject(error));
      await subscriber.subscribeBuffer(channels, (message, channel) => received.get(channel)!.resolve(message));

      // 0xff, 0xfe, and 0x80 are not valid UTF-8, so only a byte-level path
      // can round-trip this payload unchanged.
      const payload = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x01, 0x7f]);
      for (const channel of channels) {
        expect(await ctx.redis.publish(channel, payload)).toBe(1);
      }
      for (const channel of channels) {
        const message = await received.get(channel)!.promise;
        expect(message).toBeInstanceOf(Uint8Array);
        expect(message).toStrictEqual(payload);
      }
    });
  });

  test("string and buffer listeners coexist on one channel", async () => {
    const channel = ctx.generateKey("mixed-sub");
    await withSubscriber(async subscriber => {
      const asString = Promise.withResolvers<string>();
      const asBuffer = Promise.withResolvers<Uint8Array>();
      subscriber.onclose = error => {
        asString.reject(error);
        asBuffer.reject(error);
      };
      await subscriber.subscribe(channel, message => asString.resolve(message));
      await subscriber.subscribeBuffer(channel, message => asBuffer.resolve(message));

      const text = "mixed \u00e9\u20ac\u{1f600}";
      const bytes = new TextEncoder().encode(text);
      // PUBLISH reports one receiver: both listeners share a single subscriber connection.
      expect(await ctx.redis.publish(channel, bytes)).toBe(1);

      // The same payload reaches each listener in its own form.
      expect(await asString.promise).toBe(text);
      expect(await asBuffer.promise).toStrictEqual(bytes);
    });
  });

  test("unsubscribe removes a buffer listener without affecting string listeners", async () => {
    const channel = ctx.generateKey("unsub-buffer");
    await withSubscriber(async subscriber => {
      const stringSeen: string[] = [];
      const bufferSeen: string[] = [];
      const sawFirstString = Promise.withResolvers<void>();
      const sawFirstBuffer = Promise.withResolvers<void>();
      const sawSecondString = Promise.withResolvers<void>();
      subscriber.onclose = error => {
        sawFirstString.reject(error);
        sawFirstBuffer.reject(error);
        sawSecondString.reject(error);
      };

      const bufferListener = (message: Uint8Array) => {
        bufferSeen.push(new TextDecoder().decode(message));
        sawFirstBuffer.resolve();
      };
      await subscriber.subscribe(channel, message => {
        stringSeen.push(message);
        (stringSeen.length === 1 ? sawFirstString : sawSecondString).resolve();
      });
      await subscriber.subscribeBuffer(channel, bufferListener);

      expect(await ctx.redis.publish(channel, "one")).toBe(1);
      // Wait for both listeners to observe "one" before removing one of them,
      // since PUBLISH resolves independently of delivery to the subscriber.
      await Promise.all([sawFirstString.promise, sawFirstBuffer.promise]);

      await subscriber.unsubscribe(channel, bufferListener);
      expect(await ctx.redis.publish(channel, "two")).toBe(1);
      await sawSecondString.promise;

      // The string listener saw both messages; the removed buffer listener only the first.
      expect({ stringSeen, bufferSeen }).toEqual({
        stringSeen: ["one", "two"],
        bufferSeen: ["one"],
      });
    });
  });
});

function expectAssert(value: unknown): asserts value {
  expect(value).toBeTruthy();
}
