import { describe, expect, test } from "bun:test";
import { createHash, getHashes } from "node:crypto";

const hexOf = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const base64Of = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytesOfLength = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 255);

describe("Buffer.from(string)", () => {
  const texts = [
    "",
    "a",
    "hello world",
    "x".repeat(63),
    "x".repeat(64),
    "x".repeat(1000),
    "x".repeat(1001),
    "x".repeat(100_000),
    "café",
    "x".repeat(70) + "é",
    "é" + "x".repeat(70),
    "你好",
    "😀",
    "\x7f\x00\x01",
    "\x80",
  ];
  test.each(texts.map((text, i) => [i, text] as const))("text %i has the bytes of TextEncoder", (_, text) => {
    const expected = new TextEncoder().encode(text);
    for (const buffer of [Buffer.from(text), Buffer.from(text, "utf8"), Buffer.from(text, "utf-8")]) {
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(expected.length);
      expect(hexOf(buffer)).toBe(hexOf(expected));
      expect(buffer.toString()).toBe(text);
      expect(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length)).toEqual(expected);
    }
  });

  test("the buffer is the caller's own", () => {
    const text = "shared?";
    const first = Buffer.from(text);
    first[0] = 0;
    expect(Buffer.from(text)[0]).toBe("s".charCodeAt(0));
    expect(text).toBe("shared?");
  });
});

describe("buffer.toString", () => {
  test("hex and base64 of every length round 64", () => {
    for (let length = 0; length <= 130; length++) {
      const bytes = bytesOfLength(length);
      const buffer = Buffer.from(bytes);
      expect(buffer.toString("hex")).toBe(hexOf(bytes));
      expect(buffer.toString("base64")).toBe(base64Of(bytes));
      expect(buffer.toString("base64url")).toBe(
        base64Of(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""),
      );
    }
  });
});

describe("createHash", () => {
  const empty = {
    md5: "d41d8cd98f00b204e9800998ecf8427e",
    sha1: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    sha512:
      "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
  };

  test("a name is looked up rightly whatever was asked for before", () => {
    const names = [
      "sha1",
      "sha1",
      "SHA1",
      "sha256",
      "sha1",
      "md5",
      "MD5",
      "sha512",
      "SHA-512",
      "sha-1",
      "RSA-SHA1",
      "sha1",
    ];
    const digestOf: Record<string, string> = {
      sha1: empty.sha1,
      SHA1: empty.sha1,
      "sha-1": empty.sha1,
      "RSA-SHA1": empty.sha1,
      sha256: empty.sha256,
      md5: empty.md5,
      MD5: empty.md5,
      sha512: empty.sha512,
      "SHA-512": empty.sha512,
    };
    for (const name of names) {
      expect(createHash(name).digest("hex")).toBe(digestOf[name]);
      expect(() => createHash("sha1 ")).toThrow("Digest method not supported");
      expect(() => createHash("sha")).toThrow("Digest method not supported");
      expect(() => createHash("")).toThrow("Digest method not supported");
      expect(() => createHash("shá1")).toThrow("Digest method not supported");
      expect(() => createHash("sha1你")).toThrow("Digest method not supported");
    }
  });

  test("a string is hashed as its UTF-8 bytes", () => {
    for (const text of ["", "hello", "x".repeat(1000), "café", "x".repeat(70) + "é", "你好", "😀"]) {
      const expected = createHash("sha256").update(new TextEncoder().encode(text)).digest("hex");
      expect(createHash("sha256").update(text).digest("hex")).toBe(expected);
      expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(expected);
      const [first = "", ...rest] = text;
      expect(createHash("sha256").update(first).update(rest.join("")).digest("hex")).toBe(expected);
    }
    expect(createHash("sha1").update("68656c6c6f", "hex").digest("hex")).toBe(
      createHash("sha1").update("hello").digest("hex"),
    );
    expect(createHash("sha1").update("café", "latin1").digest("hex")).toBe(
      createHash("sha1")
        .update(Uint8Array.of(0x63, 0x61, 0x66, 0xe9))
        .digest("hex"),
    );
  });

  test("every encoding of a digest says the same bytes", () => {
    for (const name of ["md5", "sha1", "sha224", "sha256", "sha384", "sha512"]) {
      const bytes = createHash(name).update("abc").digest();
      expect(bytes).toBeInstanceOf(Buffer);
      expect(createHash(name).update("abc").digest("hex")).toBe(hexOf(bytes));
      expect(createHash(name).update("abc").digest("base64")).toBe(base64Of(bytes));
      expect(createHash(name).update("abc").digest("latin1")).toBe(String.fromCharCode(...bytes));
      expect(
        createHash(name)
          .update("abc")
          .digest("buffer" as any),
      ).toEqual(bytes);
    }
    expect(createHash("sha1").update("abc").digest("hex")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  test.skipIf(!getHashes().includes("shake256"))("a digest longer than any fixed one", () => {
    const long = createHash("shake256", { outputLength: 200 }).update("abc").digest("hex");
    expect(long).toHaveLength(400);
    for (const outputLength of [1, 63, 64, 65]) {
      expect(createHash("shake256", { outputLength }).update("abc").digest("hex")).toBe(
        long.slice(0, outputLength * 2),
      );
    }
  });

  test("a finished hash stays finished, and its stream still hands the digest on", async () => {
    const hash = createHash("sha1").update("abc");
    expect(hash.digest("hex")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(() => hash.digest("hex")).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_HASH_FINALIZED" }));
    expect(() => hash.update("d")).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_HASH_FINALIZED" }));
    expect(() => hash.copy()).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_HASH_FINALIZED" }));

    const stream = createHash("sha1");
    stream.end("abc");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString("hex")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  test("a copy goes its own way", () => {
    const first = createHash("sha256").update("ab");
    const second = first.copy();
    expect(first.update("c").digest("hex")).toBe(createHash("sha256").update("abc").digest("hex"));
    expect(second.update("d").digest("hex")).toBe(createHash("sha256").update("abd").digest("hex"));
  });
});
