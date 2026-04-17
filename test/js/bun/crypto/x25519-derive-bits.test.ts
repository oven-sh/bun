import { expect, test } from "bun:test";

// Test vectors from RFC 7748 / Node.js test suite
const x25519Vector = {
  pkcs8: "302e020100300506032b656e04220420c8838e76d057dfb7d8c95a69e138160add6373fd71a4d276bb56e3a81b64ff61",
  spki: "302a300506032b656e0321001cf2b1e6022ec537371ed7f53e54fa1154d83e98eb64ea51fae5b3307cfe9706",
  result: "2768409dfab99ec23b8c89b93ff5880295f76176088f89e43dfebe7ea1950008",
};

async function importX25519Keys(usages: KeyUsage[] = ["deriveBits"]) {
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.importKey("pkcs8", Buffer.from(x25519Vector.pkcs8, "hex"), { name: "X25519" }, true, usages),
    crypto.subtle.importKey("spki", Buffer.from(x25519Vector.spki, "hex"), { name: "X25519" }, true, []),
  ]);
  return { privateKey, publicKey };
}

test("X25519 deriveBits with known test vector", async () => {
  const { privateKey, publicKey } = await importX25519Keys();

  const bits = await crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 256);

  expect(bits).toBeInstanceOf(ArrayBuffer);
  expect(Buffer.from(bits).toString("hex")).toBe(x25519Vector.result);
});

test("X25519 deriveBits with null length returns full output", async () => {
  const { privateKey, publicKey } = await importX25519Keys();

  // @ts-expect-error types not updated to reflect WebCryptoAPI spec change
  const bits = await crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, null);

  expect(bits).toBeInstanceOf(ArrayBuffer);
  expect(bits.byteLength).toBe(32);
  expect(Buffer.from(bits).toString("hex")).toBe(x25519Vector.result);
});

test("X25519 deriveBits with zero length returns full output", async () => {
  const { privateKey, publicKey } = await importX25519Keys();

  const bits = await crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 0);

  expect(bits).toBeInstanceOf(ArrayBuffer);
  expect(bits.byteLength).toBe(32);
  expect(Buffer.from(bits).toString("hex")).toBe(x25519Vector.result);
});

test("X25519 deriveBits with shorter length", async () => {
  const { privateKey, publicKey } = await importX25519Keys();

  const bits = await crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 128);

  expect(bits).toBeInstanceOf(ArrayBuffer);
  expect(bits.byteLength).toBe(16);
  expect(Buffer.from(bits).toString("hex")).toBe(x25519Vector.result.slice(0, 32));
});

test("X25519 deriveBits with generated keys", async () => {
  const aliceKeys = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const bobKeys = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);

  const [aliceShared, bobShared] = await Promise.all([
    crypto.subtle.deriveBits({ name: "X25519", public: bobKeys.publicKey }, aliceKeys.privateKey, 256),
    crypto.subtle.deriveBits({ name: "X25519", public: aliceKeys.publicKey }, bobKeys.privateKey, 256),
  ]);

  expect(Buffer.from(aliceShared).toString("hex")).toBe(Buffer.from(bobShared).toString("hex"));
});

test("X25519 deriveBits case insensitive algorithm name", async () => {
  const { privateKey, publicKey } = await importX25519Keys();

  const bits = await crypto.subtle.deriveBits({ name: "x25519", public: publicKey }, privateKey, 256);

  expect(Buffer.from(bits).toString("hex")).toBe(x25519Vector.result);
});

test("X25519 deriveBits rejects when length exceeds output size", async () => {
  const { privateKey, publicKey } = await importX25519Keys();

  await expect(crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 512)).rejects.toThrow();
});

test("X25519 deriveBits rejects when base key lacks deriveBits usage", async () => {
  // Private key imported with only "deriveKey" usage; key type is valid for the base-key slot
  // but the usages check should still reject it.
  const { privateKey, publicKey } = await importX25519Keys(["deriveKey"]);

  await expect(crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 256)).rejects.toThrow(
    "CryptoKey doesn't support bits derivation",
  );
});

test("X25519 deriveBits rejects with all-zero public key (RFC 7748 Section 6.1)", async () => {
  const { privateKey } = await importX25519Keys();

  // Import an all-zero public key (small-order point)
  const zeroPublicKey = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "X25519" }, true, []);

  await expect(crypto.subtle.deriveBits({ name: "X25519", public: zeroPublicKey }, privateKey, 256)).rejects.toThrow();
});

test("X25519 deriveKey produces an AES-GCM key from the shared secret", async () => {
  const { privateKey, publicKey } = await importX25519Keys(["deriveKey", "deriveBits"]);

  const key = await crypto.subtle.deriveKey(
    { name: "X25519", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  expect(key.algorithm.name).toBe("AES-GCM");
  const raw = await crypto.subtle.exportKey("raw", key);
  expect(Buffer.from(raw).toString("hex")).toBe(x25519Vector.result);
});
