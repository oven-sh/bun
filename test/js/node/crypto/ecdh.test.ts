import { expect, test } from "bun:test";
import { createECDH, ECDH, getCurves } from "node:crypto";

// Helper function to generate test key pairs for various curves
function generateTestKeyPairs() {
  const curves = getCurves();
  const keys = {};

  for (const curve of curves) {
    const ecdh = createECDH(curve);
    ecdh.generateKeys();

    keys[curve] = {
      compressed: ecdh.getPublicKey("hex", "compressed"),
      uncompressed: ecdh.getPublicKey("hex", "uncompressed"),
      instance: ecdh,
    };
  }

  return keys;
}

// Test creating an ECDH instance
test("crypto.createECDH - creates ECDH instance", () => {
  // Get a supported curve from the available curves
  const curve = getCurves()[0];
  const ecdh = createECDH(curve);
  expect(ecdh).toBeInstanceOf(ECDH);
});

// Test that unsupported curves throw errors
test("crypto.createECDH - throws for unsupported curves", () => {
  expect(() => createECDH("definitely-not-a-real-curve-name")).toThrow();
});

// Test ECDH key generation for each supported curve
test("ECDH - generateKeys works on all supported curves", () => {
  const curves = getCurves();
  for (const curve of curves) {
    const ecdh = createECDH(curve);
    const keys = ecdh.generateKeys();
    expect(keys).toBeInstanceOf(Buffer);
    expect(keys.length).toBeGreaterThan(0);
  }
});

// Test ECDH shared secret computation (use the first available curve)
test("ECDH - computeSecret generates same secret for both parties", () => {
  const curve = getCurves()[0];
  const alice = createECDH(curve);
  const bob = createECDH(curve);

  // Generate key pairs
  const alicePubKey = alice.generateKeys();
  const bobPubKey = bob.generateKeys();

  // Compute shared secrets
  const aliceSecret = alice.computeSecret(bobPubKey);
  const bobSecret = bob.computeSecret(alicePubKey);

  // Both shared secrets should be the same
  expect(aliceSecret.toString("hex")).toBe(bobSecret.toString("hex"));
});

// Test key formats
test("ECDH - supports different key formats", () => {
  const curve = getCurves()[0];
  const ecdh = createECDH(curve);
  ecdh.generateKeys();

  // Get public key in different formats
  const publicKeyHex = ecdh.getPublicKey("hex");
  const publicKeyBase64 = ecdh.getPublicKey("base64");
  const publicKeyBuffer = ecdh.getPublicKey();

  expect(typeof publicKeyHex).toBe("string");
  expect(typeof publicKeyBase64).toBe("string");
  expect(publicKeyBuffer).toBeInstanceOf(Buffer);
});

// Test key compression formats
test("ECDH - supports compressed and uncompressed formats", () => {
  const curve = getCurves()[0];
  const ecdh = createECDH(curve);
  ecdh.generateKeys();

  // Get public key in different compression formats
  const uncompressedKey = ecdh.getPublicKey("hex", "uncompressed");
  const compressedKey = ecdh.getPublicKey("hex", "compressed");

  expect(typeof uncompressedKey).toBe("string");
  expect(typeof compressedKey).toBe("string");
  // Compressed key should be shorter
  expect(compressedKey.length).toBeLessThan(uncompressedKey.length);
});

// Test exporting and importing private keys
test("ECDH - exports and imports private keys", () => {
  const curve = getCurves()[0];
  const ecdh = createECDH(curve);
  ecdh.generateKeys();

  // Export private key
  const privateKeyHex = ecdh.getPrivateKey("hex");

  // Create new instance
  const ecdh2 = createECDH(curve);

  // Import private key
  ecdh2.setPrivateKey(privateKeyHex, "hex");

  // Both instances should generate the same public key
  expect(ecdh2.getPublicKey("hex")).toBe(ecdh.getPublicKey("hex"));
});

