import { test, expect } from "bun:test";

test("X25519 key operations work", async () => {
  const keyPair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;

  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  expect(jwk.kty).toBe("OKP");
  expect(jwk.crv).toBe("X25519");

  const publicKeyBytes = new Uint8Array(32);
  const importedKey = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "X25519" }, false, []);
  expect(importedKey.algorithm.name).toBe("X25519");
});

test("X25519 deriveBits is supported in Bun", async () => {
  const keyPair1 = (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;

  const keyPair2 = (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "X25519", public: keyPair2.publicKey },
    keyPair1.privateKey,
    256,
  );

  expect(sharedSecret).toBeInstanceOf(ArrayBuffer);
  expect(sharedSecret.byteLength).toBe(32);
});

test("X25519 deriveBits produces consistent shared secrets", async () => {
  // Generate two key pairs
  const keyPair1 = (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;

  const keyPair2 = (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;

  // Derive shared secret from both sides
  const sharedSecret1 = await crypto.subtle.deriveBits(
    { name: "X25519", public: keyPair2.publicKey },
    keyPair1.privateKey,
    256,
  );

  const sharedSecret2 = await crypto.subtle.deriveBits(
    { name: "X25519", public: keyPair1.publicKey },
    keyPair2.privateKey,
    256,
  );

  // Both sides should derive the same shared secret
  const bytes1 = new Uint8Array(sharedSecret1);
  const bytes2 = new Uint8Array(sharedSecret2);

  expect(bytes1).toEqual(bytes2);
});

test("X25519 deriveBits with imported keys", async () => {
  // Test vectors from RFC 7748
  const alicePrivateKeyHex = "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a";
  const alicePublicKeyHex = "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a";
  const bobPrivateKeyHex = "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb";
  const bobPublicKeyHex = "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f";
  const expectedSharedSecretHex = "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742";

  // Helper to convert hex to Uint8Array
  const hexToBytes = (hex: string) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  };

  // Import Alice's private key
  const alicePrivateKey = await crypto.subtle.importKey(
    "pkcs8",
    // X25519 private key in PKCS#8 format
    hexToBytes("302e020100300506032b656e0422042077076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"),
    { name: "X25519" },
    false,
    ["deriveBits"],
  );

  // Import Bob's public key
  const bobPublicKey = await crypto.subtle.importKey("raw", hexToBytes(bobPublicKeyHex), { name: "X25519" }, false, []);

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits({ name: "X25519", public: bobPublicKey }, alicePrivateKey, 256);

  const sharedSecretHex = Array.from(new Uint8Array(sharedSecret))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  expect(sharedSecretHex).toBe(expectedSharedSecretHex);
});

test("X25519 deriveBits with null length", async () => {
  const keyPair1 = (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;

  const keyPair2 = (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "X25519", public: keyPair2.publicKey },
    keyPair1.privateKey,
    null as any,
  );

  expect(sharedSecret).toBeInstanceOf(ArrayBuffer);
  expect(sharedSecret.byteLength).toBe(32);
});

test("X25519 deriveBits errors", async () => {
  const keyPair1 = (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;

  const keyPair2 = (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;

  // Should fail when using public key as base key
  await expect(
    crypto.subtle.deriveBits({ name: "X25519", public: keyPair2.publicKey }, keyPair1.publicKey as any, 256),
  ).rejects.toThrow();

  // Should fail when using private key as public key
  await expect(
    crypto.subtle.deriveBits({ name: "X25519", public: keyPair2.privateKey as any }, keyPair1.privateKey, 256),
  ).rejects.toThrow();

  // Should fail when length is too long
  await expect(
    crypto.subtle.deriveBits(
      { name: "X25519", public: keyPair2.publicKey },
      keyPair1.privateKey,
      512, // X25519 can only derive 256 bits
    ),
  ).rejects.toThrow();
});
