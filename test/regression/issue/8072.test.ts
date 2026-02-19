import { describe, expect, test } from "bun:test";
import { createCipheriv, createDecipheriv, getCipherInfo, getCiphers } from "crypto";

describe("ChaCha20-Poly1305 cipher support (issue #8072)", () => {
  const key = Buffer.alloc(32);
  const iv = Buffer.alloc(12);
  const aad = Buffer.from("additional authenticated data");
  const plaintext = Buffer.from("Hello, ChaCha20-Poly1305!");

  // Initialize test vectors
  for (let i = 0; i < 32; i++) key[i] = i;
  for (let i = 0; i < 12; i++) iv[i] = i + 0x10;

  test("chacha20-poly1305 should be listed in getCiphers()", () => {
    const ciphers = getCiphers();
    expect(ciphers).toContain("chacha20-poly1305");
  });

  test("getCipherInfo should return correct info for chacha20-poly1305", () => {
    const info = getCipherInfo("chacha20-poly1305");
    expect(info).toBeDefined();
    expect(info?.name).toBe("chacha20-poly1305");
    expect(info?.keyLength).toBe(32);
    expect(info?.ivLength).toBe(12);
  });

  test("basic encryption and decryption round-trip", () => {
    const cipher = createCipheriv("chacha20-poly1305", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    expect(authTag.length).toBe(16);

    const decipher = createDecipheriv("chacha20-poly1305", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    expect(decrypted.toString()).toBe(plaintext.toString());
  });

  test("encryption with AAD (Additional Authenticated Data)", () => {
    const cipher = createCipheriv("chacha20-poly1305", key, iv);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const decipher = createDecipheriv("chacha20-poly1305", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    expect(decrypted.toString()).toBe(plaintext.toString());
  });

  test("decryption fails with wrong auth tag", () => {
    const cipher = createCipheriv("chacha20-poly1305", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Corrupt the auth tag
    const wrongTag = Buffer.from(authTag);
    wrongTag[0] ^= 0xff;

    const decipher = createDecipheriv("chacha20-poly1305", key, iv);
    decipher.setAuthTag(wrongTag);
    decipher.update(encrypted);

    expect(() => decipher.final()).toThrow();
  });

  test("decryption fails with wrong AAD", () => {
    const cipher = createCipheriv("chacha20-poly1305", key, iv);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const decipher = createDecipheriv("chacha20-poly1305", key, iv);
    decipher.setAAD(Buffer.from("wrong aad"));
    decipher.setAuthTag(authTag);
    decipher.update(encrypted);

    expect(() => decipher.final()).toThrow();
  });

  test("rejects invalid key length (not 32 bytes)", () => {
    const shortKey = Buffer.alloc(16, 0x42);
    expect(() => createCipheriv("chacha20-poly1305", shortKey, iv)).toThrow();

    const longKey = Buffer.alloc(64, 0x42);
    expect(() => createCipheriv("chacha20-poly1305", longKey, iv)).toThrow();
  });

  test("supports different IV lengths up to 12 bytes", () => {
    // 12-byte IV is standard
    const cipher12 = createCipheriv("chacha20-poly1305", key, Buffer.alloc(12, 0x11));
    cipher12.update(plaintext);
    cipher12.final();
    expect(cipher12.getAuthTag().length).toBe(16);
  });

  test("RFC 7539 test vector", () => {
    // Test vector from RFC 7539 Section 2.8.2
    const rfcKey = Buffer.from("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f", "hex");
    const rfcNonce = Buffer.from("070000004041424344454647", "hex");
    const rfcAad = Buffer.from("50515253c0c1c2c3c4c5c6c7", "hex");
    const rfcPlaintext = Buffer.from(
      "4c616469657320616e642047656e746c656d656e206f662074686520636c6173" +
        "73206f66202739393a204966204920636f756c64206f6666657220796f75206f" +
        "6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73" +
        "637265656e20776f756c642062652069742e",
      "hex",
    );
    const expectedCiphertext = Buffer.from(
      "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d6" +
        "3dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b36" +
        "92ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc" +
        "3ff4def08e4b7a9de576d26586cec64b6116",
      "hex",
    );
    const expectedTag = Buffer.from("1ae10b594f09e26a7e902ecbd0600691", "hex");

    const cipher = createCipheriv("chacha20-poly1305", rfcKey, rfcNonce);
    cipher.setAAD(rfcAad);
    const ciphertext = Buffer.concat([cipher.update(rfcPlaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    expect(ciphertext.toString("hex")).toBe(expectedCiphertext.toString("hex"));
    expect(tag.toString("hex")).toBe(expectedTag.toString("hex"));

    // Verify decryption
    const decipher = createDecipheriv("chacha20-poly1305", rfcKey, rfcNonce);
    decipher.setAAD(rfcAad);
    decipher.setAuthTag(expectedTag);
    const decrypted = Buffer.concat([decipher.update(expectedCiphertext), decipher.final()]);

    expect(decrypted.toString("hex")).toBe(rfcPlaintext.toString("hex"));
  });

  test("empty plaintext encryption", () => {
    const cipher = createCipheriv("chacha20-poly1305", key, iv);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(Buffer.alloc(0)), cipher.final()]);
    const authTag = cipher.getAuthTag();

    expect(encrypted.length).toBe(0);
    expect(authTag.length).toBe(16);

    const decipher = createDecipheriv("chacha20-poly1305", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    expect(decrypted.length).toBe(0);
  });

  test("large data encryption", () => {
    const largeData = Buffer.alloc(1024 * 1024, 0x42); // 1MB of data

    const cipher = createCipheriv("chacha20-poly1305", key, iv);
    const encrypted = Buffer.concat([cipher.update(largeData), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const decipher = createDecipheriv("chacha20-poly1305", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    expect(decrypted.equals(largeData)).toBe(true);
  });

  test("incremental encryption matches single-call encryption", () => {
    const data1 = Buffer.from("first chunk");
    const data2 = Buffer.from("second chunk");
    const data3 = Buffer.from("third chunk");
    const fullData = Buffer.concat([data1, data2, data3]);

    // Single call
    const cipher1 = createCipheriv("chacha20-poly1305", key, iv);
    const encrypted1 = Buffer.concat([cipher1.update(fullData), cipher1.final()]);
    const tag1 = cipher1.getAuthTag();

    // Incremental calls
    const cipher2 = createCipheriv("chacha20-poly1305", key, iv);
    const encrypted2 = Buffer.concat([
      cipher2.update(data1),
      cipher2.update(data2),
      cipher2.update(data3),
      cipher2.final(),
    ]);
    const tag2 = cipher2.getAuthTag();

    expect(encrypted2.toString("hex")).toBe(encrypted1.toString("hex"));
    expect(tag2.toString("hex")).toBe(tag1.toString("hex"));
  });
});