// Test setting public key
test("ECDH - can set public key and compute secret", () => {
  const curve = getCurves()[0];
  const alice = createECDH(curve);
  const bob = createECDH(curve);

  // Generate keys
  alice.generateKeys();
  bob.generateKeys();

  // Get public keys
  const alicePubKey = alice.getPublicKey();
  const bobPubKey = bob.getPublicKey();

  // Create new instances
  const aliceClone = createECDH(curve);
  const bobClone = createECDH(curve);

  // Set private keys
  aliceClone.setPrivateKey(alice.getPrivateKey());
  bobClone.setPrivateKey(bob.getPrivateKey());

  // Compute secrets using original public keys
  const secret1 = aliceClone.computeSecret(bobPubKey);
  const secret2 = bobClone.computeSecret(alicePubKey);

  // Secrets should match
  expect(secret1.toString("hex")).toBe(secret2.toString("hex"));
});

// Test error handling
test("ECDH - throws when computing secret with invalid key", () => {
  const curve = getCurves()[0];
  const ecdh = createECDH(curve);
  ecdh.generateKeys();

  // Invalid public key
  const invalidKey = Buffer.from("invalid key");

  // Should throw error
  expect(() => ecdh.computeSecret(invalidKey)).toThrow();
});

// Test all curves with basic operations
test("ECDH - basic operations work on all supported curves", () => {
  const curves = getCurves();

  for (const curve of curves) {
    const alice = createECDH(curve);
    const bob = createECDH(curve);

    // Generate keys
    alice.generateKeys();
    bob.generateKeys();

    // Compute shared secret
    const aliceSecret = alice.computeSecret(bob.getPublicKey());
    const bobSecret = bob.computeSecret(alice.getPublicKey());

    // Check that secrets match
    expect(aliceSecret.toString("hex")).toBe(bobSecret.toString("hex"));
  }
});

// Tests for ECDH.convertKey functionality
test("ECDH.convertKey - converts between compressed and uncompressed formats", () => {
  const testKeys = generateTestKeyPairs();

  for (const curve of Object.keys(testKeys)) {
    const compressed = testKeys[curve].compressed;
    const uncompressed = testKeys[curve].uncompressed;

    // Test compressed to uncompressed
    const convertedToUncompressed = ECDH.convertKey(compressed, curve, "hex", "hex", "uncompressed");
    expect(convertedToUncompressed).toBe(uncompressed);

    // Test uncompressed to compressed
    const convertedToCompressed = ECDH.convertKey(uncompressed, curve, "hex", "hex", "compressed");
    expect(convertedToCompressed).toBe(compressed);
  }
});

test("ECDH.convertKey - supports different input and output encodings", () => {
  const testKeys = generateTestKeyPairs();

  const compressedHex = testKeys["prime256v1"].compressed;

  // Convert from hex to buffer
  const convertedToBuffer = ECDH.convertKey(compressedHex, "prime256v1", "hex", "buffer", "compressed");
  expect(convertedToBuffer).toBeInstanceOf(Buffer);
  expect(convertedToBuffer.toString("hex")).toBe(compressedHex);

  // Convert from hex to base64
  const convertedToBase64 = ECDH.convertKey(compressedHex, "prime256v1", "hex", "base64", "compressed");
  expect(typeof convertedToBase64).toBe("string");
  expect(Buffer.from(convertedToBase64, "base64").toString("hex")).toBe(compressedHex);
});

test("ECDH.convertKey - throws on invalid input", () => {
  // Invalid key
  expect(() => {
    ECDH.convertKey("invalid-key", "prime256v1", "hex", "hex", "compressed");
  }).toThrow("The argument 'encoding' is invalid for data of length 11. Received 'hex'");

  // Invalid curve
  expect(() => {
    ECDH.convertKey(
      "0102030405", // Some hex data
      "not-a-valid-curve",
      "hex",
      "hex",
      "compressed",
    );
  }).toThrow("Invalid EC curve name");

  // Invalid input encoding
  expect(() => {
    ECDH.convertKey("0102030405", "prime256v1", "invalid-encoding", "hex", "compressed");
  }).toThrow("Unknown encoding: invalid-encoding");

  // Invalid format
  expect(() => {
    ECDH.convertKey("0102030405", "prime256v1", "hex", "hex", "invalid-format");
  }).toThrow("Invalid ECDH format: invalid-format");
});

