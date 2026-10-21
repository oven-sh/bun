import { describe, expect, test } from "bun:test";
import { Hash, createHash, createHmac } from "crypto";
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
  ["Hash", () => createHash("sha256")],
  ["Hmac", () => createHmac("sha256", "key")],
])("%s drops a chunk written after digest()", async (_, make) => {
  const hash = make();
  hash.update("x");
  hash.digest();
  const { promise, resolve } = Promise.withResolvers();
  expect(hash.write("late", resolve)).toBe(true);
  expect(await promise).toBeNil();
  expect(() => hash.update("late")).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_HASH_FINALIZED" }));
});
