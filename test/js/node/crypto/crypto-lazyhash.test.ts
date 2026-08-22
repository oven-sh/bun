import { describe, expect, test } from "bun:test";
import { Hash, Hmac, createHash, createHmac } from "crypto";
import { Transform } from "stream";

describe("LazyHash quirks", () => {
  test("hash instanceof Transform", () => {
    const hash = createHash("sha256");
    expect(hash instanceof Transform).toBe(true);
  });
  test("Hash.prototype instanceof Transform", () => {
    expect(Hash.prototype instanceof Transform).toBe(true);
  });
});

// Hash/Hmac are single native objects (no JS wrapper holding a native handle) whose
// prototypes extend LazyTransform. These pin the observable class shape against Node's.
describe.each([
  ["Hash", Hash, (...extra: unknown[]) => new (Hash as any)("sha256", ...extra), 2],
  ["Hmac", Hmac, (...extra: unknown[]) => new (Hmac as any)("sha256", "key", ...extra), 3],
] as const)("%s class shape", (name, Ctor: any, make, length) => {
  test("no wrapper/handle split: the instance carries no symbol-keyed handle", () => {
    const h = make();
    expect(Object.getOwnPropertySymbols(h)).toEqual([]);
    expect(Object.getOwnPropertyNames(h)).toEqual([]);
    // LazyTransform's `this._options = options` is only materialized when options are passed.
    expect(Object.keys(make({ highWaterMark: 5 }))).toEqual(["_options"]);
  });

  test("prototype chain and constructor shape match Node", () => {
    const h = make();
    expect(Object.getPrototypeOf(h)).toBe(Ctor.prototype);
    const LazyTransformPrototype = Object.getPrototypeOf(Ctor.prototype);
    expect(LazyTransformPrototype.constructor.name).toBe("LazyTransform");
    expect(Object.getPrototypeOf(LazyTransformPrototype)).toBe(Transform.prototype);
    // Ctor is the deprecate() wrapper around the real constructor, which extends LazyTransform.
    expect(Object.getPrototypeOf(Object.getPrototypeOf(Ctor))).toBe(LazyTransformPrototype.constructor);
    expect(h).toBeInstanceOf(Transform);
    expect(h).toBeInstanceOf(Ctor);
    expect(Ctor.length).toBe(length);
    expect(Ctor.prototype.constructor.name).toBe(name);
    expect(Object.prototype.toString.call(h)).toBe("[object Object]");
    const protoKeys = Object.keys(Ctor.prototype).sort();
    expect(protoKeys).toEqual(
      name === "Hash"
        ? ["_flush", "_transform", "copy", "digest", "update"]
        : ["_flush", "_transform", "digest", "update"],
    );
  });

  test("callable without new, subclassable, update() returns this", () => {
    const viaCall = name === "Hash" ? Ctor.prototype.constructor("sha1") : Ctor.prototype.constructor("sha1", "k");
    expect(viaCall).toBeInstanceOf(Ctor);
    class Sub extends Ctor {
      extra() {
        return 1;
      }
    }
    const s: any = name === "Hash" ? new Sub("sha1") : new Sub("sha1", "k");
    expect(s).toBeInstanceOf(Sub);
    expect(s).toBeInstanceOf(Ctor);
    expect(s.extra()).toBe(1);
    expect(s.update("a")).toBe(s);
    expect(s.digest("hex")).toHaveLength(40);
  });

  test("works as a stream and digest() is still readable after the stream ends", async () => {
    const h = make();
    h.end("streamed");
    const chunks: Buffer[] = [];
    for await (const chunk of h) chunks.push(chunk as Buffer);
    const out = Buffer.concat(chunks);
    const expected =
      name === "Hash"
        ? createHash("sha256").update("streamed").digest("hex")
        : createHmac("sha256", "key").update("streamed").digest("hex");
    expect(out.toString("hex")).toBe(expected);
    // Hash caches its digest; a finalized Hmac returns an empty string, as in Bun before.
    expect(h.digest("hex")).toBe(name === "Hash" ? expected : "");
  });
});

test("_flush() after digest() does not un-finalize the hash", () => {
  const h = createHash("sha256").update("abc");
  const hex = h.digest("hex");
  const pushed: Buffer[] = [];
  (h as any).push = (chunk: Buffer) => pushed.push(chunk);
  (h as any)._flush(() => {});
  expect(Buffer.concat(pushed).toString("hex")).toBe(hex);
  expect(() => h.update("d")).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_HASH_FINALIZED" }));
  expect(() => h.copy()).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_HASH_FINALIZED" }));
  expect(() => h.digest()).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_HASH_FINALIZED" }));
});

test("hash.copy() returns a base Hash carrying the current state", () => {
  class Sub extends Hash {}
  const h = new (Sub as any)("sha256");
  h.update("abc");
  const c = h.copy();
  expect(c.constructor).toBe(Hash.prototype.constructor);
  expect(c.digest("hex")).toBe(createHash("sha256").update("abc").digest("hex"));
  expect(h.update("d").digest("hex")).toBe(createHash("sha256").update("abcd").digest("hex"));
  expect(() => h.copy()).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_HASH_FINALIZED" }));
  expect(() => new (Hash as any)(createHash("md5"))).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  expect(createHash("shake128").update("z").copy({ outputLength: 4 }).digest("hex")).toBe("bb66897e");
});
