import { test, expect } from "bun:test";
import { createCipheriv, createDecipheriv, getCiphers } from "crypto";

test("aes-128-cfb8 cipher creates successfully", () => {
  const key = Buffer.alloc(16);
  const iv = Buffer.alloc(16);
  const cipher = createCipheriv("aes-128-cfb8", key, iv);
  expect(cipher).toBeDefined();
});

test("aes-192-cfb8 cipher creates successfully", () => {
  const key = Buffer.alloc(24);
  const iv = Buffer.alloc(16);
  const cipher = createCipheriv("aes-192-cfb8", key, iv);
  expect(cipher).toBeDefined();
});

test("aes-256-cfb8 cipher creates successfully", () => {
  const key = Buffer.alloc(32);
  const iv = Buffer.alloc(16);
  const cipher = createCipheriv("aes-256-cfb8", key, iv);
  expect(cipher).toBeDefined();
});

test("aes-128-cfb8 encrypt/decrypt roundtrip", () => {
  const key = Buffer.from("0123456789abcdef");
  const iv = Buffer.from("fedcba9876543210");
  const plaintext = Buffer.from("Hello, CFB8 world!");

  const cipher = createCipheriv("aes-128-cfb8", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const decipher = createDecipheriv("aes-128-cfb8", key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  expect(decrypted).toEqual(plaintext);
});

test("aes-192-cfb8 encrypt/decrypt roundtrip", () => {
  const key = Buffer.from("0123456789abcdef01234567"); // 24 bytes
  const iv = Buffer.from("fedcba9876543210");
  const plaintext = Buffer.from("Test data for AES-192-CFB8 mode");

  const cipher = createCipheriv("aes-192-cfb8", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const decipher = createDecipheriv("aes-192-cfb8", key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  expect(decrypted).toEqual(plaintext);
});

test("aes-256-cfb8 encrypt/decrypt roundtrip", () => {
  const key = Buffer.from("0123456789abcdef0123456789abcdef");
  const iv = Buffer.from("fedcba9876543210");
  const plaintext = Buffer.from("Test data for AES-256-CFB8 mode");

  const cipher = createCipheriv("aes-256-cfb8", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const decipher = createDecipheriv("aes-256-cfb8", key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  expect(decrypted).toEqual(plaintext);
});

test("aes-192-cfb also works (previously missing registration)", () => {
  const key = Buffer.from("0123456789abcdef01234567"); // 24 bytes
  const iv = Buffer.from("fedcba9876543210");
  const plaintext = Buffer.from("AES-192-CFB test");

  const cipher = createCipheriv("aes-192-cfb", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const decipher = createDecipheriv("aes-192-cfb", key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  expect(decrypted).toEqual(plaintext);
});

test("cfb8 and cfb variants appear in getCiphers()", () => {
  const ciphers = getCiphers();
  expect(ciphers).toContain("aes-128-cfb8");
  expect(ciphers).toContain("aes-192-cfb8");
  expect(ciphers).toContain("aes-256-cfb8");
  expect(ciphers).toContain("aes-192-cfb");
});
