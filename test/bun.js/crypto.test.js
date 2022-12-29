import {
  sha,
  MD5,
  MD4,
  SHA1,
  SHA224,
  SHA256,
  SHA384,
  SHA512,
  SHA512_256,
  RIPEMD160,
  gc,
} from "bun";
import { it, expect, describe } from "bun:test";
import { readFileSync } from "fs";

const HashClasses = [
  MD5,
  MD4,
  SHA1,
  SHA224,
  SHA256,
  SHA384,
  SHA512,
  SHA512_256,
  RIPEMD160,
];

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
