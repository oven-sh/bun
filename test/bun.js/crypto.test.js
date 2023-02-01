import { sha, MD5, MD4, SHA1, SHA224, SHA256, SHA384, SHA512, SHA512_256, gc, CryptoHasher } from "bun";
import { it, expect, describe } from "bun:test";
import { readFileSync } from "fs";

const HashClasses = [MD5, MD4, SHA1, SHA224, SHA256, SHA384, SHA512, SHA512_256];

describe("CryptoHasher", () => {
  it("CryptoHasher.algorithms", () => {
    expect(CryptoHasher.algorithms).toEqual([
      "blake2b256",
      "md4",
      "md5",
      "ripemd160",
      "sha1",
      "sha224",
      "sha256",
      "sha384",
      "sha512",
      "sha512-256",
    ]);
  });

  it("CryptoHasher md5", () => {
    var hasher = new CryptoHasher("md5");
    hasher.update("hello world");
    expect(hasher.digest("hex")).toBe("5eb63bbbe01eeed093cb22bb8f5acdc3");
    expect(hasher.algorithm).toBe("md5");
  });

  it("CryptoHasher blake2b256", () => {
    var hasher = new CryptoHasher("blake2b256");
    hasher.update("hello world");
    expect(hasher.algorithm).toBe("blake2b256");

    expect(hasher.digest("hex")).toBe(
      //  b2sum --length=256
      "256c83b297114d201b30179f3f0ef0cace9783622da5974326b436178aeef610",
    );
  });

  it("CryptoHasher sha512", () => {
    var hasher = new CryptoHasher("sha512");
    hasher.update("hello world");
    expect(hasher.digest("hex")).toBe(
      "309ecc489c12d6eb4cc40f50c902f2b4d0ed77ee511a7c7a9bcd3ca86d4cd86f989dd35bc5ff499670da34255b45b0cfd830e81f605dcf7dc5542e93ae9cd76f",
    );
    expect(hasher.algorithm).toBe("sha512");
  });
});

describe("crypto", () => {
  for (let Hash of HashClasses) {
    for (let [input, label] of [
      ["hello world", '"hello world"'],
      ["hello world".repeat(20).slice(), '"hello world" x 20'],
      ["", "empty string"],
      ["a", '"a"'],
    ]) {
      describe(label, () => {
        gc(true);

        it(`${Hash.name} base64`, () => {
          gc(true);
          const result = new Hash();
          result.update(input);
          expect(typeof result.digest("base64")).toBe("string");
          gc(true);
        });

        it(`${Hash.name} hash base64`, () => {
          Hash.hash(input, "base64");
          gc(true);
        });

        it(`${Hash.name} hex`, () => {
          const result = new Hash();
          result.update(input);
          expect(typeof result.digest("hex")).toBe("string");
          gc(true);
        });

        it(`${Hash.name} hash hex`, () => {
          expect(typeof Hash.hash(input, "hex")).toBe("string");
          gc(true);
        });

        it(`${Hash.name} buffer`, () => {
          var buf = new Uint8Array(256);
          const result = new Hash();

          result.update(input);
          expect(result.digest(buf)).toBe(buf);
          expect(buf[0] != 0).toBe(true);
          gc(true);
        });

        it(`${Hash.name} buffer`, () => {
          var buf = new Uint8Array(256);

          expect(Hash.hash(input, buf) instanceof Uint8Array).toBe(true);
          gc(true);
        });
      });
    }
  }
});
