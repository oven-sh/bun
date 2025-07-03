import { describe, expect, test } from "bun:test";
import { createHash, getHashes } from "node:crypto";

describe("Crypto hash algorithms", () => {
  const algorithms = [
    "blake2b256",
    "blake2b512",
    "md4",
    "md5",
    "ripemd160",
    "sha1",
    "sha224",
    "sha256",
    "sha3-224",
    "sha3-256",
    "sha3-384",
    "sha3-512",
    "sha384",
    "sha512",
    "sha512-224",
    "sha512-256",
    "shake128",
    "shake256",
  ];

  test("getHashes() returns supported algorithms", () => {
    const supportedHashes = getHashes().sort();
    expect(supportedHashes).toEqual(algorithms);
  });

  for (const algorithm of algorithms) {
    test(`createHash supports ${algorithm}`, () => {
      expect(() => {
        const hash = createHash(algorithm);
        hash.update("hello world");
        hash.digest("hex");
      }).not.toThrow();
    });
  }
});
