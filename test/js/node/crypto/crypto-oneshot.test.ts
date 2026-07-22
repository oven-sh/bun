import { describe, expect, test } from "bun:test";
import crypto from "crypto";
import { readFileSync } from "fs";
import { path } from "../test/common/fixtures";

describe("crypto.hash", () => {
  test("throws for invalid arguments", () => {
    ([undefined, null, true, 1, () => {}, {}] as const).forEach(invalid => {
      expect(() => crypto.hash(invalid, "test")).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    [undefined, null, true, 1, () => {}, {}].forEach(invalid => {
      expect(() => crypto.hash("sha1", invalid)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    [null, true, 1, () => {}, []].forEach(invalid => {
      expect(() => crypto.hash("sha1", "test", invalid)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    expect(() => crypto.hash("sha1", "test", "not an encoding")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
      }),
    );
  });

  test("accepts an options object for the third argument", () => {
    const expectedHex = crypto.createHash("sha256").update("abc").digest("hex");
    const expectedBase64 = crypto.createHash("sha256").update("abc").digest("base64");

    expect(crypto.hash("sha256", "abc", {})).toBe(expectedHex);
    expect(crypto.hash("sha256", "abc", { outputEncoding: undefined })).toBe(expectedHex);
    expect(crypto.hash("sha256", "abc", { outputEncoding: "hex" })).toBe(expectedHex);
    expect(crypto.hash("sha256", "abc", { outputEncoding: "base64" })).toBe(expectedBase64);

    for (const enc of ["buffer", "Buffer", "BUFFER"]) {
      const buf = crypto.hash("sha256", "abc", { outputEncoding: enc });
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.toString("hex")).toBe(expectedHex);
    }

    expect(() => crypto.hash("sha256", "abc", { outputEncoding: 42 })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });

  test("options.outputLength controls XOF digest length", () => {
    for (const [algorithm, length] of [
      ["shake128", 8],
      ["shake128", 64],
      ["shake256", 16],
      ["shake256", 256],
    ] as const) {
      const expected = crypto.createHash(algorithm, { outputLength: length }).update("abc").digest("hex");
      const expectedBase64 = crypto.createHash(algorithm, { outputLength: length }).update("abc").digest("base64");
      expect(crypto.hash(algorithm, "abc", { outputLength: length })).toBe(expected);
      expect(crypto.hash(algorithm, "abc", { outputLength: length, outputEncoding: "hex" })).toBe(expected);
      expect(crypto.hash(algorithm, "abc", { outputLength: length, outputEncoding: "base64" })).toBe(expectedBase64);

      const buf = crypto.hash(algorithm, Buffer.from("abc"), { outputLength: length, outputEncoding: "buffer" });
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBe(length);
      expect(buf.toString("hex")).toBe(expected);
    }

    expect(crypto.hash("shake128", "abc", { outputLength: 0 })).toBe("");
    expect(crypto.hash("shake128", "abc", { outputLength: 0, outputEncoding: "buffer" })).toEqual(Buffer.alloc(0));

    expect(() => crypto.hash("shake128", "abc", { outputLength: 8, outputEncoding: "not an encoding" })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );

    expect(crypto.hash("sha256", "abc", { outputLength: 32 })).toBe(
      crypto.createHash("sha256").update("abc").digest("hex"),
    );
    expect(() => crypto.hash("sha256", "abc", { outputLength: 16 })).toThrow(/does not support XOF/);
    expect(() => crypto.hash("sha3-256", "abc", { outputLength: 16 })).toThrow(/does not support XOF/);

    for (const invalid of [-1, 1.5, NaN, 2 ** 32]) {
      expect(() => crypto.hash("shake128", "abc", { outputLength: invalid })).toThrow(
        expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
      );
    }
    expect(() => crypto.hash("shake128", "abc", { outputLength: "8" })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });

  test("option getters cannot invalidate the input buffer mid-call", () => {
    const ab = new ArrayBuffer(64, { maxByteLength: 64 });
    const view = new Uint8Array(ab);
    view.fill(0x61);
    const expected = crypto.createHash("sha256").update(Buffer.alloc(64, 0x61)).digest("hex");
    let called = 0;
    const result = crypto.hash("sha256", view, {
      get outputLength() {
        called++;
        ab.resize(0);
        return undefined;
      },
    });
    expect(called).toBe(1);
    // After the getter runs the view is length 0; the hash must reflect that,
    // not the 64 bytes that existed when the call started.
    expect(result).toBe(crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
    expect(result).not.toBe(expected);
  });
  const input = readFileSync(path("utf8_test_text.txt"));
  [
    "blake2b256",
    "blake2b512",
    "blake2s256",
    "ripemd160",
    "rmd160",
    "md4",
    "md5",
    "sha1",
    "sha128",
    "sha224",
    "sha256",
    "sha384",
    "sha512",
    "sha-1",
    "sha-224",
    "sha-256",
    "sha-384",
    "sha-512",
    "sha-512/224",
    "sha-512_224",
    "sha-512224",
    "sha512-224",
    "sha-512/256",
    "sha-512_256",
    "sha-512256",
    "sha512-256",
    "sha384",
    "sha3-224",
    "sha3-256",
    "sha3-384",
    "sha3-512",
    "shake128",
    "shake256",
  ].forEach(method => {
    test(`output matches crypto.createHash(${method})`, () => {
      for (const outputEncoding of ["buffer", "hex", "base64", undefined]) {
        const oldDigest = crypto
          .createHash(method)
          .update(input)
          .digest(outputEncoding || "hex");
        const digestFromBuffer = crypto.hash(method, input, outputEncoding);
        expect(digestFromBuffer).toEqual(oldDigest);

        const digestFromString = crypto.hash(method, input.toString(), outputEncoding);
        expect(digestFromString).toEqual(oldDigest);
      }
    });
  });
});

describe("crypto.verify", () => {
  test("uses the signature bytes provided at call time", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const data = Buffer.from("data to sign");
    const signature = crypto.sign("sha256", data, privateKey);
    expect(crypto.verify("sha256", data, publicKey, signature)).toBe(true);

    const publicPem = publicKey.export({ type: "spki", format: "pem" });
    let passphraseReads = 0;
    const verified = crypto.verify(
      "sha256",
      data,
      {
        key: publicPem,
        format: "pem",
        get passphrase() {
          passphraseReads++;
          signature.fill(0);
          return undefined;
        },
      },
      signature,
    );
    expect(passphraseReads).toBe(1);
    expect(verified).toBe(true);
  });
});
