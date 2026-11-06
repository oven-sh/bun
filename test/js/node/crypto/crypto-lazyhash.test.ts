import { describe, expect, test } from "bun:test";
import { Hash, createCipheriv, createDecipheriv, createHash, createHmac } from "crypto";
import { once } from "events";
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

test.each([
  ["Hash", "late", () => createHash("sha256")],
  ["Hmac", "late", () => createHmac("sha256", "key")],
  ["Hmac", "", () => createHmac("sha256", "key")],
] as const)("%s reports the chunk %j written after digest()", async (_, chunk, make) => {
  const hash = make();
  hash.update("x");
  hash.digest();
  const error = once(hash, "error");
  expect(hash.write(chunk)).toBe(false);
  expect(await error).toEqual([
    expect.objectContaining({ code: "ERR_CRYPTO_HASH_UPDATE_FAILED", message: "Hash update failed" }),
  ]);
  expect(() => hash.update("late")).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_HASH_FINALIZED" }));
});

test("Hash takes an empty chunk after digest()", async () => {
  const hash = createHash("sha256");
  const digest = hash.update("x").digest();
  hash.end("");
  expect(Buffer.concat(await hash.toArray())).toEqual(digest);
});

describe("hex of an odd length", () => {
  const key = Buffer.alloc(16, 1);
  const iv = Buffer.alloc(16, 2);
  const streams = [
    ["Hash", () => createHash("sha256")],
    ["Hmac", () => createHmac("sha256", "key")],
    ["Cipheriv", () => createCipheriv("aes-128-ctr", key, iv)],
    ["Decipheriv", () => createDecipheriv("aes-128-ctr", key, iv)],
  ] as const;

  test.each(streams)("%s.write() leaves out the last digit", async (_, make) => {
    const [odd, even] = [make(), make()];
    odd.end("abc", "hex");
    even.end("ab", "hex");
    const output = Buffer.concat(await odd.toArray());
    expect(output).not.toBeEmpty();
    expect(output).toEqual(Buffer.concat(await even.toArray()));
  });

  test.each(streams)("%s.update() throws", (_, make) => {
    expect(() => make().update("abc", "hex")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: "The argument 'encoding' is invalid for data of length 3. Received 'hex'",
      }),
    );
  });
});
