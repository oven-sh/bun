import { expect, test } from "bun:test";
import crypto from "node:crypto";

// https://github.com/oven-sh/bun/issues/27445
// A failed crypto.createPrivateKey() call on an encrypted legacy RSA PEM
// should not poison subsequent unrelated crypto.createPrivateKey() calls.
test("crypto.createPrivateKey error does not poison subsequent calls", () => {
  // Generate an Ed25519 key pair
  const { privateKey: ed25519Key } = crypto.generateKeyPairSync("ed25519");
  const ed25519Der = ed25519Key.export({ format: "der", type: "pkcs8" });

  // Generate an encrypted RSA PEM key
  const { privateKey: rsaKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const encryptedRsaPem = rsaKey.export({
    format: "pem",
    type: "pkcs1",
    cipher: "aes-256-cbc",
    passphrase: "test-passphrase",
  });

  // First parse: Ed25519 DER should succeed
  const key1 = crypto.createPrivateKey({
    key: ed25519Der,
    format: "der",
    type: "pkcs8",
  });
  expect(key1.asymmetricKeyType).toBe("ed25519");

  // Try to import encrypted RSA PEM without passphrase -- should throw
  expect(() => crypto.createPrivateKey(encryptedRsaPem)).toThrow("Passphrase required for encrypted key");

  // Second parse: the same Ed25519 DER should still succeed
  const key2 = crypto.createPrivateKey({
    key: ed25519Der,
    format: "der",
    type: "pkcs8",
  });
  expect(key2.asymmetricKeyType).toBe("ed25519");
});