// Test that computeSecret reports an error instead of returning a buffer when the
// instance has a public key but no private key (ECDH_compute_key fails in that case).
test("ECDH - computeSecret throws when only a public key is set (no private key)", () => {
  const curve = "prime256v1";

  // A legitimate peer with a full key pair
  const alice = createECDH(curve);
  alice.generateKeys();
  const alicePubKey = alice.getPublicKey();

  // bob only sets a public key (a documented API) and never generates/sets a private key,
  // so the underlying key agreement cannot succeed.
  const bob = createECDH(curve);
  bob.setPublicKey(alicePubKey);

  // Must throw a clean error, never hand back a "secret" buffer.
  expect(() => bob.computeSecret(alicePubKey)).toThrow();

  // The legitimate case in the same curve still works and both sides agree.
  const carol = createECDH(curve);
  carol.generateKeys();
  const carolSecret = carol.computeSecret(alicePubKey);
  const aliceSecret = alice.computeSecret(carol.getPublicKey());
  expect(carolSecret).toBeInstanceOf(Buffer);
  expect(carolSecret.length).toBeGreaterThan(0);
  expect(carolSecret.toString("hex")).toBe(aliceSecret.toString("hex"));
});

// X9.62 hybrid point encoding (leading byte 0x06/0x07). BoringSSL rejects the
// form; the runtime translates to and from the equivalent uncompressed form.
// Fixed private keys keep the tests deterministic; the hybrid/uncompressed
// encodings and the shared secret below were produced by Node.js 26.
const hybridAPrivate = "0102030405060708091011121314151617181920212223242526272829303132";
const hybridBPrivate = "a1a2a3a4a5a6a7a8a9b0b1b2b3b4b5b6b7b8b9c0c1c2c3c4c5c6c7c8c9d0d1d2";
const hybridBPublic =
  "0712816f4996db7bc8113aafc3ceb879b964ec3d7e09da487da8cce96e445724a0d466fa5c9d33ecd008a52afc072d9bea08f95e8ae9ce039b2a962b962e8d5ac9";
const uncompressedBPublic =
  "0412816f4996db7bc8113aafc3ceb879b964ec3d7e09da487da8cce96e445724a0d466fa5c9d33ecd008a52afc072d9bea08f95e8ae9ce039b2a962b962e8d5ac9";
const hybridSharedSecret = "bef9b84e7feb8c32e33c2ee7ded4237ae21a801ea087776a0ad1bf15958125d3";

test("ECDH hybrid: getPublicKey produces the hybrid encoding", () => {
  const b = createECDH("prime256v1");
  b.setPrivateKey(hybridBPrivate, "hex");
  expect(b.getPublicKey("hex", "hybrid")).toBe(hybridBPublic);
  expect(b.getPublicKey("hex", "uncompressed")).toBe(uncompressedBPublic);
});

test("ECDH hybrid: convertKey round-trips through the hybrid encoding", () => {
  expect(ECDH.convertKey(uncompressedBPublic, "prime256v1", "hex", "hex", "hybrid")).toBe(hybridBPublic);
  expect(ECDH.convertKey(hybridBPublic, "prime256v1", "hex", "hex", "uncompressed")).toBe(uncompressedBPublic);
  expect(ECDH.convertKey(hybridBPublic, "prime256v1", "hex", "hex", "compressed")).toBe(
    ECDH.convertKey(uncompressedBPublic, "prime256v1", "hex", "hex", "compressed"),
  );
});

test("ECDH hybrid: computeSecret accepts a hybrid-encoded peer key", () => {
  const a = createECDH("prime256v1");
  a.setPrivateKey(hybridAPrivate, "hex");
  expect(a.computeSecret(hybridBPublic, "hex", "hex")).toBe(hybridSharedSecret);
  expect(a.computeSecret(uncompressedBPublic, "hex", "hex")).toBe(hybridSharedSecret);
});

test("ECDH hybrid: a parity bit that contradicts Y is rejected", () => {
  // hybridBPublic starts with 0x07 (Y is odd); 0x06 claims Y is even.
  const badParity = "06" + hybridBPublic.slice(2);
  const a = createECDH("prime256v1");
  a.setPrivateKey(hybridAPrivate, "hex");
  let thrown;
  try {
    a.computeSecret(badParity, "hex", "hex");
  } catch (e) {
    thrown = e;
  }
  expect(thrown?.code).toBe("ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY");
  expect(() => ECDH.convertKey(badParity, "prime256v1", "hex", "hex", "uncompressed")).toThrow(
    "Failed to convert Buffer to EC_POINT",
  );
});
