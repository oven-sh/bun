import { deserialize, serialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";

describe("CryptoKey serialization", () => {
  test("structuredClone preserves AES-GCM key", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const cloned = structuredClone(key);

    const original = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    const clonedExport = new Uint8Array(await crypto.subtle.exportKey("raw", cloned));

    expect(Buffer.from(clonedExport)).toEqual(Buffer.from(original));
  });

  test("structuredClone preserves HMAC key", async () => {
    const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"]);
    const cloned = structuredClone(key);

    const original = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    const clonedExport = new Uint8Array(await crypto.subtle.exportKey("raw", cloned));

    expect(Buffer.from(clonedExport)).toEqual(Buffer.from(original));
  });

  test("structuredClone preserves RSA-OAEP key pair", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["encrypt", "decrypt"],
    );

    const clonedPrivate = structuredClone(keyPair.privateKey);
    const clonedPublic = structuredClone(keyPair.publicKey);

    const origPrivate = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
    const clonedPrivateExport = new Uint8Array(await crypto.subtle.exportKey("pkcs8", clonedPrivate));

    const origPublic = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
    const clonedPublicExport = new Uint8Array(await crypto.subtle.exportKey("spki", clonedPublic));

    expect(Buffer.from(clonedPrivateExport)).toEqual(Buffer.from(origPrivate));
    expect(Buffer.from(clonedPublicExport)).toEqual(Buffer.from(origPublic));
  });

  test("structuredClone preserves ECDSA key pair", async () => {
    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

    const clonedPrivate = structuredClone(keyPair.privateKey);
    const origPrivate = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
    const clonedPrivateExport = new Uint8Array(await crypto.subtle.exportKey("pkcs8", clonedPrivate));

    expect(Buffer.from(clonedPrivateExport)).toEqual(Buffer.from(origPrivate));
  });

  test("structuredClone preserves non-extractable key usages and algorithm", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["encrypt"]);
    const cloned = structuredClone(key);

    expect(cloned.extractable).toBe(false);
    expect(cloned.algorithm.name).toBe("AES-GCM");
    expect((cloned.algorithm as AesKeyAlgorithm).length).toBe(128);
    expect(cloned.usages).toEqual(["encrypt"]);
  });

  test("bun:jsc serialize/deserialize round-trips AES key", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const serialized = serialize(key);
    const deserialized = deserialize(serialized) as CryptoKey;

    const original = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    const restored = new Uint8Array(await crypto.subtle.exportKey("raw", deserialized));

    expect(Buffer.from(restored)).toEqual(Buffer.from(original));
  });

  test("serialized CryptoKey data is wrapped (raw key bytes not present in serialized form)", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);

    const rawKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    const rawHex = Buffer.from(rawKeyBytes).toString("hex");

    const serialized = serialize(key);
    const serializedHex = Buffer.from(serialized).toString("hex");

    // The raw key bytes should NOT appear verbatim in the serialized data
    // because the wrapping function encrypts them with a per-process master key.
    expect(serializedHex.includes(rawHex)).toBe(false);
  });

  test("cloned key can be used for encrypt/decrypt", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const cloned = structuredClone(key);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode("Hello, World!");

    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cloned, ciphertext);

    expect(new Uint8Array(decrypted)).toEqual(plaintext);
  });

  test("cloned HMAC key can be used for sign/verify", async () => {
    const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"]);
    const cloned = structuredClone(key);

    const data = new TextEncoder().encode("test data");
    const signature = await crypto.subtle.sign("HMAC", key, data);
    const valid = await crypto.subtle.verify("HMAC", cloned, signature, data);

    expect(valid).toBe(true);
  });
});
