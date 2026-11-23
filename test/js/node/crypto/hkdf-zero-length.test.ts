/**
 * crypto.hkdfSync() and crypto.hkdf() with a `keylen` of 0 returned an empty
 * ArrayBuffer. Node documents `keylen` as "Must be greater than 0". Its
 * argument validation accepts 0, and the derivation then fails because OpenSSL
 * rejects a zero-length HKDF output:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/crypto/hkdf.js#L59
 * https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_hkdf.cc#L132-L135
 * So hkdfSync() throws a plain Error("HKDF derivation failed") with no `code`,
 * and hkdf() does not throw: it passes that error to the callback.
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot
 * import from "harness" for the same reason.
 */
import assert from "node:assert";
import crypto from "node:crypto";
import { describe, test } from "node:test";

function isDerivationFailure(error: unknown) {
  assert.ok(error instanceof Error);
  assert.deepStrictEqual(
    { name: error.name, message: error.message, hasCode: "code" in error },
    { name: "Error", message: "HKDF derivation failed", hasCode: false },
  );
  return true;
}

const ikms: [string, () => crypto.BinaryLike | crypto.KeyObject][] = [
  ["string", () => "key"],
  ["empty string", () => ""],
  ["Buffer", () => Buffer.from("key")],
  ["Uint16Array", () => new Uint16Array([1, 2, 3])],
  ["DataView", () => new DataView(new ArrayBuffer(3))],
  ["ArrayBuffer", () => new Uint8Array([1, 2, 3]).buffer],
  ["secret KeyObject", () => crypto.createSecretKey(Buffer.from("key"))],
];

describe("crypto.hkdfSync() and crypto.hkdf() with a length of 0", () => {
  for (const [name, ikm] of ikms) {
    test(`hkdfSync() throws (${name} ikm)`, () => {
      assert.throws(() => crypto.hkdfSync("sha256", ikm(), "", "", 0), isDerivationFailure);
      assert.throws(() => crypto.hkdfSync("sha512", ikm(), "salt", "info", 0), isDerivationFailure);
    });

    test(`hkdf() passes the error to the callback (${name} ikm)`, async () => {
      const { promise, resolve } = Promise.withResolvers<unknown[]>();
      const returned = crypto.hkdf("sha256", ikm(), "salt", "info", 0, (...args) => resolve(args));
      assert.strictEqual(returned, undefined);

      const args = await promise;
      assert.strictEqual(args.length, 1);
      isDerivationFailure(args[0]);
    });
  }

  test("argument validation still throws synchronously", () => {
    const callback = () => assert.fail("callback must not be invoked");
    const invalidDigest = { name: "TypeError", code: "ERR_CRYPTO_INVALID_DIGEST", message: "Invalid digest: nope" };
    assert.throws(() => crypto.hkdfSync("nope", "key", "", "", 0), invalidDigest);
    assert.throws(() => crypto.hkdf("nope", "key", "", "", 0, callback), invalidDigest);
  });
});

test("crypto.hkdfSync() and crypto.hkdf() with a length of 1 derive one byte", async () => {
  // The first byte of the 32-byte output.
  const expected = "9c";
  assert.strictEqual(
    Buffer.from(crypto.hkdfSync("sha256", "key", "salt", "info", 32))
      .toString("hex")
      .slice(0, 2),
    expected,
  );
  assert.strictEqual(Buffer.from(crypto.hkdfSync("sha256", "key", "salt", "info", 1)).toString("hex"), expected);

  const { promise, resolve, reject } = Promise.withResolvers<ArrayBuffer>();
  crypto.hkdf("sha256", "key", "salt", "info", 1, (err, key) => (err ? reject(err) : resolve(key)));
  assert.strictEqual(Buffer.from(await promise).toString("hex"), expected);
});
