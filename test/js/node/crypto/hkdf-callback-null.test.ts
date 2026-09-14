import { describe, expect, jest, test } from "bun:test";
import "harness";
import crypto from "node:crypto";

// Test that callback receives null (not undefined) for error on success
// https://github.com/oven-sh/bun/issues/23211
test("crypto.hkdf callback should pass null (not undefined) on success", async () => {
  const secret = new Uint8Array([7, 158, 216, 197, 25, 77, 201, 5, 73, 119]);
  const salt = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]);
  const info = new Uint8Array([67, 111, 109, 112, 114, 101, 115, 115, 101, 100]);
  const length = 8;

  const promise = new Promise((resolve, reject) => {
    crypto.hkdf("sha256", secret, salt, info, length, (error, key) => {
      // Node.js passes null for error on success, not undefined
      expect(error).toBeNull();
      expect(error).not.toBeUndefined();
      expect(key).toBeInstanceOf(ArrayBuffer);
      resolve(true);
    });
  });

  await promise;
});

test("crypto.hkdfSync only accepts a secret KeyObject as ikm", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

  expect(() => crypto.hkdfSync("sha256", publicKey, "salt", "info", 16)).toThrowWithCode(
    TypeError,
    "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE",
  );
  expect(() => crypto.hkdfSync("sha256", publicKey, "salt", "info", 16)).toThrow(
    "Invalid key object type public, expected secret.",
  );

  expect(() => crypto.hkdfSync("sha256", privateKey, "salt", "info", 16)).toThrowWithCode(
    TypeError,
    "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE",
  );
  expect(() => crypto.hkdfSync("sha256", privateKey, "salt", "info", 16)).toThrow(
    "Invalid key object type private, expected secret.",
  );

  expect(crypto.hkdfSync("sha256", crypto.createSecretKey(Buffer.alloc(32, 7)), "salt", "info", 16)).toBeInstanceOf(
    ArrayBuffer,
  );
});

test("crypto.hkdf only accepts a secret KeyObject as ikm", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const callback = jest.fn();

  expect(() => crypto.hkdf("sha256", publicKey, "salt", "info", 16, callback)).toThrowWithCode(
    TypeError,
    "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE",
  );
  expect(() => crypto.hkdf("sha256", publicKey, "salt", "info", 16, callback)).toThrow(
    "Invalid key object type public, expected secret.",
  );

  expect(() => crypto.hkdf("sha256", privateKey, "salt", "info", 16, callback)).toThrowWithCode(
    TypeError,
    "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE",
  );
  expect(() => crypto.hkdf("sha256", privateKey, "salt", "info", 16, callback)).toThrow(
    "Invalid key object type private, expected secret.",
  );

  expect(callback).toHaveBeenCalledTimes(0);
});

// Node.js documents `keylen` as "Must be greater than 0". The argument validation accepts 0 and
// the derivation step then fails, so hkdfSync() throws and hkdf() reports the error to the callback.
describe.each([
  ["string", () => "key"],
  ["empty string", () => ""],
  ["Buffer", () => Buffer.from("key")],
  ["ArrayBuffer", () => new Uint8Array([1, 2, 3]).buffer],
  ["secret KeyObject", () => crypto.createSecretKey(Buffer.from("key"))],
] as const)("length 0 with %s ikm", (_name, ikm) => {
  test("crypto.hkdfSync throws", () => {
    for (const [salt, info] of [
      ["", ""],
      ["salt", "info"],
    ]) {
      let error: any;
      try {
        crypto.hkdfSync("sha256", ikm(), salt, info, 0);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect({ name: error.name, message: error.message, code: error.code }).toEqual({
        name: "Error",
        message: "HKDF derivation failed",
        code: undefined,
      });
    }
  });

  test("crypto.hkdf passes an error to the callback", async () => {
    const { promise, resolve } = Promise.withResolvers<{ args: unknown[] }>();
    // Node.js does not throw here: the failure comes from the derivation, not from validation.
    const returned = crypto.hkdf("sha256", ikm(), "salt", "info", 0, (...args) => resolve({ args }));
    expect(returned).toBeUndefined();

    const { args } = await promise;
    expect(args).toHaveLength(1);
    const error = args[0] as any;
    expect(error).toBeInstanceOf(Error);
    expect({ name: error.name, message: error.message, code: error.code }).toEqual({
      name: "Error",
      message: "HKDF derivation failed",
      code: undefined,
    });
  });
});

test("crypto.hkdfSync and crypto.hkdf still derive a key when length is 1", async () => {
  // The first byte of the 32-byte output. Node.js v26.3.0 returns the same value.
  const expected = "9c";
  expect(
    Buffer.from(crypto.hkdfSync("sha256", "key", "salt", "info", 32))
      .toString("hex")
      .slice(0, 2),
  ).toBe(expected);
  expect(Buffer.from(crypto.hkdfSync("sha256", "key", "salt", "info", 1)).toString("hex")).toBe(expected);

  const { promise, resolve, reject } = Promise.withResolvers<ArrayBuffer>();
  crypto.hkdf("sha256", "key", "salt", "info", 1, (err, key) => (err ? reject(err) : resolve(key)));
  expect(Buffer.from(await promise).toString("hex")).toBe(expected);
});
