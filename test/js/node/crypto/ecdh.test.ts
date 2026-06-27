import { describe, expect, test } from "bun:test";
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

describe("ECDH hybrid point format", () => {
  // X9.62 hybrid: prefix 0x06|y_bit, followed by X || Y (same layout as uncompressed 0x04).
  // Known-good P-256 hybrid point emitted by Node.js (prefix 0x07 => y is odd).
  const knownHybrid =
    "0710fc112b0b2d57a701d22b1dc7f9aad0d66dd8ab6eaf71e0e6531ba136f4f14072ff13402beadb679e9d9636600f806070f22ad44b23ac0e2a75cd605c9e4d8f";
  const knownUncompressed = "04" + knownHybrid.slice(2);
  const knownCompressed = "03" + knownHybrid.slice(2, 66);

  test.each(["prime256v1", "secp384r1", "secp521r1"])("getPublicKey/generateKeys emit hybrid on %s", curve => {
    const ecdh = createECDH(curve);
    const gen = ecdh.generateKeys(undefined, "hybrid");
    const hyb = ecdh.getPublicKey(undefined, "hybrid");
    const unc = ecdh.getPublicKey(undefined, "uncompressed");

    expect(gen.equals(hyb)).toBe(true);
    expect(hyb.length).toBe(unc.length);
    expect(unc[0]).toBe(0x04);
    // Hybrid prefix is 0x06 | (Y's least-significant bit).
    expect(hyb[0]).toBe(0x06 | (unc[unc.length - 1] & 1));
    // Coordinates after the prefix byte are identical.
    expect(hyb.subarray(1).equals(unc.subarray(1))).toBe(true);
  });

  test("ECDH.convertKey round-trips hybrid with a known vector", () => {
    expect(ECDH.convertKey(knownHybrid, "prime256v1", "hex", "hex", "uncompressed")).toBe(knownUncompressed);
    expect(ECDH.convertKey(knownHybrid, "prime256v1", "hex", "hex", "compressed")).toBe(knownCompressed);
    expect(ECDH.convertKey(knownHybrid, "prime256v1", "hex", "hex", "hybrid")).toBe(knownHybrid);
    expect(ECDH.convertKey(knownUncompressed, "prime256v1", "hex", "hex", "hybrid")).toBe(knownHybrid);
    expect(ECDH.convertKey(knownCompressed, "prime256v1", "hex", "hex", "hybrid")).toBe(knownHybrid);
  });

  test.each(["prime256v1", "secp384r1", "secp521r1"])("ECDH.convertKey round-trips hybrid on %s", curve => {
    const ecdh = createECDH(curve);
    ecdh.generateKeys();
    const unc = ecdh.getPublicKey("hex", "uncompressed");
    const cmp = ecdh.getPublicKey("hex", "compressed");
    const hyb = ecdh.getPublicKey("hex", "hybrid");

    expect(ECDH.convertKey(unc, curve, "hex", "hex", "hybrid")).toBe(hyb);
    expect(ECDH.convertKey(cmp, curve, "hex", "hex", "hybrid")).toBe(hyb);
    expect(ECDH.convertKey(hyb, curve, "hex", "hex", "uncompressed")).toBe(unc);
    expect(ECDH.convertKey(hyb, curve, "hex", "hex", "compressed")).toBe(cmp);
    expect(ECDH.convertKey(hyb, curve, "hex", "hex", "hybrid")).toBe(hyb);
  });

  test("computeSecret and setPublicKey accept a hybrid-encoded peer key", () => {
    const bob = createECDH("prime256v1");
    bob.generateKeys();
    const fromHybrid = bob.computeSecret(knownHybrid, "hex");
    const fromUncompressed = bob.computeSecret(knownUncompressed, "hex");
    expect(fromHybrid.equals(fromUncompressed)).toBe(true);
    expect(fromHybrid.length).toBe(32);

    const carol = createECDH("prime256v1");
    carol.generateKeys();
    carol.setPublicKey(knownHybrid, "hex");
    expect(carol.getPublicKey("hex", "uncompressed")).toBe(knownUncompressed);
    expect(carol.getPublicKey("hex", "hybrid")).toBe(knownHybrid);
  });

  test.each(["prime256v1", "secp384r1", "secp521r1"])(
    "computeSecret agrees when the peer key is hybrid on %s",
    curve => {
      const alice = createECDH(curve);
      const bob = createECDH(curve);
      alice.generateKeys();
      bob.generateKeys();

      const aliceHybrid = alice.getPublicKey(undefined, "hybrid");
      const bobHybrid = bob.getPublicKey(undefined, "hybrid");

      const aliceSecret = alice.computeSecret(bobHybrid);
      const bobSecret = bob.computeSecret(aliceHybrid);
      const reference = alice.computeSecret(bob.getPublicKey());

      expect(aliceSecret.equals(bobSecret)).toBe(true);
      expect(aliceSecret.equals(reference)).toBe(true);
    },
  );

  test("rejects hybrid input whose y-parity bit does not match Y", () => {
    // knownHybrid has prefix 0x07 (y odd); 0x06 with the same coordinates is invalid.
    const badHybrid = "06" + knownHybrid.slice(2);
    expect(() => ECDH.convertKey(badHybrid, "prime256v1", "hex", "hex", "uncompressed")).toThrow(
      expect.objectContaining({ code: "ERR_CRYPTO_OPERATION_FAILED" }),
    );

    const bob = createECDH("prime256v1");
    bob.generateKeys();
    expect(() => bob.computeSecret(badHybrid, "hex")).toThrow(
      expect.objectContaining({ code: "ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY" }),
    );
  });

  test("rejects hybrid input with wrong length", () => {
    // Valid hybrid prefix but truncated body.
    const truncated = Buffer.from(knownHybrid, "hex").subarray(0, 33);
    expect(truncated[0]).toBe(0x07);
    expect(() => ECDH.convertKey(truncated, "prime256v1", null, "hex", "uncompressed")).toThrow(
      expect.objectContaining({ code: "ERR_CRYPTO_OPERATION_FAILED" }),
    );
  });
});
