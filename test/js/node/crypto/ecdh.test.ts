import { expect, test } from "bun:test";
import { createECDH, ECDH, getCurves } from "node:crypto";
import { createContext, runInContext } from "node:vm";

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

// The secp256k1 point of the private key "cafebabe" x 8, from Node's test-crypto-dh-curves.js.
// It has the length and the prefix byte of a prime256v1 point, so only the curve equation rejects it.
const secp256k1Point =
  "04672a31bfc59d3f04548ec9b7daeeba2f61814e8ccc40448045007f5479f693a3" +
  "2e02c7f93d13dc2732b760ca377a5897b9dd41a1c1b29dc0442fdce6d0a04d1d";

// Node's text: https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_ec.cc#L322-L325
test.each([
  ["bytes that are not a point", (ecdh: ECDH) => ecdh.setPublicKey(Buffer.from("abcd"))],
  ["a hex string that is not a point", (ecdh: ECDH) => ecdh.setPublicKey("abcd", "hex")],
  ["an empty buffer", (ecdh: ECDH) => ecdh.setPublicKey(Buffer.alloc(0))],
  ["a truncated point", (ecdh: ECDH) => ecdh.setPublicKey(createECDH("prime256v1").generateKeys().subarray(0, 10))],
  ["a secp384r1 point, which is too long", (ecdh: ECDH) => ecdh.setPublicKey(createECDH("secp384r1").generateKeys())],
  ["a secp256k1 point of the same length", (ecdh: ECDH) => ecdh.setPublicKey(secp256k1Point, "hex")],
  [
    "coordinates that are not on the curve",
    (ecdh: ECDH) => ecdh.setPublicKey(Buffer.concat([Buffer.from([4]), Buffer.alloc(64)])),
  ],
])("ECDH - setPublicKey rejects %s with Node's error", (_name, setPublicKey) => {
  const ecdh = createECDH("prime256v1");
  const publicKey = ecdh.generateKeys();

  expect(() => setPublicKey(ecdh)).toThrow(
    expect.objectContaining({
      name: "Error",
      code: "ERR_CRYPTO_OPERATION_FAILED",
      message: "Failed to convert Buffer to EC_POINT",
    }),
  );
  // The rejected key does not replace the current one.
  expect(ecdh.getPublicKey()).toEqual(publicKey);
});

// A private key is valid in the range [1, order - 1].
const prime256v1Order = "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551";
const prime256v1OrderMinusOne = "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632550";

// BN_bin2bn accepts at most INT_MAX / (4 * 64) words of 8 bytes. BoringSSL and OpenSSL have the same limit.
const maxBignumBytes = Math.floor(0x7fffffff / (4 * 64)) * 8;

// Node's text ends with a period: https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_ec.cc#L272-L275
test.each([
  ["an empty buffer", (ecdh: ECDH) => ecdh.setPrivateKey(Buffer.alloc(0))],
  ["zero", (ecdh: ECDH) => ecdh.setPrivateKey(Buffer.alloc(32))],
  ["the curve order", (ecdh: ECDH) => ecdh.setPrivateKey(Buffer.from(prime256v1Order, "hex"))],
  ["the curve order as a hex string", (ecdh: ECDH) => ecdh.setPrivateKey(prime256v1Order, "hex")],
  ["a value above the curve order", (ecdh: ECDH) => ecdh.setPrivateKey(Buffer.alloc(32, 0xff))],
  ["a value longer than the curve order", (ecdh: ECDH) => ecdh.setPrivateKey(Buffer.alloc(40, 0xff))],
  ["the longest value a BIGNUM can hold", (ecdh: ECDH) => ecdh.setPrivateKey(Buffer.alloc(maxBignumBytes, 0xff))],
])("ECDH - setPrivateKey rejects %s with Node's error", (_name, setPrivateKey) => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey();
  const publicKey = ecdh.getPublicKey();

  expect(() => setPrivateKey(ecdh)).toThrow(
    expect.objectContaining({
      name: "RangeError",
      code: "ERR_CRYPTO_INVALID_KEYTYPE",
      message: "Private key is not valid for specified curve.",
    }),
  );
  // The rejected key does not replace the current key pair.
  expect(ecdh.getPrivateKey()).toEqual(privateKey);
  expect(ecdh.getPublicKey()).toEqual(publicKey);
});

// Node's text: https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_ec.cc#L266-L270
test("ECDH - setPrivateKey rejects a value too long for a BIGNUM with Node's error", () => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey();

  expect(() => ecdh.setPrivateKey(Buffer.alloc(maxBignumBytes + 1, 0xff))).toThrow(
    expect.objectContaining({
      name: "Error",
      code: "ERR_CRYPTO_OPERATION_FAILED",
      message: "Failed to convert Buffer to BN",
    }),
  );
  // The rejected key does not replace the current one.
  expect(ecdh.getPrivateKey()).toEqual(privateKey);
});

test("ECDH - setPrivateKey accepts the curve order minus one, the largest valid key", () => {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(prime256v1OrderMinusOne, "hex");
  expect(ecdh.getPrivateKey("hex")).toBe(prime256v1OrderMinusOne);
});

test.each([
  [
    "the main realm",
    () =>
      class MyECDH extends ECDH {
        publicKeyHex() {
          return this.getPublicKey("hex");
        }
      },
  ],
  [
    "a node:vm context",
    () =>
      runInContext(
        `(class MyECDH extends ECDH { publicKeyHex() { return this.getPublicKey("hex"); } })`,
        createContext({ ECDH }),
      ),
  ],
])("ECDH - a subclass declared in %s has the subclass prototype and working keys", (_realm, declare) => {
  const MyECDH = declare();

  const alice = new MyECDH("prime256v1");
  expect(Object.getPrototypeOf(alice)).toBe(MyECDH.prototype);
  expect(alice).toBeInstanceOf(ECDH);

  const bob = createECDH("prime256v1");
  alice.generateKeys();
  bob.generateKeys();
  expect(alice.publicKeyHex()).toBe(alice.getPublicKey("hex"));
  expect(alice.computeSecret(bob.getPublicKey())).toEqual(bob.computeSecret(alice.getPublicKey()));
});
