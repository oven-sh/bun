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
