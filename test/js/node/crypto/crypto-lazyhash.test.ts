import { describe, expect, test } from "bun:test";
import { Cipheriv, Decipheriv, Hash, Hmac, createCipheriv, createDecipheriv, createHash, createHmac } from "crypto";
import { Transform } from "stream";
import { StringDecoder } from "string_decoder";

describe("LazyHash quirks", () => {
  test("hash instanceof Transform", () => {
    const hash = createHash("sha256");
    expect(hash instanceof Transform).toBe(true);
  });
  test("Hash.prototype instanceof Transform", () => {
    expect(Hash.prototype instanceof Transform).toBe(true);
  });
});

const key = Buffer.alloc(32, 1);
const iv = Buffer.alloc(16, 2);

// Hash/Hmac/Cipheriv/Decipheriv are native classes extending Transform whose Transform half is
// only constructed when _readableState/_writableState is first touched (Node's LazyTransform).
describe.each([
  [
    "Hash",
    Hash,
    (...extra: unknown[]) => new (Hash as any)("sha256", ...extra),
    2,
    ["_flush", "_transform", "copy", "digest", "update"],
  ],
  [
    "Hmac",
    Hmac,
    (...extra: unknown[]) => new (Hmac as any)("sha256", "key", ...extra),
    3,
    ["_flush", "_transform", "digest", "update"],
  ],
  [
    "Cipheriv",
    Cipheriv,
    (...extra: unknown[]) => new (Cipheriv as any)("aes-256-cbc", key, iv, ...extra),
    4,
    ["_flush", "_transform", "final", "getAuthTag", "setAAD", "setAutoPadding", "update"],
  ],
  [
    "Decipheriv",
    Decipheriv,
    (...extra: unknown[]) => new (Decipheriv as any)("aes-256-cbc", key, iv, ...extra),
    4,
    ["_flush", "_transform", "final", "setAAD", "setAuthTag", "setAutoPadding", "update"],
  ],
] as const)("%s class shape", (name, Ctor: any, make, length, methods) => {
  test("instance has no own properties until options are passed or it is streamed", () => {
    const h = make();
    expect(Object.getOwnPropertySymbols(h)).toEqual([]);
    expect(Object.getOwnPropertyNames(h)).toEqual([]);
    expect(Object.keys(make({ highWaterMark: 5 }))).toEqual(["_options"]);
    h.on("data", () => {});
    expect(Object.hasOwn(h, "_readableState")).toBe(true);
    expect(Object.hasOwn(h, "_writableState")).toBe(true);
    expect(h._writableState.decodeStrings).toBe(false);
  });

  test("prototype chain and constructor shape", () => {
    const h = make();
    expect(Object.getPrototypeOf(h)).toBe(Ctor.prototype);
    expect(Object.getPrototypeOf(Ctor.prototype)).toBe(Transform.prototype);
    // crypto.Hash / crypto.Hmac are deprecate() wrappers around the real constructor.
    const RealCtor = Ctor.prototype.constructor;
    expect(Object.getPrototypeOf(RealCtor)).toBe(Transform);
    expect(h).toBeInstanceOf(Transform);
    expect(h).toBeInstanceOf(Ctor);
    expect(Ctor.length).toBe(length);
    expect(RealCtor.name).toBe(name);
    expect(Object.prototype.toString.call(h)).toBe("[object Object]");
    expect(Object.keys(Ctor.prototype).sort()).toEqual([...methods, "_readableState", "_writableState"].sort());
    for (const accessor of ["_readableState", "_writableState"]) {
      const d = Object.getOwnPropertyDescriptor(Ctor.prototype, accessor)!;
      expect(typeof d.get).toBe("function");
      expect(typeof d.set).toBe("function");
    }
  });

  test("callable without new, subclassable, chainable", () => {
    const RealCtor = Ctor.prototype.constructor;
    const viaCall =
      name === "Hash" ? RealCtor("sha1") : name === "Hmac" ? RealCtor("sha1", "k") : RealCtor("aes-256-cbc", key, iv);
    expect(viaCall).toBeInstanceOf(Ctor);
    class Sub extends Ctor {
      extra() {
        return 1;
      }
    }
    const s: any =
      name === "Hash" ? new Sub("sha1") : name === "Hmac" ? new Sub("sha1", "k") : new Sub("aes-256-cbc", key, iv);
    expect(s).toBeInstanceOf(Sub);
    expect(s).toBeInstanceOf(Ctor);
    expect(s.extra()).toBe(1);
    if (name === "Hash" || name === "Hmac") {
      expect(s.update("a")).toBe(s);
      expect(s.digest("hex")).toHaveLength(40);
    } else {
      expect(s.setAutoPadding(true)).toBe(s);
    }
  });
});

describe.each([
  ["Hash", () => createHash("sha256")],
  ["Hmac", () => createHmac("sha256", "key")],
] as const)("%s as a stream", (name, make) => {
  test("digest() is still readable after the stream ends", async () => {
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
    // Hash caches its digest; a finalized Hmac returns an empty string.
    expect(h.digest("hex")).toBe(name === "Hash" ? expected : "");
  });
});

test("Cipheriv/Decipheriv output encoding uses a lazily created this._decoder", async () => {
  const c = createCipheriv("aes-256-cbc", key, iv);
  expect(c._decoder).toBeUndefined();
  const hex = c.update("héllo wörld ", "utf8", "hex") + c.update(Buffer.from("more")).toString("hex") + c.final("hex");
  expect(c._decoder).toBeInstanceOf(StringDecoder);
  const d = createDecipheriv("aes-256-cbc", key, iv);
  // split mid-character: the decoder must carry state between update() calls
  expect(d.update(hex.slice(0, 6), "hex", "utf8") + "|" + d.update(hex.slice(6), "hex", "utf8")).toBe(
    "|héllo wörld mo",
  );
  expect(() => d.final("latin1")).toThrow(expect.objectContaining({ code: "ERR_INTERNAL_ASSERTION" }));
  expect(() => createDecipheriv("aes-256-cbc", key, iv).update(hex, "hex", "bogus" as any)).toThrow(
    expect.objectContaining({ code: "ERR_UNKNOWN_ENCODING" }),
  );
  // stream mode, and a bad final surfaces as an 'error' event via _flush(callback)
  const sc = createCipheriv("aes-256-cbc", key, iv);
  sc.end("stream me");
  const enc: Buffer[] = [];
  for await (const chunk of sc) enc.push(chunk as Buffer);
  const sd = createDecipheriv("aes-256-cbc", key, iv);
  sd.end(Buffer.concat(enc));
  const dec: Buffer[] = [];
  for await (const chunk of sd) dec.push(chunk as Buffer);
  expect(Buffer.concat(dec).toString()).toBe("stream me");
  const bad = createDecipheriv("aes-256-cbc", key, iv);
  const { promise, resolve } = Promise.withResolvers<any>();
  bad.on("error", resolve);
  bad.end(Buffer.from("00", "hex"));
  expect((await promise).code).toBe("ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH");
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
