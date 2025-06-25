import { createHash, getHashes } from "node:crypto";
import { test, expect, describe } from "bun:test";

describe("createHash with various algorithms", () => {
  // https://nodejs.org/api/crypto.html#crypto_crypto_gethashes
  // filtered out signature algorithms

  const digestAlgorithms = [
    "blake2b512",
    "md4",
    "md5",
    "md5-sha1",
    "ripemd160",
    "rmd160",
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

  test("getHashes() returns supported digest algorithms", () => {
    const supportedHashes = getHashes().sort();
    const expectedHashes = [...digestAlgorithms].sort();
    console.log("supportedHashes", supportedHashes);
    console.log("expectedHashes", expectedHashes);
    expect(supportedHashes).toEqual(expectedHashes);
  });

  for (const algorithm of digestAlgorithms) {
    test(`createHash supports ${algorithm}`, () => {
      expect(() => {
        const hash = createHash(algorithm);
        hash.update("hello world");
        hash.digest("hex");
      }).not.toThrow();
    });
  }
});
