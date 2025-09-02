import { expect, test } from "bun:test";
import crypto from "crypto";

// Regression test for issue #11029
// crypto.verify() should support null/undefined algorithm parameter
test("crypto.verify with null algorithm should work for RSA keys", () => {
  // Generate RSA key pair
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  const data = Buffer.from("test data");

  // Sign with null algorithm (should use default SHA256 for RSA)
  const signature = crypto.sign(null, data, privateKey);
  expect(signature).toBeInstanceOf(Buffer);

  // Verify with null algorithm should succeed
  const isVerified = crypto.verify(null, data, publicKey, signature);
  expect(isVerified).toBe(true);

  // Verify with wrong data should fail
  const wrongData = Buffer.from("wrong data");
  const isVerifiedWrong = crypto.verify(null, wrongData, publicKey, signature);
  expect(isVerifiedWrong).toBe(false);
});

test("crypto.verify with undefined algorithm should work for RSA keys", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  const data = Buffer.from("test data");
  const signature = crypto.sign(undefined, data, privateKey);

  // Verify with undefined algorithm
  const isVerified = crypto.verify(undefined, data, publicKey, signature);
  expect(isVerified).toBe(true);
});

test("crypto.verify with null algorithm should work for Ed25519 keys", () => {
  // Generate Ed25519 key pair (one-shot variant that doesn't need digest)
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  const data = Buffer.from("test data");

  // Ed25519 should work with null algorithm (no digest needed)
  const signature = crypto.sign(null, data, privateKey);
  expect(signature).toBeInstanceOf(Buffer);

  const isVerified = crypto.verify(null, data, publicKey, signature);
  expect(isVerified).toBe(true);
});

test("crypto.verify cross-verification between null and explicit SHA256", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  const data = Buffer.from("test data");

  // Sign with SHA256
  const signatureSHA256 = crypto.sign("SHA256", data, privateKey);

  // Should be able to verify with null (defaults to SHA256 for RSA)
  const isVerifiedWithNull = crypto.verify(null, data, publicKey, signatureSHA256);
  expect(isVerifiedWithNull).toBe(true);

  // Sign with null
  const signatureNull = crypto.sign(null, data, privateKey);

  // Should be able to verify with explicit SHA256
  const isVerifiedWithSHA256 = crypto.verify("SHA256", data, publicKey, signatureNull);
  expect(isVerifiedWithSHA256).toBe(true);
});

test("crypto.createVerify should also work with RSA keys", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  const data = Buffer.from("test data");

  // Create signature using createSign
  const signer = crypto.createSign("SHA256");
  signer.update(data);
  const signature = signer.sign(privateKey);

  // Verify using createVerify
  const verifier = crypto.createVerify("SHA256");
  verifier.update(data);
  const isVerified = verifier.verify(publicKey, signature);
  expect(isVerified).toBe(true);
});
