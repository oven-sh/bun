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

    [null, true, 1, () => {}, {}].forEach(invalid => {
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
