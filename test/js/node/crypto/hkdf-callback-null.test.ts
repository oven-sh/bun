import { expect, test } from "bun:test";
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
